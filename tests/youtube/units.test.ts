// The small pieces: parsing, keys, encryption, formatting, quota, roles, tokens and the viewer registry.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createYoutubeApi, YoutubeApiError } from '../../src/lib/youtube/api.ts';
import { nextState } from '../../src/lib/youtube/broadcast.ts';
import { createCredentials } from '../../src/lib/youtube/credentials.ts';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../../src/lib/youtube/crypto.ts';
import { formatForYoutube } from '../../src/lib/youtube/normalize.ts';
import { paths } from '../../src/lib/youtube/paths.ts';
import { timeKey } from '../../src/lib/youtube/push-id.ts';
import { nextQuotaReset, QuotaTracker, quotaDay } from '../../src/lib/youtube/quota.ts';
import { accessLabel, allows, capabilitiesFrom, noCapabilities } from '../../src/lib/youtube/roles.ts';
import { JsonArrayStreamParser } from '../../src/lib/youtube/stream-parser.ts';
import { AddressLimiter, countViewers, recordHeartbeat } from '../../src/lib/youtube/viewers.ts';
import { MemoryStore, TestClock } from './helpers.ts';

const key = parseEncryptionKey('11'.repeat(32));

describe('stream parser', () => {
	test('finds each page of a streamed JSON array, however it is split', () => {
		const body = '[{"items":[{"id":"a","snippet":{"displayMessage":"x } ] \\" ,"}}],"nextPageToken":"t1"}\n,\n{"items":[],"nextPageToken":"t2"}]';
		for (const size of [1, 3, 7, body.length]) {
			const parser = new JsonArrayStreamParser();
			const pages: unknown[] = [];
			for (let index = 0; index < body.length; index += size) pages.push(...parser.push(body.slice(index, index + size)));
			assert.deepEqual(pages.map((page: any) => page.nextPageToken), ['t1', 't2'], `chunk size ${size}`);
		}
	});
});

describe('message keys', () => {
	test('YouTube keys sort by time among Firebase push ids and are stable', () => {
		const earlier = timeKey(Date.parse('2026-11-12T12:00:00Z'), 'a');
		const later = timeKey(Date.parse('2026-11-12T12:00:01Z'), 'b');
		assert.ok(earlier < later);
		assert.equal(timeKey(1_700_000_000_000, 'same'), timeKey(1_700_000_000_000, 'same'));
		assert.match(earlier, /^[\w-]{20}$/);
		// Firebase push id for the same moment shares the 8-character time prefix.
		assert.equal(timeKey(Date.parse('2026-11-12T12:00:00Z'), 'x').slice(0, 8), earlier.slice(0, 8));
	});
});

describe('token encryption', () => {
	test('round-trips, and fails with the wrong key or a tampered value', () => {
		const sealed = encryptSecret('1//refresh-token', key);
		assert.notEqual(sealed, '1//refresh-token');
		assert.equal(decryptSecret(sealed, key), '1//refresh-token');
		assert.throws(() => decryptSecret(sealed, parseEncryptionKey('22'.repeat(32))));
		const parts = sealed.split('.');
		parts[3] = Buffer.from('tampered').toString('base64url');
		assert.throws(() => decryptSecret(parts.join('.'), key));
	});

	test('rejects keys of the wrong size', () => {
		assert.throws(() => parseEncryptionKey('short'));
	});
});

describe('formatting for YouTube', () => {
	test('names the website sender and fits YouTube\'s 200 characters', () => {
		assert.equal(formatForYoutube('Bran', 'Hello everyone!'), '[Website] Bran: Hello everyone!');
		const long = formatForYoutube('Bran', 'abcdefghij '.repeat(25));
		assert.equal([...long].length, 200);
		assert.ok(long.endsWith('…'));
	});
});

describe('broadcast states', () => {
	test('follow what YouTube reports', () => {
		const live = { kind: 'live', broadcastId: 'b', videoId: 'b', title: '', liveChatId: 'c', startedAt: null, viewers: null } as const;
		assert.equal(nextState('OFFLINE', live), 'LIVE');
		assert.equal(nextState('LIVE', { kind: 'none' }), 'ENDING');
		assert.equal(nextState('ENDING', { kind: 'none' }), 'ENDED');
		assert.equal(nextState('ENDED', { kind: 'none' }), 'OFFLINE');
		assert.equal(nextState('OFFLINE', { kind: 'upcoming', broadcastId: 'b', title: '' }), 'UPCOMING');
		assert.equal(nextState('OFFLINE', { kind: 'error', message: 'x' }), 'ERROR');
		assert.equal(nextState('LIVE', { kind: 'error', message: 'x' }, 1), 'LIVE');
		assert.equal(nextState('LIVE', { kind: 'error', message: 'x' }, 3), 'ERROR');
	});
});

