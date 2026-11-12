// Server only. Connects the YouTube sync (src/lib/youtube/*) to this site: settings from .env, the Realtime Database
// through chat-server.ts, the CMS for the livestream history, and one worker per process (started by
// src/middleware.ts). Nothing here runs unless the integration is configured.
import { hostname } from 'node:os';
import {
	LIVESTREAM_SNAPSHOT_INTERVAL,
	WEBSITE_VIEWER_HEARTBEAT_INTERVAL,
	WEBSITE_VIEWER_SESSION_TTL,
	YOUTUBE_BROADCAST_CHECK_INTERVAL,
	YOUTUBE_CHANNEL_ID,
	YOUTUBE_CHAT_POLL_MIN_INTERVAL,
	YOUTUBE_CLIENT_ID,
	YOUTUBE_CLIENT_SECRET,
	YOUTUBE_DAILY_QUOTA,
	YOUTUBE_OUTBOUND_PER_MINUTE,
	YOUTUBE_REDIRECT_URI,
	YOUTUBE_SYNC,
	YOUTUBE_TOKEN_ENCRYPTION_KEY,
	YOUTUBE_VIEWER_COUNT_REFRESH_INTERVAL,
} from 'astro:env/server';
import { db, dbTransaction, getBlocklist, isChatServerConfigured } from '../chat-server';
import { cmsRequest } from '../cms';
import { createYoutubeApi, type OAuthConfig } from './api.ts';
import { createCredentials, type Credentials } from './credentials.ts';
import { parseEncryptionKey, randomToken } from './crypto.ts';
import { enqueue, forwardingTarget, type ForwardingTarget } from './outbox.ts';
import { createPageCheck } from './page-check.ts';
import { youtubeRoom } from './paths.ts';
import type { AnalyticsStore, BroadcastDoc, SnapshotDoc } from './snapshots.ts';
import { YoutubeSync } from './sync.ts';
import { consoleLogger, systemClock, type PublicLiveState, type Store } from './types.ts';
import { AddressLimiter, type ViewerConfig } from './viewers.ts';

/** The Realtime Database through the service account's REST helper. */
export const firebaseStore: Store = {
	get: <T>(path: string) => db<T | null>('GET', path),
	put: async (path, value) => {
		await db('PUT', path, value);
	},
	patch: async (path, value) => {
		await db('PATCH', path, value);
	},
	remove: async (path) => {
		await db('DELETE', path);
	},
	transaction: dbTransaction,
};

const encryptionKey = (() => {
	if (!YOUTUBE_TOKEN_ENCRYPTION_KEY) return null;
	try {
		return parseEncryptionKey(YOUTUBE_TOKEN_ENCRYPTION_KEY);
	} catch (error) {
		console.error('[youtube]', error instanceof Error ? error.message : error);
		return null;
	}
})();

/** Everything the integration needs is set, and it isn't switched off. */
export const isYoutubeConfigured = YOUTUBE_SYNC !== 'off' && isChatServerConfigured &&
	Boolean(YOUTUBE_CLIENT_ID && YOUTUBE_CLIENT_SECRET && encryptionKey);

// Google must see exactly the address registered in the OAuth client, so it comes from SITE_URL, never from the request
// (behind the proxy that would be 127.0.0.1).
export const oauthConfig = (): OAuthConfig => ({
	clientId: YOUTUBE_CLIENT_ID ?? '',
	clientSecret: YOUTUBE_CLIENT_SECRET ?? '',
	redirectUri: YOUTUBE_REDIRECT_URI || new URL('/api/youtube/callback', import.meta.env.SITE).toString(),
});

/** The httpOnly cookie that ties an OAuth consent to the browser that started it, and how long it lasts. */
export const oauthCookie = 'oz_youtube_oauth';
export const oauthStateLifetime = 10 * 60_000;

export const getEncryptionKey = () => {
	if (!encryptionKey) throw new Error('YOUTUBE_TOKEN_ENCRYPTION_KEY is not set.');
	return encryptionKey;
};

/** If set, only this channel may be connected. */
export const requiredChannelId = YOUTUBE_CHANNEL_ID?.trim() || null;

export const viewerConfig: ViewerConfig = {
	heartbeatMs: WEBSITE_VIEWER_HEARTBEAT_INTERVAL * 1000,
	ttlMs: WEBSITE_VIEWER_SESSION_TTL * 1000,
	maxSessionsPerAddress: 3,
};
export const addressLimiter = new AddressLimiter(viewerConfig.maxSessionsPerAddress);

// ---------- CMS (Postgres) history ----------

type Docs<T> = { docs: T[] };

