// End-to-end behaviour of the YouTube sync against mocked YouTube responses and an in-memory database.
// Numbers in the test names follow the test list in docs/youtube-unified-chat.md.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { YoutubeApiError } from '../../src/lib/youtube/api.ts';
import { hashKey } from '../../src/lib/youtube/crypto.ts';
import { enqueue, forwardingTarget } from '../../src/lib/youtube/outbox.ts';
import { paths } from '../../src/lib/youtube/paths.ts';
import { timeKey } from '../../src/lib/youtube/push-id.ts';
import { recordHeartbeat, AddressLimiter } from '../../src/lib/youtube/viewers.ts';
import type { OutboxEntry, PublicLiveState, StoredChatMessage, SyncState } from '../../src/lib/youtube/types.ts';
import { chatItem, liveBroadcast, liveDetails, ownChannel, page, saveWebsiteMessage, setup } from './helpers.ts';

const room = 'bandung';
const publicState = async (store: { get<T>(path: string): Promise<T | null> }) => store.get<PublicLiveState>(paths.publicLive(room));

/** Brings the sync to LIVE on broadcast vid00000001 / chat-1. */
const goLive = async (context: Awaited<ReturnType<typeof setup>>) => {
	context.youtube.active = [liveBroadcast()];
	context.youtube.details.set('vid00000001', liveDetails());
	await context.sync.checkBroadcast();
};

/**
 * What /api/chat does for a message sent while forwarding is on. Then the clock moves past the bundle window, so the
 * next outbox run posts it (bundling has its own tests in saver.test.ts).
 */
const sendFromWebsite = async (context: Awaited<ReturnType<typeof setup>>, id: string, text: string) => {
	const target = await forwardingTarget(context.store, context.clock.now());
	await saveWebsiteMessage(context.store, id, text, 'Bran', target ? 'pending' : undefined);
	if (target) await enqueue(context.store, context.clock.now(), { messageId: id, room, name: 'Bran', text, target });
	context.clock.advance(2_000);
	return target;
};

