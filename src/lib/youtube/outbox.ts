// Website → YouTube. /api/chat saves a message as before and, while forwarding is on, adds it to the queue here; the
// sync worker posts it to YouTube as the OZ channel. The chat never waits on YouTube.
import { YoutubeApiError, type YoutubeApi } from './api.ts';
import { hashKey } from './crypto.ts';
import { formatForYoutube } from './normalize.ts';
import { paths } from './paths.ts';
import type { QuotaTracker } from './quota.ts';
import type { Clock, Logger, OutboxEntry, StoredAuth, Store, SyncSettings, SyncState } from './types.ts';

export const defaultSettings: SyncSettings = { toYoutube: true, fromYoutube: true };

export const readSettings = async (store: Store): Promise<SyncSettings> => ({
	...defaultSettings,
	...(await store.get<Partial<SyncSettings>>(paths.settings)),
});

export type ForwardingTarget = { broadcastId: string; liveChatId: string };

/** Where a new website message should go on YouTube, or null when it shouldn't (offline, switched off, not connected). */
export const forwardingTarget = async (store: Store, now: number): Promise<ForwardingTarget | null> => {
	const [state, settings, auth] = await Promise.all([
		store.get<SyncState>(paths.state),
		readSettings(store),
		store.get<Pick<StoredAuth, 'status'>>(paths.auth),
	]);
	if (!state || state.state !== 'LIVE' || !state.liveChatId || !state.broadcastId) return null;
	if (!settings.toYoutube || auth?.status !== 'ok') return null;
	if (state.quota?.exhaustedUntil && state.quota.exhaustedUntil > now) return null;
	return { broadcastId: state.broadcastId, liveChatId: state.liveChatId };
};

/** Queues a saved website message for YouTube. One multi-path write, keyed by the message id, so it can't be doubled. */
export const enqueue = (store: Store, now: number, input: { messageId: string; room: string; name: string; text: string; target: ForwardingTarget }) => {
	const entry: OutboxEntry = {
		room: input.room,
		text: formatForYoutube(input.name, input.text),
		status: 'pending',
		attempts: 0,
		createdAt: now,
		nextAt: now,
		broadcastId: input.target.broadcastId,
		liveChatId: input.target.liveChatId,
	};
	return store.patch('', {
		[`${paths.outbox}/${input.messageId}`]: entry,
		[`${paths.queue}/${input.messageId}`]: now,
	});
};

/** At most `limit` posts in any minute, across the whole site. */
export class RateLimiter {
	private readonly times: number[] = [];
	private readonly limit: number;
	constructor(limit: number) {
		this.limit = limit;
	}
	tryTake(now: number) {
		while (this.times.length && this.times[0] <= now - 60_000) this.times.shift();
		if (this.times.length >= this.limit) return false;
		this.times.push(now);
		return true;
	}
}

export type OutboxConfig = {
	maxAttempts: number;
	/** Chat moves on: a message still unsent after this long is dropped rather than posted late. */
	staleAfterMs: number;
	/** After a send timed out, how long to wait for its echo before trying again. */
	uncertainWaitMs: number;
	/** Quota kept back for detection and reading the chat. */
	quotaReserve: number;
};

export type OutboxContext = {
	store: Store;
	clock: Clock;
	log: Logger;
	api: YoutubeApi;
	quota: QuotaTracker;
	limiter: RateLimiter;
	config: OutboxConfig;
	/** The chat currently synced, or null. */
	live(): ForwardingTarget | null;
	settings(): SyncSettings;
	/** Texts of sends that timed out, so the reader can tell they arrived: text → message id. */
	uncertain: Map<string, string>;
	/** YouTube ids the site posted (hashed), so the reader skips them without asking the database. */
	sentIds: Set<string>;
	counts: { sent: number; failed: number };
	onChatGone(): void;
	onAuthRevoked(error: YoutubeApiError): void;
	onQuotaExhausted(): void;
};

export const backoff = (attempts: number) => Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));

/** Updates the public message's status, unless a moderator has deleted it meanwhile (a write would bring back a stub). */
const setMessageStatus = async (ctx: OutboxContext, room: string, messageId: string, status: 'sent' | 'failed') => {
	const author = await ctx.store.get<string>(`${paths.messages(room)}/${messageId}/u`);
	if (author) await ctx.store.patch(`${paths.messages(room)}/${messageId}`, { ys: status });
};

export const markSent = async (ctx: OutboxContext, messageId: string, entry: OutboxEntry, ytId: string) => {
	const now = ctx.clock.now();
	const hashed = hashKey(ytId);
	ctx.sentIds.add(hashed);
	ctx.uncertain.delete(entry.text);
	await ctx.store.patch('', {
		[`${paths.outbox}/${messageId}/status`]: 'sent',
		[`${paths.outbox}/${messageId}/ytId`]: ytId,
		[`${paths.outbox}/${messageId}/sentAt`]: now,
		[`${paths.outbox}/${messageId}/uncertainSince`]: null,
		[`${paths.outbox}/${messageId}/error`]: null,
		[`${paths.sent}/${hashed}`]: messageId,
		[`${paths.queue}/${messageId}`]: null,
	});
	ctx.counts.sent++;
	await setMessageStatus(ctx, entry.room, messageId, 'sent');
};

export const markFailed = async (ctx: OutboxContext, messageId: string, entry: OutboxEntry, error: string) => {
	ctx.uncertain.delete(entry.text);
	await ctx.store.patch('', {
		[`${paths.outbox}/${messageId}/status`]: 'failed',
		[`${paths.outbox}/${messageId}/error`]: error,
		[`${paths.outbox}/${messageId}/attempts`]: entry.attempts,
		[`${paths.queue}/${messageId}`]: null,
	});
	ctx.counts.failed++;
	await setMessageStatus(ctx, entry.room, messageId, 'failed');
};

