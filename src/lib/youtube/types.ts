// Shared types for the YouTube live chat integration (see docs/youtube-unified-chat.md). Nothing here imports Astro,
// so the modules that use it run under `node --test` as well as in the site.

/** The Realtime Database, as the sync uses it. Production wraps the REST helper in chat-server.ts; tests use memory. */
export interface Store {
	get<T>(path: string): Promise<T | null>;
	put(path: string, value: unknown): Promise<void>;
	/** Merges `value` into `path`. Keys may be deeper paths (`a/b/c`), which makes it a multi-path update. */
	patch(path: string, value: Record<string, unknown>): Promise<void>;
	remove(path: string): Promise<void>;
	/**
	 * Compare-and-set: `update` gets the current value and returns the new one, or undefined to leave it. Retried when
	 * someone else wrote in between. Resolves to the value that was kept.
	 */
	transaction<T>(path: string, update: (current: T | null) => T | null | undefined): Promise<{ committed: boolean; value: T | null }>;
}

export interface Clock {
	now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface Logger {
	info(message: string, details?: unknown): void;
	warn(message: string, details?: unknown): void;
	error(message: string, details?: unknown): void;
}

export const consoleLogger: Logger = {
	info: (message, details) => console.log(`[youtube] ${message}`, details ?? ''),
	warn: (message, details) => console.warn(`[youtube] ${message}`, details ?? ''),
	error: (message, details) => console.error(`[youtube] ${message}`, details ?? ''),
};

/** Broadcast lifecycle as the site sees it. Firebase chat works the same in every state. */
export type BroadcastState = 'OFFLINE' | 'UPCOMING' | 'LIVE' | 'ENDING' | 'ENDED' | 'ERROR';

/** Delivery of a website message to YouTube. */
export type DeliveryStatus = 'pending' | 'sent' | 'failed';

/** A chat message as stored at chat/rooms/{room}/messages/{key}. The YouTube fields are all optional and new. */
export type StoredChatMessage = {
	u: string;
	n: string;
	p?: string;
	t: string;
	ts: number;
	m?: boolean;
	r?: string;
	/** Where it was written: absent for the website (every older message), 'yt' for YouTube. */
	s?: 'yt';
	/** YouTube messages: the author's YouTube channel id. */
	c?: string;
	/** Website messages sent while YouTube was live: how forwarding went. */
	ys?: DeliveryStatus;
};

/** chat/private/youtube/settings. Both default to on. */
export type SyncSettings = { toYoutube: boolean; fromYoutube: boolean };

/** chat/private/youtube/auth. The refresh token is encrypted (crypto.ts) and never leaves the server. */
export type StoredAuth = {
	refreshToken: string;
	channelId: string;
	channelTitle: string;
	scope: string;
	connectedAt: number;
	connectedBy: string;
	/** 'revoked': Google refused the refresh token; an admin must connect again. */
	status: 'ok' | 'revoked';
};

/** chat/private/youtube/outbox/{messageId}. */
export type OutboxEntry = {
	room: string;
	/** The text as posted to YouTube, prefix and name included. */
	text: string;
	status: DeliveryStatus;
	attempts: number;
	createdAt: number;
	nextAt: number;
	broadcastId: string;
	liveChatId: string;
	ytId?: string;
	error?: string;
	/** Set when a send timed out with no answer: it may have reached YouTube, so the reader looks for it first. */
	uncertainSince?: number;
	sentAt?: number;
};

/** chat/private/youtube/state: the worker's view, read by the admin panel and the chat route. */
export type SyncState = {
	state: BroadcastState;
	broadcastId: string | null;
	videoId: string | null;
	liveChatId: string | null;
	title: string | null;
	/** When this broadcast went live, from YouTube where it says. */
	startedAt: number | null;
	updatedAt: number;
	/** The reader's place in the chat, so a restart carries on instead of re-reading. */
	pageToken: string | null;
	readerMode: 'stream' | 'poll' | null;
	youtubeViewers: number | null;
	youtubeViewersAt: number | null;
	lastError: { at: number; message: string; code?: string } | null;
	/** Quota units used, by Pacific day (YouTube's quota day), as this worker counts them. */
	quota: { day: string; used: number; exhaustedUntil?: number };
	counts: { sent: number; failed: number; imported: number };
};

/** chat/rooms/{room}/meta/youtube. Public: the page reads it for the indicators and the viewer counts. */
export type PublicLiveState = {
	state: 'offline' | 'upcoming' | 'live';
	/** True only while messages actually cross over in at least one direction. */
	sync: boolean;
	/** The connected channel the state is about (public anyway), so /api/youtube-live can trust it for that channel. */
	channelId: string | null;
	videoId: string | null;
	youtubeViewers: number | null;
	youtubeViewersAt: number | null;
	websiteViewers: number | null;
	websiteViewersAt: number | null;
	updatedAt: number;
};