export const cmsAnalytics: AnalyticsStore = {
	async findBroadcast(broadcastId) {
		const { docs } = await cmsRequest<Docs<BroadcastDoc>>('GET', `livestream-broadcasts?where[broadcastId][equals]=${encodeURIComponent(broadcastId)}&limit=1&depth=0`);
		return docs[0] ?? null;
	},
	async createBroadcast(data) {
		return (await cmsRequest<{ doc: BroadcastDoc }>('POST', 'livestream-broadcasts', data)).doc;
	},
	async updateBroadcast(id, data) {
		return (await cmsRequest<{ doc: BroadcastDoc }>('PATCH', `livestream-broadcasts/${id}`, data)).doc;
	},
	async latestSnapshot(broadcast) {
		const { docs } = await cmsRequest<Docs<SnapshotDoc>>('GET', `livestream-snapshots?where[broadcast][equals]=${broadcast}&sort=-recordedAt&limit=1&depth=0`);
		return docs[0] ?? null;
	},
	async createSnapshot(data) {
		return cmsRequest('POST', 'livestream-snapshots', data);
	},
};

// ---------- The worker ----------

type Runtime = { sync: YoutubeSync; credentials: Credentials };
// Kept on globalThis so the dev server's module reloads don't start a second worker.
const globalKey = Symbol.for('oz.youtube.runtime');
const holder = globalThis as unknown as { [globalKey]?: Runtime };

const createRuntime = (): Runtime => {
	const credentials = createCredentials({ store: firebaseStore, oauth: oauthConfig(), encryptionKey: getEncryptionKey(), clock: systemClock });
	const sync = new YoutubeSync({
		store: firebaseStore,
		clock: systemClock,
		log: consoleLogger,
		api: createYoutubeApi({ accessToken: credentials.accessToken }),
		blocklist: getBlocklist,
		analytics: cmsAnalytics,
		ownerId: `${hostname()}:${process.pid}:${randomToken(6)}`,
		resetCredentials: credentials.reset,
		pageCheck: createPageCheck(),
	}, {
		room: youtubeRoom,
		broadcastCheckMs: YOUTUBE_BROADCAST_CHECK_INTERVAL * 1000,
		viewerRefreshMs: YOUTUBE_VIEWER_COUNT_REFRESH_INTERVAL * 1000,
		websiteViewersMs: 15_000,
		snapshotMs: LIVESTREAM_SNAPSHOT_INTERVAL * 1000,
		outboxMs: 2_000,
		leaseMs: 45_000,
		dailyQuota: YOUTUBE_DAILY_QUOTA,
		outboundPerMinute: YOUTUBE_OUTBOUND_PER_MINUTE,
		backlogMs: 2 * 60_000,
		pollMinMs: YOUTUBE_CHAT_POLL_MIN_INTERVAL * 1000,
		outbox: { maxAttempts: 5, staleAfterMs: 2 * 60_000, uncertainWaitMs: 20_000, quotaReserve: 500 },
	});
	return { sync, credentials };
};

/** The worker, started on first use. Undefined when the integration isn't configured. */
export const youtubeRuntime = (): Runtime | undefined => {
	if (!isYoutubeConfigured) return undefined;
	if (!holder[globalKey]) {
		holder[globalKey] = createRuntime();
		holder[globalKey].sync.start();
		const stop = () => void holder[globalKey]?.sync.stop();
		process.once('SIGTERM', stop);
		process.once('SIGINT', stop);
	}
	return holder[globalKey];
};

// ---------- Cached reads for the request handlers ----------

let targetCache: { at: number; value: Promise<ForwardingTarget | null> } | undefined;

/**
 * Where a website message sent now should go on YouTube, or null (not live, switched off, not configured). Cached for
 * 3 seconds; any problem reading it means null, so the chat never waits on or fails because of YouTube.
 */
export const youtubeForwardingTarget = () => {
	if (!isYoutubeConfigured) return Promise.resolve(null);
	if (targetCache && Date.now() - targetCache.at < 3_000) return targetCache.value;
	const value = forwardingTarget(firebaseStore, Date.now()).catch(() => null);
	targetCache = { at: Date.now(), value };
	return value;
};

/** Queues a saved website message for YouTube and nudges the worker. */
export const queueForYoutube = async (input: { messageId: string; room: string; name: string; text: string; target: ForwardingTarget; moderator?: boolean }) => {
	await enqueue(firebaseStore, Date.now(), input);
	youtubeRuntime()?.sync.kickOutbox();
};

let liveCache: { at: number; value: Promise<PublicLiveState | null> } | undefined;

/** The public live state (offline/live, both viewer counts), cached for 5 seconds. */
export const publicLiveState = () => {
	if (liveCache && Date.now() - liveCache.at < 5_000) return liveCache.value;
	const value = firebaseStore.get<PublicLiveState>(`chat/rooms/${youtubeRoom}/meta/youtube`).catch(() => null);
	liveCache = { at: Date.now(), value };
	return value;
};

/** Whether YouTube is live now. Heartbeats only count while it is. */
export const isLiveNow = async () => (await publicLiveState())?.state === 'live';
