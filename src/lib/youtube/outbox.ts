// Website → YouTube. /api/chat saves a message as before and, while forwarding is on, adds it to the queue here; the
// sync worker posts it to YouTube as the OZ channel. The chat never waits on YouTube.
import { YoutubeApiError, type YoutubeApi } from './api.ts';
import { hashKey } from './crypto.ts';
import { formatForYoutube, isWebsiteEcho, websitePrefix, youtubeMaxLength } from './normalize.ts';
import { paths } from './paths.ts';
import type { QuotaTracker } from './quota.ts';
import type { SaverTuning } from './saver.ts';
import type { Clock, Logger, OutboxEntry, StoredAuth, Store, SyncSettings, SyncState } from './types.ts';

export const defaultSettings: SyncSettings = { toYoutube: true, fromYoutube: true, autoSaver: true, saver: false };

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
export const enqueue = (store: Store, now: number, input: { messageId: string; room: string; name: string; text: string; target: ForwardingTarget; moderator?: boolean }) => {
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
	if (input.moderator) entry.moderator = true;
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
	/** The quota saver's current tuning (src/lib/youtube/saver.ts). */
	tuning(): SaverTuning;
	/** Posts that timed out, by their text, so the reader can tell they arrived: text → the message ids in it. */
	uncertain: Map<string, { ids: string[]; at: number }>;
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
	ctx.uncertain.clear();
};

/** The reader saw one of our own messages: if it is a post that timed out, it did arrive (every message in it). */
export const reconcileEcho = async (ctx: OutboxContext, ytId: string, text: string) => {
	const posted = ctx.uncertain.get(text);
	if (!posted) return false;
	ctx.uncertain.delete(text);
	let matched = false;
	for (const messageId of posted.ids) {
		const entry = await ctx.store.get<OutboxEntry>(`${paths.outbox}/${messageId}`);
		if (!entry || entry.status !== 'pending') continue;
		await markSent(ctx, messageId, entry, ytId);
		matched = true;
	}
	return matched;
};

export const bundleSeparator = ' · ';

/** One message's part of a bundle: "Bran: hi". */
const part = (entry: OutboxEntry) => (isWebsiteEcho(entry.text) ? entry.text.slice(websitePrefix.length) : entry.text);

/**
 * Website messages that are ready together go to YouTube as one message, `[Website] Bran: hi · Sari: halo`, up to
 * YouTube's 200 characters; a message on its own is posted unchanged. Each post costs the same quota however many
 * messages it carries. Oldest first; a message is never split.
 */
export const bundle = <T extends { entry: OutboxEntry }>(ready: T[]) => {
	const bundles: { text: string; items: T[] }[] = [];
	for (const item of ready) {
		const last = bundles.at(-1);
		const joined = last ? `${last.text}${bundleSeparator}${part(item.entry)}` : '';
		if (last && [...joined].length <= youtubeMaxLength) {
			last.text = joined;
			last.items.push(item);
		} else {
			bundles.push({ text: item.entry.text, items: [item] });
		}
	}
	return bundles;
};

/**
 * Sends what is due. Returns whether anything is still waiting. Never throws for a single message's problem.
 * Messages wait up to the quota saver's bundle window (src/lib/youtube/saver.ts) for others to share a post with.
 */
