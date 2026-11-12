// Saving YouTube quota: bundled website messages, free broadcast detection, and the quota saver's levels.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { YoutubeApiError } from '../../src/lib/youtube/api.ts';
import { enqueue, forwardingTarget } from '../../src/lib/youtube/outbox.ts';
import { parseLivePage, type PageStatus } from '../../src/lib/youtube/page-check.ts';
import { paths } from '../../src/lib/youtube/paths.ts';
import { saverLevel, saverTuning } from '../../src/lib/youtube/saver.ts';
import type { OutboxEntry } from '../../src/lib/youtube/types.ts';
import { chatItem, liveBroadcast, liveDetails, ownChannel, page, saveWebsiteMessage, setup } from './helpers.ts';

const room = 'bandung';
type Context = Awaited<ReturnType<typeof setup>>;

const goLive = async (context: Context) => {
	context.youtube.active = [liveBroadcast()];
	context.youtube.details.set('vid00000001', liveDetails());
	await context.sync.checkBroadcast();
};

/** A website message as /api/chat saves and queues it, without moving the clock. */
const send = async (context: Context, id: string, text: string, options: { name?: string; moderator?: boolean } = {}) => {
	const target = await forwardingTarget(context.store, context.clock.now());
	assert.ok(target, 'forwarding should be on');
	await saveWebsiteMessage(context.store, id, text, options.name ?? 'Bran', 'pending');
	await enqueue(context.store, context.clock.now(), { messageId: id, room, name: options.name ?? 'Bran', text, target, moderator: options.moderator });
};

const status = async (context: Context, id: string) => (await context.store.get<OutboxEntry>(`${paths.outbox}/${id}`))?.status;

describe('bundling website messages', () => {
	test('messages that arrive together go to YouTube as one post', async () => {
		const context = await setup();
		await goLive(context);
		await send(context, '-Nb1', 'hi', { name: 'Bran' });
		await send(context, '-Nb2', 'halo semua', { name: 'Sari' });
		await send(context, '-Nb3', 'mantap', { name: 'Dodi' });
		context.clock.advance(2_000);
		await context.sync.processOutboxOnce();
		assert.deepEqual(context.youtube.inserted.map(({ text }) => text), ['[Website] Bran: hi · Sari: halo semua · Dodi: mantap']);
		for (const id of ['-Nb1', '-Nb2', '-Nb3']) assert.equal(await status(context, id), 'sent');
		// Its echo comes back once and is recognised as ours.
		const echo = chatItem(context.youtube.inserted[0].id, context.youtube.inserted[0].text, { channelId: ownChannel });
		assert.equal((await context.sync.handleChatPage(page([echo]), false)).skippedEcho, 1);
	});

	test('a message waits briefly for others, then goes alone and unchanged', async () => {
		const context = await setup();
		await goLive(context);
		await send(context, '-Nw1', 'Hello everyone!');
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 0, 'still inside the bundle window');
		context.clock.advance(2_000);
		await context.sync.processOutboxOnce();
		assert.deepEqual(context.youtube.inserted.map(({ text }) => text), ['[Website] Bran: Hello everyone!']);
	});

	test('posts stay within YouTube\'s 200 characters and never split a message', async () => {
		const context = await setup();
		await goLive(context);
		const long = 'kata '.repeat(25).trim();
		for (const id of ['-Nl1', '-Nl2', '-Nl3']) await send(context, id, `${long} ${id}`);
		context.clock.advance(2_000);
		await context.sync.processOutboxOnce();
		assert.ok(context.youtube.inserted.length >= 2);
		for (const { text } of context.youtube.inserted) assert.ok([...text].length <= 200, text);
		for (const id of ['-Nl1', '-Nl2', '-Nl3']) {
			assert.equal(context.youtube.inserted.filter(({ text }) => text.includes(id)).length, 1, `${id} posted exactly once`);
		}
	});

	test('a bundle that timed out is matched to its echo for every message in it', async () => {
		const context = await setup();
		await goLive(context);
		context.youtube.failures.set('insertMessage', [new YoutubeApiError('timeout', 0, 'timeout', 'no answer')]);
		await send(context, '-Nt1', 'one');
		await send(context, '-Nt2', 'two');
		context.clock.advance(2_000);
		await context.sync.processOutboxOnce();
		assert.equal(await status(context, '-Nt1'), 'pending');
		await context.sync.handleChatPage(page([chatItem('LCC.lost', '[Website] Bran: one · Bran: two', { channelId: ownChannel })]), false);
		assert.equal(await status(context, '-Nt1'), 'sent');
		assert.equal(await status(context, '-Nt2'), 'sent');
		context.clock.advance(30_000);
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 0, 'never posted again');
	});
});