describe('broadcast lifecycle', () => {
	test('1. YouTube offline: no sync, website messages are saved and not queued', async () => {
		const context = await setup();
		await context.sync.checkBroadcast();
		assert.equal(context.sync.state.state, 'OFFLINE');
		assert.equal((await publicState(context.store))?.sync, false);
		assert.equal(await sendFromWebsite(context, '-Nmsg0001', 'Hello'), null);
		const saved = await context.store.get<StoredChatMessage>(`${paths.messages(room)}/-Nmsg0001`);
		assert.equal(saved?.t, 'Hello');
		assert.equal(saved?.ys, undefined, 'no YouTube status while offline');
		assert.equal(await context.store.get(paths.queue), null);
	});

	test('2. YouTube upcoming: chat carries on, nothing is synced', async () => {
		const context = await setup();
		context.youtube.upcoming = [{ ...liveBroadcast('vid00000002'), lifeCycleStatus: 'ready', liveChatId: null }];
		await context.sync.checkBroadcast();
		assert.equal(context.sync.state.state, 'UPCOMING');
		const published = await publicState(context.store);
		assert.equal(published?.state, 'upcoming');
		assert.equal(published?.sync, false);
		assert.equal(await sendFromWebsite(context, '-Nmsg0002', 'Soon?'), null);
	});

	test('3. YouTube goes live: sync activates with the broadcast\'s live chat', async () => {
		const context = await setup();
		await context.sync.checkBroadcast();
		await goLive(context);
		assert.equal(context.sync.state.state, 'LIVE');
		assert.equal(context.sync.state.liveChatId, 'chat-1');
		assert.equal(context.sync.state.videoId, 'vid00000001');
		const published = await publicState(context.store);
		assert.equal(published?.state, 'live');
		assert.equal(published?.sync, true);
		assert.deepEqual(await forwardingTarget(context.store, context.clock.now()), { broadcastId: 'vid00000001', liveChatId: 'chat-1' });
	});

	test('not connected: stays offline and asks YouTube nothing', async () => {
		const context = await setup({ connected: false });
		await context.sync.checkBroadcast();
		assert.equal(context.sync.state.state, 'OFFLINE');
		assert.deepEqual(context.youtube.calls, []);
	});

	test('7. livestream ends: sync stops, queue is cleared, the broadcast record is closed', async () => {
		const context = await setup();
		await goLive(context);
		await context.sync.takeSnapshot();
		await sendFromWebsite(context, '-Nmsg0007', 'Still there?');
		context.youtube.details.set('vid00000001', liveDetails('vid00000001', { actualEndTime: '2026-11-12T13:00:00Z', activeLiveChatId: null }));
		context.youtube.active = [];
		await context.sync.checkBroadcast();
		assert.equal(context.sync.state.state, 'ENDED');
		assert.equal(context.sync.state.liveChatId, null);
		assert.equal((await publicState(context.store))?.sync, false);
		const entry = await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0007`);
		assert.equal(entry?.status, 'failed');
		assert.equal(entry?.error, 'broadcast_ended');
		assert.equal((await context.store.get<StoredChatMessage>(`${paths.messages(room)}/-Nmsg0007`))?.ys, 'failed');
		assert.ok(context.analytics.broadcasts[0].endedAt, 'history keeps the broadcast, with its end');
		// The next check finds nothing: offline.
		await context.sync.checkBroadcast();
		assert.equal(context.sync.state.state, 'OFFLINE');
		assert.equal(await forwardingTarget(context.store, context.clock.now()), null);
	});

	test('8. YouTube API unavailable: error state, website chat unaffected', async () => {
		const context = await setup();
		context.youtube.failures.set('broadcasts', [new YoutubeApiError('transient', 503, 'backendError', 'Service unavailable')]);
		await context.sync.checkBroadcast();
		assert.equal(context.sync.state.state, 'ERROR');
		assert.match(context.sync.state.lastError?.message ?? '', /Service unavailable/);
		assert.equal(await sendFromWebsite(context, '-Nmsg0008', 'Chat still works'), null);
		assert.equal((await context.store.get<StoredChatMessage>(`${paths.messages(room)}/-Nmsg0008`))?.t, 'Chat still works');
	});

	test('8b. a brief API failure while live does not stop the sync', async () => {
		const context = await setup();
		await goLive(context);
		context.youtube.failures.set('liveDetails', [new YoutubeApiError('transient', 0, 'network', 'reset')]);
		await context.sync.checkBroadcast();
		assert.equal(context.sync.state.state, 'LIVE');
		assert.equal((await publicState(context.store))?.sync, true);
	});
});

describe('website → YouTube', () => {
	test('4. a website message is posted to YouTube as the channel, with the website name', async () => {
		const context = await setup();
		await goLive(context);
		await sendFromWebsite(context, '-Nmsg0004', 'Hello everyone!');
		await context.sync.processOutboxOnce();
		assert.deepEqual(context.youtube.inserted.map(({ liveChatId, text }) => ({ liveChatId, text })), [{ liveChatId: 'chat-1', text: '[Website] Bran: Hello everyone!' }]);
		const entry = await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0004`);
		assert.equal(entry?.status, 'sent');
		assert.equal(entry?.ytId, 'LCC.sent-1');
		assert.equal((await context.store.get<StoredChatMessage>(`${paths.messages(room)}/-Nmsg0004`))?.ys, 'sent');
		assert.equal(await context.store.get(paths.queue), null);
		// No private details reach YouTube.
		assert.doesNotMatch(context.youtube.inserted[0].text, /firebase-uid|@/);
	});

	test('retries cannot post the same message twice', async () => {
		const context = await setup();
		await goLive(context);
		await sendFromWebsite(context, '-Nmsg0040', 'Once only');
		await context.sync.processOutboxOnce();
		await context.sync.processOutboxOnce();
		// Queued again by mistake: the entry is already sent, so it is skipped.
		await context.store.patch('', { [`${paths.queue}/-Nmsg0040`]: context.clock.now() });
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 1);
	});

	test('temporary failures back off and then succeed', async () => {
		const context = await setup();
		await goLive(context);
		context.youtube.failures.set('insertMessage', [new YoutubeApiError('transient', 503, 'backendError', 'down')]);
		await sendFromWebsite(context, '-Nmsg0041', 'Try again');
		await context.sync.processOutboxOnce();
		assert.equal((await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0041`))?.status, 'pending');
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 0, 'not before the backoff');
		context.clock.advance(2_000);
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 1);
		assert.equal((await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0041`))?.status, 'sent');
	});

	test('retries stop after the attempt limit and the message stays on the website', async () => {
		const context = await setup();
		await goLive(context);
		const error = () => new YoutubeApiError('transient', 500, 'backendError', 'down');
		context.youtube.failures.set('insertMessage', [error(), error(), error()]);
		await sendFromWebsite(context, '-Nmsg0042', 'Never arrives');
		for (let round = 0; round < 6; round++) {
			await context.sync.processOutboxOnce();
			context.clock.advance(30_000);
		}
		const entry = await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0042`);
		assert.equal(entry?.status, 'failed');
		assert.equal(entry?.attempts, 3);
		const message = await context.store.get<StoredChatMessage>(`${paths.messages(room)}/-Nmsg0042`);
		assert.equal(message?.t, 'Never arrives');
		assert.equal(message?.ys, 'failed');
	});

	test('a message deleted by a moderator before sending never reaches YouTube', async () => {
		const context = await setup();
		await goLive(context);
		await sendFromWebsite(context, '-Nmsg0043', 'Rude');
		await context.store.remove(`${paths.messages(room)}/-Nmsg0043`);
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 0);
		assert.equal(await context.store.get(`${paths.messages(room)}/-Nmsg0043`), null, 'no stub is written back');
	});

	test('forwarding switched off by an admin: nothing is queued', async () => {
		const context = await setup();
		await goLive(context);
		await context.store.put(paths.settings, { toYoutube: false });
		assert.equal(await forwardingTarget(context.store, context.clock.now()), null);
	});

	test('10. quota exhausted: the message fails, the queue is cleared, sync pauses', async () => {
		const context = await setup();
		await goLive(context);
		context.youtube.failures.set('insertMessage', [new YoutubeApiError('quota', 403, 'quotaExceeded', 'quota')]);
		await sendFromWebsite(context, '-Nmsg0010', 'First');
		await sendFromWebsite(context, '-Nmsg0011', 'Second');
		await context.sync.processOutboxOnce();
		assert.equal((await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0010`))?.error, 'quota');
		assert.equal((await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0011`))?.status, 'failed');
		assert.equal(context.sync.quota.isExhausted(context.clock.now()), true);
		await context.sync.saveState();
		await context.sync.publish();
		assert.equal((await publicState(context.store))?.sync, false);
		assert.equal(await forwardingTarget(context.store, context.clock.now()), null, 'new messages are not queued');
		assert.equal(context.youtube.inserted.length, 0);
	});

	test('10b. quota used up while live: status unknown, no stale count or snapshot; back after the reset', async () => {
		const context = await setup();
		await goLive(context);
		await context.sync.refreshWebsiteViewers();
		assert.equal((await publicState(context.store))?.youtubeViewers, 1250);
		context.youtube.failures.set('liveDetails', [new YoutubeApiError('quota', 403, 'quotaExceeded', 'quota')]);
		await context.sync.checkBroadcast();
		const blind = await publicState(context.store);
		assert.equal(blind?.state, 'unknown', 'not claimed live any more');
		assert.equal(blind?.youtubeViewers, null, 'the last count is not left frozen');
		assert.equal(blind?.websiteViewers, null);
		assert.equal(blind?.sync, false);
		assert.equal(await context.sync.takeSnapshot(), null, 'no history while nothing can be measured');
		assert.equal(await forwardingTarget(context.store, context.clock.now()), null);
		// Further checks ask YouTube nothing until the reset.
		const calls = context.youtube.calls.length;
		await context.sync.checkBroadcast();
		assert.equal(context.youtube.calls.length, calls);
		// A day later: checked again, live again with a fresh count.
		context.clock.advance(24 * 3_600_000);
		await context.sync.checkBroadcast();
		const back = await publicState(context.store);
		assert.equal(back?.state, 'live');
		assert.equal(back?.youtubeViewers, 1250);
	});

	test('the per-minute limit holds messages back instead of flooding YouTube', async () => {
		const context = await setup();
		await goLive(context);
		context.sync.outboxContext.limiter = new (context.sync.outboxContext.limiter.constructor as new (limit: number) => typeof context.sync.outboxContext.limiter)(2);
		// One post at a time (several at once would share a post).
		for (const id of ['-Nmsg0051', '-Nmsg0052', '-Nmsg0053']) {
			await sendFromWebsite(context, id, `Message ${id}`);
			await context.sync.processOutboxOnce();
		}
		assert.equal(context.youtube.inserted.length, 2);
		assert.equal((await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0053`))?.status, 'pending', 'held, not dropped');
		context.clock.advance(61_000);
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 3);
	});
});

