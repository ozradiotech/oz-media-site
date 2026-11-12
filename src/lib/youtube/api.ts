// The YouTube Data API v3 calls the integration makes, as the connected OZ channel, and Google OAuth 2.0 (web server
// flow). https://developers.google.com/youtube/v3/live/docs and https://developers.google.com/identity/protocols/oauth2/web-server
import { JsonArrayStreamParser } from './stream-parser.ts';

/** The one scope needed: read and post live chat, read our broadcasts. `youtube.readonly` cannot post. */
export const youtubeScopes = ['https://www.googleapis.com/auth/youtube.force-ssl'];

/** Quota cost per call (https://developers.google.com/youtube/v3/determine_quota_cost). */
export const quotaCost = {
	broadcasts: 1,
	videos: 1,
	channels: 1,
	listMessages: 5,
	streamMessages: 5,
	insertMessage: 20,
} as const;

export type QuotaCall = keyof typeof quotaCost;

const apiBase = 'https://www.googleapis.com/youtube/v3';
// The streaming endpoint is only served from this host.
const streamBase = 'https://youtube.googleapis.com/youtube/v3';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const revokeUrl = 'https://oauth2.googleapis.com/revoke';
const requestTimeout = 10_000;

export type FetchLike = typeof fetch;

export type ApiErrorKind =
	/** The day's quota is used up; nothing more until it resets (midnight Pacific). */
	| 'quota'
	/** Too many messages too quickly; slow down and retry. */
	| 'rate'
	/** The chat ended, was turned off or no longer exists. */
	| 'chat_gone'
	/** Google no longer accepts our refresh token; an admin must connect again. */
	| 'auth_revoked'
	/** Not allowed, or the request itself is wrong: retrying won't help. */
	| 'permanent'
	/** A server or network problem; retrying may help. */
	| 'transient'
	/** No answer in time: the request may or may not have taken effect. */
	| 'timeout';

export class YoutubeApiError extends Error {
	readonly kind: ApiErrorKind;
	readonly status: number;
	readonly reason: string;
	constructor(kind: ApiErrorKind, status: number, reason: string, message: string) {
		super(message);
		this.kind = kind;
		this.status = status;
		this.reason = reason;
	}
}

const classify = (status: number, reason: string): ApiErrorKind => {
	if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return 'quota';
	if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || status === 429) return 'rate';
	if (reason === 'liveChatEnded' || reason === 'liveChatDisabled' || reason === 'liveChatNotFound') return 'chat_gone';
	if (reason === 'invalid_grant') return 'auth_revoked';
	if (status >= 500) return 'transient';
	return 'permanent';
};

const errorFromResponse = async (response: Response) => {
	const body: any = await response.json().catch(() => null);
	const item = Array.isArray(body) ? body[0] : body;
	const reason: string = item?.error?.errors?.[0]?.reason ?? (typeof item?.error === 'string' ? item.error : '') ?? '';
	const message: string = item?.error?.message ?? item?.error_description ?? `HTTP ${response.status}`;
	return new YoutubeApiError(classify(response.status, reason), response.status, reason, message);
};

const errorFromThrown = (error: unknown) => {
	if (error instanceof YoutubeApiError) return error;
	const name = error instanceof Error ? error.name : '';
	if (name === 'TimeoutError') return new YoutubeApiError('timeout', 0, 'timeout', 'YouTube did not answer in time.');
	return new YoutubeApiError('transient', 0, 'network', error instanceof Error ? error.message : 'Network error.');
};

// ---------- OAuth ----------

export type OAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

export const authorizationUrl = (config: OAuthConfig, state: string) => {
	const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('redirect_uri', config.redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', youtubeScopes.join(' '));
	// A refresh token, and asked for every time, since Google only hands one out on consent.
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('prompt', 'consent');
	url.searchParams.set('state', state);
	return url.toString();
};

export type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

const tokenRequest = async (fetchImpl: FetchLike, body: Record<string, string>): Promise<TokenResponse> => {
	let response: Response;
	try {
		response = await fetchImpl(tokenUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(body),
			signal: AbortSignal.timeout(requestTimeout),
		});
	} catch (error) {
		throw errorFromThrown(error);
	}
	if (!response.ok) throw await errorFromResponse(response);
	return response.json() as Promise<TokenResponse>;
};