describe('quota saver', () => {
	test('levels follow the day\'s use, and the manual switch', () => {
		const limit = 10_000;
		assert.deepEqual(saverLevel({ used: 4_999, limit, auto: true, manual: false }), { level: 0, reason: 'off' });
		assert.deepEqual(saverLevel({ used: 5_000, limit, auto: true, manual: false }), { level: 1, reason: 'auto' });
		assert.deepEqual(saverLevel({ used: 8_000, limit, auto: true, manual: false }), { level: 2, reason: 'auto' });
		assert.deepEqual(saverLevel({ used: 9_000, limit, auto: false, manual: false }), { level: 0, reason: 'off' }, 'automatic switched off');
		assert.deepEqual(saverLevel({ used: 0, limit, auto: true, manual: true }), { level: 1, reason: 'manual' });
		assert.deepEqual(saverLevel({ used: 0, limit, auto: false, manual: true }), { level: 1, reason: 'manual' });
		assert.deepEqual(saverLevel({ used: 8_500, limit, auto: true, manual: true }), { level: 2, reason: 'auto' });
	});

	test('saving levels wait longer, follow the broadcast less often and ask the API less', () => {
		assert.deepEqual(saverTuning(0), { bundleWindowMs: 2_000, followFactor: 1, fullCheckMs: 900_000, moderatorsOnly: false });
		assert.deepEqual(saverTuning(1), { bundleWindowMs: 6_000, followFactor: 3, fullCheckMs: 1_800_000, moderatorsOnly: false });
		assert.equal(saverTuning(2).moderatorsOnly, true);
	});

	test('manual saver: bundles over the longer window', async () => {
		const context = await setup();
		await context.store.put(paths.settings, { saver: true });
		await goLive(context);
		await send(context, '-Nm1', 'one');
		context.clock.advance(2_000);
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 0, 'still waiting at 2 s');
		context.clock.advance(4_000);
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 1);
		await context.sync.saveState();
		assert.deepEqual(context.sync.state.saver, { level: 1, reason: 'manual' });
	});

	test('strict level (80 % used): only moderators\' messages go to YouTube; the rest stay on the website', async () => {
		const context = await setup();
		await goLive(context);
		context.sync.quota.record.used = 8_100;
		await send(context, '-Ns1', 'from a listener');
		await send(context, '-Ns2', 'from the host', { name: 'Host', moderator: true });
		context.clock.advance(6_000);
		await context.sync.processOutboxOnce();
		assert.deepEqual(context.youtube.inserted.map(({ text }) => text), ['[Website] Host: from the host']);
		const held = await context.store.get<OutboxEntry>(`${paths.outbox}/-Ns1`);
		assert.equal(held?.status, 'failed');
		assert.equal(held?.error, 'quota_saver');
		assert.equal((await context.store.get<{ t: string; ys: string }>(`${paths.messages(room)}/-Ns1`))?.ys, 'failed', 'the sender sees it wasn\'t sent');
	});

	test('automatic saver switched off: no saving even when quota runs low', async () => {
		const context = await setup();
		await context.store.put(paths.settings, { autoSaver: false });
		await goLive(context);
		context.sync.quota.record.used = 8_100;
		await send(context, '-Na1', 'from a listener');
		context.clock.advance(2_000);
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 1);
	});
});

