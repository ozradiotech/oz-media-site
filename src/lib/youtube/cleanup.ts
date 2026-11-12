// Daily housekeeping for the YouTube sync's own records, run by /api/chat-cleanup with the chat's. Without it they would
// only grow. Chat messages themselves are removed after a day by the same job, and these records are only needed while
// a message could still come back from YouTube (a few minutes), so a day is plenty.
//
// No database index is needed: outbox entries are keyed by the website message's push id and imported markers by a
// push-id-shaped key (push-id.ts), and both start with the time, so old ones are a range of keys. The `sent` markers
// (keyed by a hash of the YouTube id) go with their outbox entry, which holds that id.
import { hashKey } from './crypto.ts';
import { paths } from './paths.ts';
import { lastKeyAt } from './push-id.ts';
import type { OutboxEntry, Store } from './types.ts';

/** Up to `limit` children of `path` whose key sorts at or before `endKey`, oldest first. */
export type KeyRange = <T>(path: string, endKey: string, limit: number) => Promise<Record<string, T> | null>;

export type CleanupOptions = { lifetimeMs: number; batchSize: number; maxBatches: number };

export const pruneYoutube = async (store: Store, range: KeyRange, now: number, options: CleanupOptions) => {
	const endKey = lastKeyAt(now - options.lifetimeMs);
	const removed = { outbox: 0, imported: 0, oauthStates: 0, viewers: 0 };

	// Outgoing messages, with their place in the queue and the marker of the YouTube message they became.
	for (let batch = 0; batch < options.maxBatches; batch++) {
		const old = (await range<OutboxEntry>(paths.outbox, endKey, options.batchSize)) ?? {};
		const entries = Object.entries(old);
		if (!entries.length) break;
		const writes: Record<string, null> = {};
		for (const [messageId, entry] of entries) {
			writes[`${paths.outbox}/${messageId}`] = null;
			writes[`${paths.queue}/${messageId}`] = null;
			if (entry?.ytId) writes[`${paths.sent}/${hashKey(entry.ytId)}`] = null;
		}
		await store.patch('', writes);
		removed.outbox += entries.length;
		if (entries.length < options.batchSize) break;
	}

	// Markers of YouTube messages already copied in.
	for (let batch = 0; batch < options.maxBatches; batch++) {
		const old = (await range<number>(paths.imported, endKey, options.batchSize)) ?? {};
		const keys = Object.keys(old);
		if (!keys.length) break;
		await store.patch(paths.imported, Object.fromEntries(keys.map((key) => [key, null])));
		removed.imported += keys.length;
		if (keys.length < options.batchSize) break;
	}

	// Sign-ins to Google that were started and never finished (each lives ten minutes).
	const states = (await store.get<Record<string, { expiresAt?: number }>>(paths.oauthStates)) ?? {};
	const expiredStates = Object.keys(states).filter((key) => !(states[key]?.expiresAt && states[key].expiresAt! > now));
	if (expiredStates.length) await store.patch(paths.oauthStates, Object.fromEntries(expiredStates.map((key) => [key, null])));
	removed.oauthStates = expiredStates.length;

	// Website viewer sessions that stopped reporting (the worker clears these too, but only while it runs).
	const viewers = (await store.get<Record<string, number>>(paths.viewers)) ?? {};
	const expiredViewers = Object.keys(viewers).filter((key) => !(typeof viewers[key] === 'number' && viewers[key] > now));
	if (expiredViewers.length) await store.patch(paths.viewers, Object.fromEntries(expiredViewers.map((key) => [key, null])));
	removed.viewers = expiredViewers.length;

	return removed;
};
