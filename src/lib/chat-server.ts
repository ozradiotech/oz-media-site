// Server side of the live chat. Browsers only read the Realtime Database; every write goes through the
// /api/chat* routes, which use these helpers. Writes use the database REST API with a service-account token
// rather than the Admin SDK's database client, which would hold a realtime connection open per serverless instance.
import { FIREBASE_SERVICE_ACCOUNT } from 'astro:env/server';
import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { defaultBlocklist, type Blocklist } from './chat-filter';

export const chatRooms = new Set(['bandung', 'bali']);

export type ChatMessage = {
	/** Sender uid. */
	u: string;
	/** Display name. */
	n: string;
	/** Google profile picture URL. */
	p?: string;
	/** Text. */
	t: string;
	/** Server timestamp (ms). */
	ts: number;
	/** Sent by a moderator. */
	m?: boolean;
};

const databaseUrl: string | undefined = import.meta.env.PUBLIC_FIREBASE_DATABASE_URL?.replace(/\/+$/, '');
// When the site uses App Check, our routes require it too, so scripts can't skip it by calling the API directly.
const appCheckRequired = Boolean(import.meta.env.PUBLIC_FIREBASE_APPCHECK_SITE_KEY);

export const isChatServerConfigured = Boolean(FIREBASE_SERVICE_ACCOUNT && databaseUrl);

export class ChatError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

export const chatErrorResponse = (error: unknown) => {
	if (error instanceof ChatError) return Response.json({ error: error.message }, { status: error.status });
	console.error('Chat request failed:', error);
	return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
};

const getAdminApp = (): App => {
	if (getApps().length) return getApp();
	if (!FIREBASE_SERVICE_ACCOUNT || !databaseUrl) throw new ChatError(503, 'Chat is not available right now.');
	return initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)), databaseURL: databaseUrl });
};

export const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw new ChatError(400, 'Invalid request.');
	return body as Record<string, unknown>;
};

/** Checks App Check (when enabled) and the Firebase ID token, and returns the verified user. */
export const verifyChatRequest = async (request: Request): Promise<DecodedIdToken> => {
	const app = getAdminApp();
	if (appCheckRequired) {
		const appCheckToken = request.headers.get('X-Firebase-AppCheck');
		const failure = appCheckToken
			? await getAppCheck(app).verifyToken(appCheckToken).then(() => null, (error: unknown) => error)
			: 'no App Check token sent (the browser could not get one)';
		if (failure) {
			console.warn('Chat App Check failed:', failure);
			throw new ChatError(401, 'We could not verify your browser. Please reload the page.');
		}
	}
	const idToken = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
	if (!idToken) throw new ChatError(401, 'Please sign in to chat.');
	try {
		return await getAuth(app).verifyIdToken(idToken);
	} catch {
		throw new ChatError(401, 'Your session has expired. Please sign in again.');
	}
};

export const isModerator = (user: DecodedIdToken) => user.mod === true;

export const isModeratorUid = async (uid: string) => {
	const target = await getAuth(getAdminApp()).getUser(uid).catch(() => undefined);
	return target?.customClaims?.mod === true;
};

let accessToken: { value: string; expiresAt: number } | undefined;

const getAccessToken = async () => {
	if (accessToken && accessToken.expiresAt - 60_000 > Date.now()) return accessToken.value;
	const credential = getAdminApp().options.credential;
	if (!credential) throw new ChatError(503, 'Chat is not available right now.');
	const token = await credential.getAccessToken();
	accessToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
	return accessToken.value;
};

/** Ids from the database (push ids, Firebase uids) are safe as path segments; anything else is refused. */
export const isDatabaseKey = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);

export const serverTimestamp = { '.sv': 'timestamp' } as const;

/** A Realtime Database REST call, authorised as the service account (security rules don't apply). */
export const db = async <T = unknown>(
	method: 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE',
	path: string,
	body?: unknown,
	params: Record<string, string> = {},
): Promise<T> => {
	const url = new URL(`${databaseUrl}/${path}.json`);
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
	const response = await fetch(url, {
		method,
		headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(8000),
	});
	if (!response.ok) throw new Error(`Database ${method} ${path} failed with ${response.status}: ${await response.text()}`);
	return (await response.json()) as T;
};

let blocklistCache: { value: Blocklist; expiresAt: number } | undefined;

// Extra words live at chat/private/blocklist as { mild: "word, word", severe: "word, word" } (lists also work).
const parseWords = (value: unknown): string[] => {
	if (Array.isArray(value)) return value.filter((word): word is string => typeof word === 'string');
	if (typeof value === 'string') return value.split(',').map((word) => word.trim()).filter(Boolean);
	if (value && typeof value === 'object') return Object.keys(value);
	return [];
};

export const getBlocklist = async (): Promise<Blocklist> => {
	if (blocklistCache && blocklistCache.expiresAt > Date.now()) return blocklistCache.value;
	const extra = await db<{ mild?: unknown; severe?: unknown } | null>('GET', 'chat/private/blocklist').catch(() => null);
	const value = {
		mild: [...defaultBlocklist.mild, ...parseWords(extra?.mild)],
		severe: [...defaultBlocklist.severe, ...parseWords(extra?.severe)],
	};
	blocklistCache = { value, expiresAt: Date.now() + 60_000 };
	return value;
};

export const logModAction = (moderator: DecodedIdToken, entry: Record<string, unknown>) =>
	db('POST', 'chat/private/modlog', { ...entry, by: moderator.uid, byName: moderator.name ?? null, at: serverTimestamp });