describe('free broadcast detection', () => {
	const pageSaying = (result: PageStatus | Error) => {
		const calls: string[] = [];
		const check = async (channelId: string) => {
			calls.push(channelId);
			if (result instanceof Error) throw result;
			return result;
		};
		return { check, calls };
	};

	test('nothing live: only the free page is read, no quota spent (after the first API check)', async () => {
		const free = pageSaying({ status: 'none', videoId: '' });
		const context = await setup({ pageCheck: free.check });
		await context.sync.checkBroadcast();
		const apiCalls = context.youtube.calls.length;
		assert.ok(apiCalls > 0, 'the first check asks the API (it also sees unlisted broadcasts)');
		for (let check = 0; check < 5; check++) {
			context.clock.advance(120_000);
			await context.sync.checkBroadcast();
		}
		assert.equal(context.youtube.calls.length, apiCalls, 'no more API calls');
		assert.equal(free.calls.length, 5);
		assert.equal(context.sync.state.state, 'OFFLINE');
		assert.deepEqual(free.calls[0], ownChannel);
	});

	test('the page shows a live broadcast: one API call confirms it and the sync starts', async () => {
		const free = pageSaying({ status: 'live', videoId: 'vid00000009' });
		const context = await setup({ pageCheck: free.check });
		context.youtube.details.set('vid00000009', liveDetails('vid00000009', { activeLiveChatId: 'chat-9' }));
		await context.sync.checkBroadcast();
		context.youtube.calls.length = 0;
		context.sync.state.state = 'OFFLINE';
		context.clock.advance(120_000);
		await context.sync.checkBroadcast();
		assert.deepEqual(context.youtube.calls, ['liveDetails:vid00000009']);
		assert.equal(context.sync.state.state, 'LIVE');
		assert.equal(context.sync.state.liveChatId, 'chat-9');
		assert.equal(context.sync.state.title, 'OZ Bandung live');
	});

	test('a scheduled broadcast is seen for free', async () => {
		const free = pageSaying({ status: 'upcoming', videoId: 'vid00000010' });
		const context = await setup({ pageCheck: free.check });
		await context.sync.checkBroadcast();
		context.clock.advance(120_000);
		const before = context.youtube.calls.length;
		await context.sync.checkBroadcast();
		assert.equal(context.youtube.calls.length, before);
		assert.equal(context.sync.state.state, 'UPCOMING');
	});

	test('the API is still asked every 15 minutes, and at once on Check now', async () => {
		const free = pageSaying({ status: 'none', videoId: '' });
		const context = await setup({ pageCheck: free.check });
		await context.sync.checkBroadcast();
		const count = () => context.youtube.calls.filter((call) => call.startsWith('broadcasts')).length;
		const first = count();
		context.clock.advance(15 * 60_000);
		await context.sync.checkBroadcast();
		assert.ok(count() > first, 'due again after 15 minutes');
		const second = count();
		context.clock.advance(60_000);
		await context.sync.reconnect();
		await context.sync.checkBroadcast();
		assert.ok(count() > second, 'Check now asks the API (unlisted broadcasts)');
	});

	test('if the page can\'t be read, the API is asked instead', async () => {
		const free = pageSaying(new Error('blocked'));
		const context = await setup({ pageCheck: free.check });
		await context.sync.checkBroadcast();
		context.clock.advance(120_000);
		context.youtube.active = [liveBroadcast()];
		context.youtube.details.set('vid00000001', liveDetails());
		await context.sync.checkBroadcast();
		assert.equal(context.sync.state.state, 'LIVE');
	});

	test('a video the page called live that has ended is not treated as live', async () => {
		const free = pageSaying({ status: 'live', videoId: 'vid00000011' });
		const context = await setup({ pageCheck: free.check });
		await context.sync.checkBroadcast();
		context.youtube.details.set('vid00000011', liveDetails('vid00000011', { actualEndTime: '2026-11-12T11:00:00Z' }));
		context.clock.advance(120_000);
		await context.sync.checkBroadcast();
		assert.equal(context.sync.state.state, 'OFFLINE');
	});

	test('reading the public page', () => {
		const live = '<link rel="canonical" href="https://www.youtube.com/watch?v=abcdefghijk">..."isLiveNow":true...';
		assert.deepEqual(parseLivePage(live), { status: 'live', videoId: 'abcdefghijk' });
		assert.deepEqual(parseLivePage('"videoDetails":{"videoId":"abcdefghijk","title":"Soon"}'), { status: 'upcoming', videoId: 'abcdefghijk' });
		assert.deepEqual(parseLivePage('<link rel="canonical" href="https://www.youtube.com/channel/UC123">'), { status: 'none', videoId: '' });
	});
});