describe('YouTube → website and duplicates', () => {
	test('5. a YouTube message is saved to the room with its YouTube author', async () => {
		const context = await setup();
		await goLive(context);
		const result = await context.sync.handleChatPage(page([chatItem('LCC.yt-1', 'Greetings from YouTube!')]), false);
		assert.equal(result.imported, 1);
		const key = timeKey(Date.parse('2026-11-12T12:00:00Z'), 'LCC.yt-1');
		const saved = await context.store.get<StoredChatMessage>(`${paths.messages(room)}/${key}`);
		assert.deepEqual(saved, {
			u: 'yt-UCviewer000000000000000001',
			n: 'YouTube User',
			p: 'https://yt3.ggpht.com/avatar.jpg',
			t: 'Greetings from YouTube!',
			ts: Date.parse('2026-11-12T12:00:00Z'),
			s: 'yt',
			c: 'UCviewer000000000000000001',
		});
		assert.equal(context.sync.state.pageToken, 'token-next');
	});

	test('6a. our own forwarded message coming back from YouTube is not copied in again', async () => {
		const context = await setup();
		await goLive(context);
		await sendFromWebsite(context, '-Nmsg0006', 'Hello everyone!');
		await context.sync.processOutboxOnce();
		const echo = chatItem('LCC.sent-1', '[Website] Bran: Hello everyone!', { channelId: ownChannel, name: 'OZ Radio Bandung', owner: true });
		const result = await context.sync.handleChatPage(page([echo]), false);
		assert.equal(result.imported, 0);
		assert.equal(result.skippedEcho, 1);
		const messages = await context.store.get<Record<string, StoredChatMessage>>(paths.messages(room));
		assert.equal(Object.keys(messages ?? {}).length, 1, 'only the original website message');
	});

	test('6b. the echo is recognised after a restart too (by the stored id)', async () => {
		const context = await setup();
		await context.store.put(`${paths.sent}/${hashKey('LCC.sent-99')}`, '-Nolder');
		await goLive(context);
		context.sync.outboxContext.sentIds.clear();
		const echo = chatItem('LCC.sent-99', '[Website] Bran: from before', { channelId: ownChannel });
		assert.equal((await context.sync.handleChatPage(page([echo]), false)).skippedEcho, 1);
	});

	test('6c. the same YouTube message twice is saved once; one a moderator deleted never returns', async () => {
		const context = await setup();
		await goLive(context);
		const item = chatItem('LCC.yt-2', 'Hi');
		await context.sync.handleChatPage(page([item, item]), false);
		await context.sync.handleChatPage(page([item]), false);
		const key = timeKey(Date.parse('2026-11-12T12:00:00Z'), 'LCC.yt-2');
		assert.equal(Object.keys((await context.store.get(paths.messages(room))) ?? {}).length, 1);
		await context.store.remove(`${paths.messages(room)}/${key}`);
		context.sync.readerContext.imported.clear();
		await context.sync.handleChatPage(page([item]), false);
		assert.equal(await context.store.get(`${paths.messages(room)}/${key}`), null);
	});

	test('6d. a send that timed out is matched to its echo instead of being sent twice', async () => {
		const context = await setup();
		await goLive(context);
		context.youtube.failures.set('insertMessage', [new YoutubeApiError('timeout', 0, 'timeout', 'no answer')]);
		await sendFromWebsite(context, '-Nmsg0060', 'Did it arrive?');
		await context.sync.processOutboxOnce();
		assert.equal((await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0060`))?.status, 'pending');
		// It did arrive: YouTube shows it in the chat.
		const echo = chatItem('LCC.lost-answer', '[Website] Bran: Did it arrive?', { channelId: ownChannel });
		await context.sync.handleChatPage(page([echo]), false);
		const entry = await context.store.get<OutboxEntry>(`${paths.outbox}/-Nmsg0060`);
		assert.equal(entry?.status, 'sent');
		assert.equal(entry?.ytId, 'LCC.lost-answer');
		context.clock.advance(30_000);
		await context.sync.processOutboxOnce();
		assert.equal(context.youtube.inserted.length, 0, 'never posted a second time');
	});

	test('messages the channel owner types on YouTube itself are copied in', async () => {
		const context = await setup();
		await goLive(context);
		const result = await context.sync.handleChatPage(page([chatItem('LCC.owner-1', 'Welcome!', { channelId: ownChannel, owner: true })]), false);
		assert.equal(result.imported, 1);
	});

	test('website rules apply: banned authors, severe words and links are left out', async () => {
		const context = await setup();
		await goLive(context);
		await context.store.put(`${paths.bans}/yt-UCbanned0000000000000000001`, { name: 'Spammer' });
		const result = await context.sync.handleChatPage(page([
			chatItem('LCC.b1', 'hello', { channelId: 'UCbanned0000000000000000001' }),
			chatItem('LCC.b2', 'dasar kontol'),
			chatItem('LCC.b3', 'visit spam.example.com now'),
			chatItem('LCC.b4', 'dasar goblok'),
		]), false);
		assert.equal(result.imported, 1);
		const saved = Object.values((await context.store.get<Record<string, StoredChatMessage>>(paths.messages(room))) ?? {});
		assert.equal(saved[0].t, 'dasar g*****', 'mild words are masked like on the website');
	});

	test('old chat history is not copied in on first connect', async () => {
		const context = await setup();
		await goLive(context);
		const old = chatItem('LCC.old', 'from an hour ago', { publishedAt: '2026-11-12T11:00:00Z' });
		const fresh = chatItem('LCC.new', 'just now');
		const result = await context.sync.handleChatPage(page([old, fresh]), true);
		assert.equal(result.imported, 1);
	});

	test('YouTube → website switched off: nothing is copied in', async () => {
		const context = await setup();
		await context.store.put(paths.settings, { fromYoutube: false });
		await goLive(context);
		assert.equal((await context.sync.handleChatPage(page([chatItem('LCC.off', 'hi')]), false)).imported, 0);
	});
});

describe('viewer counts and history', () => {
	test('13. the YouTube concurrent viewer count is published and updated', async () => {
		const context = await setup();
		await goLive(context);
		assert.equal((await publicState(context.store))?.youtubeViewers, 1250);
		context.youtube.details.set('vid00000001', liveDetails('vid00000001', { concurrentViewers: 1400 }));
		context.clock.advance(60_000);
		await context.sync.checkBroadcast();
		assert.equal((await publicState(context.store))?.youtubeViewers, 1400);
		assert.equal(context.youtube.calls.filter((call) => call.startsWith('broadcasts')).length, 1, 'while live only the video is checked');
	});

	test('14. a hidden YouTube count is shown and stored as unavailable, never as 0', async () => {
		const context = await setup();
		context.youtube.active = [liveBroadcast()];
		context.youtube.details.set('vid00000001', liveDetails('vid00000001', { concurrentViewers: null }));
		await context.sync.checkBroadcast();
		const published = await publicState(context.store);
		assert.equal(published?.youtubeViewers, null);
		assert.equal(published?.youtubeViewersAt, null);
		await context.sync.refreshWebsiteViewers();
		assert.equal(await context.sync.takeSnapshot(), 'recorded');
		const [snapshot] = context.analytics.snapshots;
		assert.equal(snapshot.youtubeConcurrentViewers, null);
		assert.equal(snapshot.websiteActiveViewers, 0);
		assert.equal(snapshot.combinedEstimatedViewers, null, 'no combined figure without both counts');
		assert.equal(snapshot.dataAvailability, 'website_only');
		assert.equal(context.analytics.broadcasts[0].peakYoutubeViewers, null);
		assert.equal(context.analytics.broadcasts[0].youtubeSamples, 0);
	});

	test('website viewers flow into the public state and the history', async () => {
		const context = await setup();
		await goLive(context);
		const limiter = new AddressLimiter(3);
		const config = { heartbeatMs: 20_000, ttlMs: 60_000, maxSessionsPerAddress: 3 };
		for (const [session, address] of [['session-aaaaaaaaaaaa1', 'a'], ['session-aaaaaaaaaaaa2', 'b']]) {
			await recordHeartbeat(context.store, context.clock, config, limiter, { session, playing: true, address, live: true });
		}
		await context.sync.refreshWebsiteViewers();
		const published = await publicState(context.store);
		assert.equal(published?.websiteViewers, 2);
		assert.equal(published?.youtubeViewers, 1250);
		await context.sync.takeSnapshot();
		assert.equal(context.analytics.snapshots[0].combinedEstimatedViewers, 1252);
		assert.equal(context.analytics.snapshots[0].dataAvailability, 'both');
	});

	test('snapshots skip repeats but keep a periodic record, and peaks/averages add up', async () => {
		const context = await setup();
		await goLive(context);
		await context.sync.refreshWebsiteViewers();
		assert.equal(await context.sync.takeSnapshot(), 'recorded');
		context.clock.advance(300_000);
		assert.equal(await context.sync.takeSnapshot(), 'skipped', 'same numbers five minutes later');
		context.clock.advance(300_000);
		context.youtube.details.set('vid00000001', liveDetails('vid00000001', { concurrentViewers: 1750 }));
		await context.sync.checkBroadcast();
		assert.equal(await context.sync.takeSnapshot(), 'recorded');
		const [broadcast] = context.analytics.broadcasts;
		assert.equal(broadcast.peakYoutubeViewers, 1750);
		assert.equal(broadcast.youtubeViewerSum, 3000);
		assert.equal(broadcast.youtubeSamples, 2);
	});

	test('history survives a restart: a new worker carries on the same broadcast record', async () => {
		const context = await setup();
		await goLive(context);
		await context.sync.refreshWebsiteViewers();
		await context.sync.takeSnapshot();
		// A new process: same database and CMS, fresh memory.
		const { YoutubeSync } = await import('../../src/lib/youtube/sync.ts');
		const restarted = new YoutubeSync(context.sync.deps, context.sync.config);
		await restarted.load();
		assert.equal(restarted.state.state, 'LIVE');
		assert.equal(restarted.state.broadcastId, 'vid00000001');
		context.clock.advance(300_000);
		context.youtube.details.set('vid00000001', liveDetails('vid00000001', { concurrentViewers: 900 }));
		await restarted.checkBroadcast();
		await restarted.refreshWebsiteViewers();
		await restarted.takeSnapshot();
		assert.equal(context.analytics.broadcasts.length, 1, 'no second record for the same broadcast');
		assert.equal(context.analytics.snapshots.length, 2);
	});

	test('the state saved for a restart holds no tokens', async () => {
		const context = await setup();
		await goLive(context);
		const state = await context.store.get<SyncState>(paths.state);
		assert.doesNotMatch(JSON.stringify(state), /refresh|access_token|v1\./);
		assert.doesNotMatch(JSON.stringify(await publicState(context.store)), /chat-1|refresh/);
	});
});

describe('lease', () => {
	test('only one worker holds the lease until it expires', async () => {
		const first = await setup();
		const { YoutubeSync } = await import('../../src/lib/youtube/sync.ts');
		const second = new YoutubeSync({ ...first.sync.deps, ownerId: 'other-process' }, first.sync.config);
		assert.equal(await first.sync.acquireLease(), true);
		assert.equal(await second.acquireLease(), false);
		first.clock.advance(46_000);
		assert.equal(await second.acquireLease(), true);
		assert.equal(await first.sync.acquireLease(), false);
	});
});
