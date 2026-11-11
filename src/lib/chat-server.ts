// Server side of the live chat. Browsers only read the Realtime Database; every write goes through the
// /api/chat* routes, which use these helpers. Writes use the database REST API with a service-account token
// rather than the Admin SDK's database client, which would hold a realtime connection open per serverless instance.
import { FIREBASE_SERVICE_ACCOUNT } from 'astro:env/server';
import type { App } from 'firebase-admin/app';
import type { AppCheck } from 'firebase-admin/app-check';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { logChatEvent, type ChatLogEvent, type RefusalReason } from './chat-analytics';
import { chatRoomNames, isChatRole, type ChatRole } from './chat-events';
import { cmsFetch } from './cms';
import { defaultBlocklist, type Blocklist } from './chat-filter';

export const chatRooms = new Set<string>(chatRoomNames);

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
	/** The moderator's chat role, for the badge. Older messages and other sites only have `m`. */
	r?: ChatRole;
};

const databaseUrl: string | undefined = import.meta.env.PUBLIC_FIREBASE_DATABASE_URL?.replace(/\/+$/, '');
// When the site uses App Check, our routes require it too, so scripts can't skip it by calling the API directly.
const appCheckRequired = Boolean(import.meta.env.PUBLIC_FIREBASE_APPCHECK_SITE_KEY);

export const isChatServerConfigured = Boolean(FIREBASE_SERVICE_ACCOUNT && databaseUrl);

export class ChatError extends Error {
	/** `reason`: why a message was refused, for the chat analytics (src/lib/chat-analytics.ts). */
	constructor(readonly status: number, message: string, readonly reason?: RefusalReason) {
		super(message);
	}
}

export const chatErrorResponse = (error: unknown) => {
	if (error instanceof ChatError) return Response.json({ error: error.message }, { status: error.status });
	console.error('Chat request failed:', error);
	return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
};

// Accepts the key file's JSON as pasted, with or without the quotes .env needs around it.
export const parseServiceAccount = (value: string): Record<string, unknown> => {
	const json = value.trim().replace(/^(['"])(\{[\s\S]*\})\1$/, '$2');
	try {
		return JSON.parse(json);
	} catch {
		throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole service-account key file as its value.');
	}
};

type Admin = { app: App; auth: Auth; appCheck: AppCheck };
let adminRequest: Promise<Admin> | undefined;

// Firebase Admin is loaded on first use, so a problem with it is caught and logged by chatErrorResponse
// rather than failing the whole route while it loads.
const getAdmin = () => {
	adminRequest ??= (async () => {
		if (!FIREBASE_SERVICE_ACCOUNT || !databaseUrl) throw new ChatError(503, 'Chat is not available right now.');
		const [{ cert, getApp, getApps, initializeApp }, { getAuth }, { getAppCheck }] = await Promise.all([
			import('firebase-admin/app'),
			import('firebase-admin/auth'),
			import('firebase-admin/app-check'),
		]);
		const app = getApps().length
			? getApp()
			: initializeApp({ credential: cert(parseServiceAccount(FIREBASE_SERVICE_ACCOUNT)), databaseURL: databaseUrl });
		return { app, auth: getAuth(app), appCheck: getAppCheck(app) };
	})().catch((error: unknown) => {
		adminRequest = undefined;
		throw error;
	});
	return adminRequest;
};

export const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw new ChatError(400, 'Invalid request.');
	return body as Record<string, unknown>;
};

/** Checks App Check (when enabled) and the Firebase ID token, and returns the verified user. */
export const verifyChatRequest = async (request: Request): Promise<DecodedIdToken> => {
	const admin = await getAdmin();
	if (appCheckRequired) {
		const appCheckToken = request.headers.get('X-Firebase-AppCheck');
		const failure = appCheckToken
			? await admin.appCheck.verifyToken(appCheckToken).then(() => null, (error: unknown) => error)
			: 'no App Check token sent (the browser could not get one)';
		if (failure) {
			console.warn('Chat App Check failed:', failure);
			throw new ChatError(401, 'We could not verify your browser. Please reload the page.');
		}
	}
	return verifyIdToken(request, 'Please sign in to chat.');
};

/** Verifies the Firebase ID token sent as `Authorization: Bearer …` and returns the signed-in user. */
export const verifyIdToken = async (request: Request, signInMessage: string): Promise<DecodedIdToken> => {
	const admin = await getAdmin();
	const idToken = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
	if (!idToken) throw new ChatError(401, signInMessage);
	try {
		return await admin.auth.verifyIdToken(idToken);
	} catch {
		throw new ChatError(401, 'Your session has expired. Please sign in again.');
	}
};

/**
 * A Google account's chat role: from the CMS's Chat roles list (by email; cached for 30 seconds), else `mod` for
 * accounts given the moderator claim with scripts/chat-admin.mjs. Undefined for everyone else. If the CMS can't be
 * reached, only the claim counts.
 */
const chatRoleFor = async (email: string | undefined, modClaim: boolean): Promise<ChatRole | undefined> => {
	if (email) {
		const staff = await cmsFetch<{ docs: { email: string; role: string }[] }>('chat-staff?limit=0&pagination=false&depth=0')
			.catch((error) => {
				console.error('[chat roles]', error);
				return { docs: [] };
			});
		const role = staff.docs.find((person) => person.email.toLowerCase() === email.toLowerCase())?.role;
		if (isChatRole(role)) return role;
	}
	return modClaim ? 'mod' : undefined;
};

/** The signed-in user's chat role, or undefined if they aren't a moderator. */
export const moderatorRole = (user: DecodedIdToken) =>
	chatRoleFor(user.email_verified ? user.email : undefined, user.mod === true);

export const isModerator = async (user: DecodedIdToken) => Boolean(await moderatorRole(user));

export const isModeratorUid = async (uid: string) => {
	const target = await (await getAdmin()).auth.getUser(uid).catch(() => undefined);
	if (!target) return false;
	return Boolean(await chatRoleFor(target.emailVerified ? target.email : undefined, target.customClaims?.mod === true));
};

let accessToken: { value: string; expiresAt: number } | undefined;

const getAccessToken = async () => {
	if (accessToken && accessToken.expiresAt - 60_000 > Date.now()) return accessToken.value;
	const credential = (await getAdmin()).app.options.credential;
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

type ModAction = Extract<ChatLogEvent, { type: 'chat_moderation' }>['action'];

/** Keeps the moderators' log in the database, and counts the action in the chat analytics. */
export const logModAction = (moderator: DecodedIdToken, entry: { action: ModAction; room: string } & Record<string, unknown>) => {
	void logChatEvent({ type: 'chat_moderation', room: entry.room, action: entry.action });
	return db('POST', 'chat/private/modlog', { ...entry, by: moderator.uid, byName: moderator.name ?? null, at: serverTimestamp });
};