export const processOutbox = async (ctx: OutboxContext): Promise<boolean> => {
	const queue = await ctx.store.get<Record<string, number>>(paths.queue);
	const due = Object.entries(queue ?? {}).sort(([, a], [, b]) => a - b);
	const tuning = ctx.tuning();
	let waiting = false;
	const ready: { messageId: string; entry: OutboxEntry }[] = [];

	// Timed-out posts that were never seen again: nothing more to match them with.
	for (const [text, posted] of ctx.uncertain) if (ctx.clock.now() - posted.at > ctx.config.staleAfterMs) ctx.uncertain.delete(text);

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
		// Strict quota saving: only moderators' messages are worth the quota.
		if (tuning.moderatorsOnly && !entry.moderator) {
			await markFailed(ctx, messageId, entry, 'quota_saver');
			continue;
		}
		// Deleted by a moderator (or its author banned) while it waited: it doesn't go to YouTube.
		if (!(await ctx.store.get<string>(`${paths.messages(entry.room)}/${messageId}/u`))) {
			await markFailed(ctx, messageId, entry, 'removed');
			continue;
		}
		ready.push({ messageId, entry });
	}

	if (!ready.length) return waiting;
	// Nothing has waited out the bundle window yet (retries go at once): more messages may still join.
	const now = ctx.clock.now();
	if (!ready.some(({ entry }) => entry.attempts > 0 || now - entry.createdAt >= tuning.bundleWindowMs)) return true;

	for (const post of bundle(ready.sort((a, b) => a.entry.createdAt - b.entry.createdAt))) {
		const ids = post.items.map(({ messageId }) => messageId);
		const at = ctx.clock.now();
		if (!ctx.quota.canSpend('insertMessage', at, ctx.config.quotaReserve)) {
			for (const { messageId, entry } of post.items) await markFailed(ctx, messageId, entry, 'quota');
			continue;
		}
		if (!ctx.limiter.tryTake(at)) {
			// Over the per-minute limit: try again shortly. Stale messages drop out above.
			await ctx.store.patch('', Object.fromEntries(ids.map((id) => [`${paths.queue}/${id}`, at + 5_000])));
			waiting = true;
			continue;
		}

		const items = post.items.map(({ messageId, entry }) => ({ messageId, entry: { ...entry, attempts: entry.attempts + 1 } }));
		try {
			const { id } = await ctx.api.insertMessage(items[0].entry.liveChatId, post.text);
			if (!id) throw new YoutubeApiError('transient', 0, 'no_id', 'YouTube did not return a message id.');
			for (const { messageId, entry } of items) await markSent(ctx, messageId, entry, id);
		} catch (thrown) {
			const error = thrown instanceof YoutubeApiError ? thrown : new YoutubeApiError('transient', 0, 'unknown', String(thrown));
			ctx.log.warn(`Posting ${ids.length} message(s) to YouTube failed (${error.kind}: ${error.reason || error.message}).`);
			const failAll = async (reason: string) => {
				for (const { messageId, entry } of items) await markFailed(ctx, messageId, entry, reason);
			};
			if (error.kind === 'quota') {
				ctx.quota.exhaust(ctx.clock.now());
				ctx.onQuotaExhausted();
				await failAll('quota');
				await failAllPending(ctx, 'quota');
				return false;
			}
			if (error.kind === 'auth_revoked') {
				ctx.onAuthRevoked(error);
				await failAll('auth');
				await failAllPending(ctx, 'auth');
				return false;
			}
			if (error.kind === 'chat_gone') {
				await failAll(error.reason || 'chat_gone');
				ctx.onChatGone();
				continue;
			}
			const attempts = Math.max(...items.map(({ entry }) => entry.attempts));
			if (error.kind === 'permanent' || attempts >= ctx.config.maxAttempts) {
				await failAll(error.reason || error.kind);
				continue;
			}
			// Timed out: it may have gone through. Wait for the reader to see it before posting again.
			const uncertain = error.kind === 'timeout';
			if (uncertain) ctx.uncertain.set(post.text, { ids, at: ctx.clock.now() });
			const retryAt = ctx.clock.now() + (uncertain ? ctx.config.uncertainWaitMs : backoff(attempts));
			const writes: Record<string, unknown> = {};
			for (const { messageId, entry } of items) {
				writes[`${paths.outbox}/${messageId}/attempts`] = entry.attempts;
				writes[`${paths.outbox}/${messageId}/nextAt`] = retryAt;
				writes[`${paths.outbox}/${messageId}/error`] = error.reason || error.kind;
				writes[`${paths.outbox}/${messageId}/uncertainSince`] = uncertain ? ctx.clock.now() : null;
				writes[`${paths.queue}/${messageId}`] = retryAt;
			}
			await ctx.store.patch('', writes);
			waiting = true;
		}
	}
	return waiting;
};