export const exchangeCode = (config: OAuthConfig, code: string, fetchImpl: FetchLike = fetch) =>
	tokenRequest(fetchImpl, {
		code,
		client_id: config.clientId,
		client_secret: config.clientSecret,
		redirect_uri: config.redirectUri,
		grant_type: 'authorization_code',
	});

export const refreshAccessToken = (config: OAuthConfig, refreshToken: string, fetchImpl: FetchLike = fetch) =>
	tokenRequest(fetchImpl, {
		refresh_token: refreshToken,
		client_id: config.clientId,
		client_secret: config.clientSecret,
		grant_type: 'refresh_token',
	});

/** Tells Google to drop the grant. Best effort: a token that is already invalid is fine. */
export const revokeToken = async (token: string, fetchImpl: FetchLike = fetch) => {
	await fetchImpl(revokeUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ token }),
		signal: AbortSignal.timeout(requestTimeout),
	}).catch(() => undefined);
};

// ---------- Data API ----------

export type Broadcast = {
	id: string;
	title: string;
	/** created, ready, testStarting, testing, liveStarting, live, complete, revoked. */
	lifeCycleStatus: string;
	liveChatId: string | null;
	scheduledStartTime: string | null;
	actualStartTime: string | null;
	actualEndTime: string | null;
};

export type LiveDetails = {
	videoId: string;
	title: string;
	/** Null when YouTube leaves it out (hidden by the channel, or not live). Never guessed. */
	concurrentViewers: number | null;
	activeLiveChatId: string | null;
	actualStartTime: string | null;
	actualEndTime: string | null;
};

/** The parts of a liveChatMessage resource the sync reads. */
export type YoutubeChatItem = {
	id: string;
	snippet?: {
		type?: string;
		liveChatId?: string;
		authorChannelId?: string;
		publishedAt?: string;
		displayMessage?: string;
		textMessageDetails?: { messageText?: string };
	};
	authorDetails?: {
		channelId?: string;
		displayName?: string;
		profileImageUrl?: string;
		isChatOwner?: boolean;
		isChatModerator?: boolean;
	};
};

export type ChatPage = {
	items: YoutubeChatItem[];
	nextPageToken: string | null;
	pollingIntervalMillis: number | null;
	/** Set once the chat has ended. */
	offlineAt: string | null;
};

export interface YoutubeApi {
	myChannel(): Promise<{ id: string; title: string } | null>;
	broadcasts(status: 'active' | 'upcoming'): Promise<Broadcast[]>;
	liveDetails(videoId: string): Promise<LiveDetails | null>;
	listMessages(liveChatId: string, pageToken: string | null): Promise<ChatPage>;
	/** Resolves when the connection closes; each page as it arrives goes to `onPage`. */
	streamMessages(liveChatId: string, pageToken: string | null, onPage: (page: ChatPage) => Promise<void>, signal: AbortSignal): Promise<void>;
	insertMessage(liveChatId: string, text: string): Promise<{ id: string }>;
}

export type ApiOptions = {
	/** A current access token; `force` means the last one was refused. */
	accessToken(force?: boolean): Promise<string>;
	/** Every call that reached YouTube, for the quota count. */
	onCall?(call: QuotaCall): void;
	fetch?: FetchLike;
};

const toPage = (body: any): ChatPage => ({
	items: Array.isArray(body?.items) ? body.items : [],
	nextPageToken: typeof body?.nextPageToken === 'string' ? body.nextPageToken : null,
	pollingIntervalMillis: typeof body?.pollingIntervalMillis === 'number' ? body.pollingIntervalMillis : null,
	offlineAt: typeof body?.offlineAt === 'string' ? body.offlineAt : null,
});

const toNumber = (value: unknown) => {
	if (typeof value !== 'string' && typeof value !== 'number') return null;
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
};