describe('quota', () => {
	test('counts by Pacific day and stops before the limit', () => {
		const now = Date.parse('2026-11-12T12:00:00Z');
		const quota = new QuotaTracker(100, null, now);
		for (let index = 0; index < 4; index++) quota.spend('insertMessage', now);
		assert.equal(quota.canSpend('insertMessage', now), true);
		quota.spend('insertMessage', now);
		assert.equal(quota.canSpend('insertMessage', now), false);
		assert.equal(quota.canSpend('broadcasts', now), false);
		const reset = nextQuotaReset(now);
		assert.notEqual(quotaDay(reset), quotaDay(now));
		assert.equal(quotaDay(reset - 60_000), quotaDay(now));
		assert.equal(quota.canSpend('insertMessage', reset + 1), true, 'a new day starts afresh');
	});

	test('quotaExceeded blocks everything until the reset', () => {
		const now = Date.parse('2026-11-12T12:00:00Z');
		const quota = new QuotaTracker(10_000, null, now);
		quota.exhaust(now);
		assert.equal(quota.isExhausted(now + 3_600_000), true);
		assert.equal(quota.isExhausted(nextQuotaReset(now) + 1), false);
	});
});

describe('16. who may run the integration', () => {
	test('what the CMS sends is what counts, page by page (built-in or custom roles alike)', () => {
		const host = capabilitiesFrom({ youtube: 'view', chatSync: 'edit', moderation: 'edit', analytics: 'none' }, []);
		assert.deepEqual(host, { youtube: 'view', chatSync: 'edit', moderation: 'edit', analytics: 'none' });
		assert.equal(allows(host.youtube, 'view'), true);
		assert.equal(allows(host.youtube, 'edit'), false, 'can look at YouTube, not connect it');
		assert.equal(allows(host.moderation, 'edit'), true);
		assert.equal(allows(host.analytics, 'view'), false);
	});

	test('the CMS\'s answer wins over role names; nonsense levels count as none', () => {
		assert.deepEqual(capabilitiesFrom({ youtube: 'everything', analytics: 'view' }, ['developer']), { ...noCapabilities, analytics: 'view' });
	});

	test('a CMS from before custom roles: Developer has everything, Digital the analytics, others and chat roles nothing', () => {
		assert.deepEqual(capabilitiesFrom(undefined, ['developer']), { youtube: 'edit', chatSync: 'edit', moderation: 'edit', analytics: 'view' });
		assert.deepEqual(capabilitiesFrom(undefined, ['digital', 'editorial']), { ...noCapabilities, analytics: 'view' });
		assert.deepEqual(capabilitiesFrom(undefined, ['editorial']), noCapabilities);
		assert.deepEqual(capabilitiesFrom(undefined, ['website']), noCapabilities);
		assert.deepEqual(capabilitiesFrom(undefined, ['mod', 'dev', 'host', 'operator']), noCapabilities);
	});

	test('levels', () => {
		assert.equal(allows('view', 'edit'), false);
		assert.equal(allows('edit', 'view'), true);
		assert.equal(allows(null, 'view'), false);
		assert.equal(accessLabel('edit'), 'manage');
		assert.equal(accessLabel('view'), 'view');
		assert.equal(accessLabel('none'), null);
	});
});