/** Gives up on everything still queued, e.g. when the broadcast ends or the quota runs out. */
export const failAllPending = async (ctx: OutboxContext, error: string) => {
	const queue = await ctx.store.get<Record<string, number>>(paths.queue);
	for (const messageId of Object.keys(queue ?? {})) {
		const entry = await ctx.store.get<OutboxEntry>(`${paths.outbox}/${messageId}`);
		if (entry && entry.status === 'pending') await markFailed(ctx, messageId, entry, error);
		else await ctx.store.patch('', { [`${paths.queue}/${messageId}`]: null });
	}
};

/** The reader saw one of our own messages: if it is a send that timed out, it did arrive. */
export const reconcileEcho = async (ctx: OutboxContext, ytId: string, text: string) => {
	const messageId = ctx.uncertain.get(text);
	if (!messageId) return false;
	const entry = await ctx.store.get<OutboxEntry>(`${paths.outbox}/${messageId}`);
	if (!entry || entry.status !== 'pending') {
		ctx.uncertain.delete(text);
		return false;
	}
	await markSent(ctx, messageId, entry, ytId);
	return true;
};

/** Sends what is due. Returns whether anything is still waiting. Never throws for a single message's problem. */
export const processOutbox = async (ctx: OutboxContext): Promise<boolean> => {
	const queue = await ctx.store.get<Record<string, number>>(paths.queue);
	const due = Object.entries(queue ?? {}).sort(([, a], [, b]) => a - b);
	let waiting = false;

	for (const [messageId, nextAt] of due) {
		const now = ctx.clock.now();
		if (nextAt > now) {
			waiting = true;
			continue;
		}
		const entry = await ctx.store.get<OutboxEntry>(`${paths.outbox}/${messageId}`);
		if (!entry || entry.status !== 'pending') {
			await ctx.store.patch('', { [`${paths.queue}/${messageId}`]: null });
			continue;
		}
		const live = ctx.live();
		if (!live || live.liveChatId !== entry.liveChatId) {
			await markFailed(ctx, messageId, entry, 'broadcast_ended');
			continue;
		}
		if (!ctx.settings().toYoutube) {
			await markFailed(ctx, messageId, entry, 'forwarding_off');
			continue;
		}
		if (now - entry.createdAt > ctx.config.staleAfterMs) {
			await markFailed(ctx, messageId, entry, 'stale');
			continue;
		}
		// Deleted by a moderator (or its author banned) while it waited: it doesn't go to YouTube.
		if (!(await ctx.store.get<string>(`${paths.messages(entry.room)}/${messageId}/u`))) {
			await markFailed(ctx, messageId, entry, 'removed');
			continue;
		}
		if (!ctx.quota.canSpend('insertMessage', now, ctx.config.quotaReserve)) {
			await markFailed(ctx, messageId, entry, 'quota');
			continue;
		}
		if (!ctx.limiter.tryTake(now)) {
			// Over the per-minute limit: try again shortly. Stale messages drop out above.
			await ctx.store.patch('', { [`${paths.queue}/${messageId}`]: now + 5_000 });
			waiting = true;
			continue;
		}

		const attempts = entry.attempts + 1;
		try {
			const { id } = await ctx.api.insertMessage(entry.liveChatId, entry.text);
			if (!id) throw new YoutubeApiError('transient', 0, 'no_id', 'YouTube did not return a message id.');
			await markSent(ctx, messageId, { ...entry, attempts }, id);
		} catch (thrown) {
			const error = thrown instanceof YoutubeApiError ? thrown : new YoutubeApiError('transient', 0, 'unknown', String(thrown));
			ctx.log.warn(`Sending ${messageId} to YouTube failed (${error.kind}: ${error.reason || error.message}).`);
			const failed = { ...entry, attempts };
			if (error.kind === 'quota') {
				ctx.quota.exhaust(ctx.clock.now());
				ctx.onQuotaExhausted();
				await markFailed(ctx, messageId, failed, 'quota');
				await failAllPending(ctx, 'quota');
				return false;
			}
			if (error.kind === 'auth_revoked') {
				ctx.onAuthRevoked(error);
				await markFailed(ctx, messageId, failed, 'auth');
				await failAllPending(ctx, 'auth');
				return false;
			}
			if (error.kind === 'chat_gone') {
				await markFailed(ctx, messageId, failed, error.reason || 'chat_gone');
				ctx.onChatGone();
				continue;
			}
			if (error.kind === 'permanent' || attempts >= ctx.config.maxAttempts) {
				await markFailed(ctx, messageId, failed, error.reason || error.kind);
				continue;
			}
			// Timed out: it may have gone through. Wait for the reader to see it before sending it again.
			const uncertain = error.kind === 'timeout';
			if (uncertain) ctx.uncertain.set(entry.text, messageId);
			const retryAt = ctx.clock.now() + (uncertain ? ctx.config.uncertainWaitMs : backoff(attempts));
			await ctx.store.patch('', {
				[`${paths.outbox}/${messageId}/attempts`]: attempts,
				[`${paths.outbox}/${messageId}/nextAt`]: retryAt,
				[`${paths.outbox}/${messageId}/error`]: error.reason || error.kind,
				[`${paths.outbox}/${messageId}/uncertainSince`]: uncertain ? ctx.clock.now() : null,
				[`${paths.queue}/${messageId}`]: retryAt,
			});
			waiting = true;
		}
	}
	return waiting;
};