export const createYoutubeApi = ({ accessToken, onCall, fetch: fetchImpl = fetch }: ApiOptions): YoutubeApi => {
	// One retry with a fresh token when YouTube says the token is no good.
	const request = async (call: QuotaCall, url: string, init: RequestInit = {}, timeout: number | null = requestTimeout): Promise<Response> => {
		for (let attempt = 0; ; attempt++) {
			const token = await accessToken(attempt > 0);
			let response: Response;
			try {
				onCall?.(call);
				response = await fetchImpl(url, {
					...init,
					headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' },
					signal: init.signal ?? (timeout ? AbortSignal.timeout(timeout) : undefined),
				});
			} catch (error) {
				throw errorFromThrown(error);
			}
			if (response.status === 401 && attempt === 0) continue;
			if (!response.ok) throw await errorFromResponse(response);
			return response;
		}
	};
	const json = async (call: QuotaCall, url: string, init?: RequestInit) => {
		const response = await request(call, url, init);
		try {
			return await response.json();
		} catch (error) {
			throw errorFromThrown(error);
		}
	};

	return {
		async myChannel() {
			const body = await json('channels', `${apiBase}/channels?part=snippet&mine=true`);
			const channel = body?.items?.[0];
			return channel ? { id: String(channel.id), title: String(channel.snippet?.title ?? '') } : null;
		},

		async broadcasts(status) {
			const url = new URL(`${apiBase}/liveBroadcasts`);
			url.searchParams.set('part', 'id,snippet,status');
			url.searchParams.set('broadcastStatus', status);
			url.searchParams.set('broadcastType', 'all');
			url.searchParams.set('maxResults', '5');
			const body = await json('broadcasts', url.toString());
			return (Array.isArray(body?.items) ? body.items : []).map((item: any): Broadcast => ({
				id: String(item.id),
				title: String(item.snippet?.title ?? ''),
				lifeCycleStatus: String(item.status?.lifeCycleStatus ?? ''),
				liveChatId: typeof item.snippet?.liveChatId === 'string' ? item.snippet.liveChatId : null,
				scheduledStartTime: item.snippet?.scheduledStartTime ?? null,
				actualStartTime: item.snippet?.actualStartTime ?? null,
				actualEndTime: item.snippet?.actualEndTime ?? null,
			}));
		},

		async liveDetails(videoId) {
			// The snippet (title) comes at no extra cost: videos.list is 1 unit whatever parts it returns.
			const body = await json('videos', `${apiBase}/videos?part=liveStreamingDetails,snippet&id=${encodeURIComponent(videoId)}`);
			const details = body?.items?.[0]?.liveStreamingDetails;
			if (!details) return null;
			return {
				videoId,
				title: String(body.items[0].snippet?.title ?? ''),
				concurrentViewers: toNumber(details.concurrentViewers),
				activeLiveChatId: typeof details.activeLiveChatId === 'string' ? details.activeLiveChatId : null,
				actualStartTime: details.actualStartTime ?? null,
				actualEndTime: details.actualEndTime ?? null,
			};
		},

		async listMessages(liveChatId, pageToken) {
			const url = new URL(`${apiBase}/liveChat/messages`);
			url.searchParams.set('liveChatId', liveChatId);
			url.searchParams.set('part', 'id,snippet,authorDetails');
			url.searchParams.set('maxResults', '200');
			if (pageToken) url.searchParams.set('pageToken', pageToken);
			return toPage(await json('listMessages', url.toString()));
		},

		async streamMessages(liveChatId, pageToken, onPage, signal) {
			const url = new URL(`${streamBase}/liveChat/messages/stream`);
			url.searchParams.set('liveChatId', liveChatId);
			url.searchParams.set('part', 'id,snippet,authorDetails');
			if (pageToken) url.searchParams.set('pageToken', pageToken);
			// No timeout: the connection is meant to stay open. `signal` ends it.
			const response = await request('streamMessages', url.toString(), { signal }, null);
			if (!response.body) return;
			const parser = new JsonArrayStreamParser();
			const decoder = new TextDecoder();
			try {
				for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
					for (const value of parser.push(decoder.decode(chunk, { stream: true }))) {
						const item = value as any;
						// An error can also arrive inside the stream.
						if (item?.error) throw new YoutubeApiError(classify(Number(item.error.code) || 500, item.error.errors?.[0]?.reason ?? ''), Number(item.error.code) || 500, item.error.errors?.[0]?.reason ?? '', item.error.message ?? 'Stream error.');
						await onPage(toPage(item));
					}
				}
			} catch (error) {
				if (signal.aborted) return;
				throw errorFromThrown(error);
			}
		},

		async insertMessage(liveChatId, text) {
			const body = await json('insertMessage', `${apiBase}/liveChat/messages?part=snippet`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ snippet: { liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } }),
			});
			return { id: String(body?.id ?? '') };
		},
	};
};