describe('9. OAuth tokens', () => {
	const oauth = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.test/api/youtube/callback' };

	const setupTokens = async () => {
		const store = new MemoryStore();
		const clock = new TestClock();
		await store.put(paths.auth, { refreshToken: encryptSecret('refresh-1', key), channelId: 'UC', channelTitle: '', scope: '', connectedAt: 0, connectedBy: '', status: 'ok' });
		const requests: string[] = [];
		let issued = 0;
		let revoked = false;
		const fetch = (async (url: string | URL, init?: RequestInit) => {
			requests.push(String(url));
			if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
				assert.match(String(init?.body), /refresh_token=refresh-1/);
				if (revoked) return Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 });
				issued++;
				return Response.json({ access_token: `access-${issued}`, expires_in: 3600 });
			}
			const auth = new Headers(init?.headers).get('Authorization');
			// The first access token is "expired" on YouTube's side.
			if (auth === 'Bearer access-1') return Response.json({ error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }, { status: 401 });
			return Response.json({ items: [{ id: 'UC', snippet: { title: 'OZ' } }] });
		}) as typeof globalThis.fetch;
		const credentials = createCredentials({ store, oauth, encryptionKey: key, clock, fetch });
		const api = createYoutubeApi({ accessToken: credentials.accessToken, fetch });
		return { store, clock, credentials, api, requests, revoke: () => { revoked = true; } };
	};

	test('an access token is reused until it nears expiry', async () => {
		const { credentials, requests, clock } = await setupTokens();
		assert.equal(await credentials.accessToken(), 'access-1');
		assert.equal(await credentials.accessToken(), 'access-1');
		assert.equal(requests.length, 1);
		clock.advance(3_550_000);
		assert.equal(await credentials.accessToken(), 'access-2');
	});

	test('an expired token is refreshed and the call retried once', async () => {
		const { api, requests } = await setupTokens();
		const channel = await api.myChannel();
		assert.equal(channel?.title, 'OZ');
		assert.equal(requests.filter((url) => url.includes('oauth2')).length, 2, 'refreshed after the 401');
	});

	test('a revoked grant marks the connection for reconnecting', async () => {
		const { credentials, store, revoke } = await setupTokens();
		revoke();
		await assert.rejects(credentials.accessToken(), (error: unknown) => error instanceof YoutubeApiError && error.kind === 'auth_revoked');
		assert.equal((await store.get<{ status: string }>(paths.auth))?.status, 'revoked');
		await assert.rejects(credentials.accessToken(true), (error: unknown) => error instanceof YoutubeApiError && error.reason === 'not_connected');
	});
});

describe('website viewers', () => {
	const config = { heartbeatMs: 20_000, ttlMs: 60_000, maxSessionsPerAddress: 3 };

	test('11. a heartbeat from a playing player counts', async () => {
		const store = new MemoryStore();
		const clock = new TestClock();
		const result = await recordHeartbeat(store, clock, config, new AddressLimiter(3), { session: 'session-0000000000001', playing: true, address: 'a', live: true });
		assert.equal(result.counted, true);
		assert.equal(await countViewers(store, clock), 1);
	});

	test('12. pausing stops counting at once; a player that goes quiet expires', async () => {
		const store = new MemoryStore();
		const clock = new TestClock();
		const limiter = new AddressLimiter(3);
		await recordHeartbeat(store, clock, config, limiter, { session: 'session-0000000000001', playing: true, address: 'a', live: true });
		await recordHeartbeat(store, clock, config, limiter, { session: 'session-0000000000002', playing: true, address: 'b', live: true });
		await recordHeartbeat(store, clock, config, limiter, { session: 'session-0000000000001', playing: false, address: 'a', live: true });
		assert.equal(await countViewers(store, clock), 1);
		clock.advance(61_000);
		assert.equal(await countViewers(store, clock), 0, 'disconnected without saying so');
		assert.equal(await store.get(paths.viewers), null, 'expired sessions are cleaned up');
	});

	test('15. repeated heartbeats and several tabs do not inflate the count', async () => {
		const store = new MemoryStore();
		const clock = new TestClock();
		const limiter = new AddressLimiter(3);
		// One session beating many times is one viewer.
		for (let beat = 0; beat < 5; beat++) {
			await recordHeartbeat(store, clock, config, limiter, { session: 'session-0000000000001', playing: true, address: 'a', live: true });
			clock.advance(20_000);
		}
		assert.equal(await countViewers(store, clock), 1);
		// One machine can't pose as a crowd: past the cap, new sessions aren't counted.
		for (let index = 2; index <= 6; index++) {
			await recordHeartbeat(store, clock, config, limiter, { session: `session-000000000000${index}`, playing: true, address: 'a', live: true });
		}
		assert.equal(await countViewers(store, clock), 3);
	});

	test('nothing counts while YouTube is not live, and a loaded but idle player never counts', async () => {
		const store = new MemoryStore();
		const clock = new TestClock();
		const result = await recordHeartbeat(store, clock, config, new AddressLimiter(3), { session: 'session-0000000000001', playing: true, address: 'a', live: false });
		assert.equal(result.counted, false);
		assert.equal(await countViewers(store, clock), 0);
	});
});
