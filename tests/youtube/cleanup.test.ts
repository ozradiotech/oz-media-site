// The daily housekeeping of the YouTube sync's own records (src/lib/youtube/cleanup.ts).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { pruneYoutube, type KeyRange } from '../../src/lib/youtube/cleanup.ts';
import { hashKey } from '../../src/lib/youtube/crypto.ts';
import { paths } from '../../src/lib/youtube/paths.ts';
import { lastKeyAt, timeKey } from '../../src/lib/youtube/push-id.ts';
import { MemoryStore } from './helpers.ts';

const day = 24 * 3_600_000;
const now = Date.parse('2026-11-13T12:00:00Z');
const options = { lifetimeMs: day, batchSize: 2, maxBatches: 10 };

/** What the database's REST API does for orderBy="$key"&endAt=…&limitToFirst=… */
const rangeOf = (store: MemoryStore): KeyRange => async <T,>(path: string, endKey: string, limit: number) => {
	const node = (store.read(path) ?? {}) as Record<string, T>;
	const keys = Object.keys(node).filter((key) => key <= endKey).sort().slice(0, limit);
	return keys.length ? Object.fromEntries(keys.map((key) => [key, node[key]])) : null;
};

describe('YouTube sync housekeeping', () => {
	test('keys sort by time, so a key range finds everything older than the cut-off', () => {
		const cutoff = now - day;
		assert.ok(timeKey(cutoff - 1, 'old') <= lastKeyAt(cutoff));
		assert.ok(timeKey(cutoff + 1_000, 'new') > lastKeyAt(cutoff));
	});

	test('old outbox entries go with their queue place and sent marker; recent ones stay', async () => {
		const store = new MemoryStore();
		const old = [1, 2, 3].map((n) => timeKey(now - 2 * day - n * 60_000, `old-${n}`));
		const recent = timeKey(now - 3_600_000, 'recent');
		for (const [index, id] of [...old, recent].entries()) {
			await store.put(`${paths.outbox}/${id}`, { status: 'sent', ytId: `LCC.yt-${index}`, createdAt: 0 });
			await store.put(`${paths.sent}/${hashKey(`LCC.yt-${index}`)}`, id);
			await store.put(`${paths.queue}/${id}`, 1);
		}
		const removed = await pruneYoutube(store, rangeOf(store), now, options);
		assert.equal(removed.outbox, 3, 'in several batches');
		assert.deepEqual(Object.keys(store.read(paths.outbox) as object), [recent]);
		assert.deepEqual(Object.values(store.read(paths.sent) as object), [recent]);
		assert.deepEqual(Object.keys(store.read(paths.queue) as object), [recent]);
	});

	test('old imported markers go; recent ones stay', async () => {
		const store = new MemoryStore();
		const old = timeKey(now - 2 * day, 'yt-old');
		const recent = timeKey(now - 60_000, 'yt-new');
		await store.patch(paths.imported, { [old]: 1, [recent]: 2 });
		const removed = await pruneYoutube(store, rangeOf(store), now, options);
		assert.equal(removed.imported, 1);
		assert.deepEqual(Object.keys(store.read(paths.imported) as object), [recent]);
	});

	test('expired sign-in states and viewer sessions go; live ones stay', async () => {
		const store = new MemoryStore();
		await store.patch(paths.oauthStates, { gone: { expiresAt: now - 1 }, broken: {}, live: { expiresAt: now + 60_000 } });
		await store.patch(paths.viewers, { quiet: now - 1, playing: now + 30_000 });
		const removed = await pruneYoutube(store, rangeOf(store), now, options);
		assert.deepEqual([removed.oauthStates, removed.viewers], [2, 1]);
		assert.deepEqual(Object.keys(store.read(paths.oauthStates) as object), ['live']);
		assert.deepEqual(Object.keys(store.read(paths.viewers) as object), ['playing']);
	});

	test('nothing to do: nothing written', async () => {
		const store = new MemoryStore();
		const removed = await pruneYoutube(store, rangeOf(store), now, options);
		assert.deepEqual(removed, { outbox: 0, imported: 0, oauthStates: 0, viewers: 0 });
		assert.equal(store.writes, 0);
	});
});
