// Test doubles for the YouTube sync: an in-memory Realtime Database, a hand-driven clock and a scripted YouTube API.
// No network, no credentials.
import type { Broadcast, ChatPage, LiveDetails, YoutubeApi, YoutubeChatItem } from '../../src/lib/youtube/api.ts';
import { YoutubeApiError } from '../../src/lib/youtube/api.ts';
import type { AnalyticsStore, BroadcastDoc, SnapshotDoc } from '../../src/lib/youtube/snapshots.ts';
import { YoutubeSync, type SyncConfig } from '../../src/lib/youtube/sync.ts';
import type { Clock, Logger, Store } from '../../src/lib/youtube/types.ts';
import { paths } from '../../src/lib/youtube/paths.ts';
import { defaultBlocklist } from '../../src/lib/chat-filter.ts';

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const split = (path: string) => path.split('/').filter(Boolean);

/** Enough of the Realtime Database for the sync: nested JSON, null deletes, empty nodes disappear. */
export class MemoryStore implements Store {
	root: Record<string, unknown> = {};
	writes = 0;

	read(path: string): unknown {
		let node: unknown = this.root;
		for (const key of split(path)) {
			if (!node || typeof node !== 'object') return null;
			node = (node as Record<string, unknown>)[key];
		}
		return node === undefined ? null : node;
	}

	private write(path: string, value: unknown) {
		const keys = split(path);
		if (!keys.length) {
			this.root = (value ?? {}) as Record<string, unknown>;
			return;
		}
		const parents: Record<string, unknown>[] = [];
		let node = this.root;
		for (const key of keys.slice(0, -1)) {
			parents.push(node);
			if (!node[key] || typeof node[key] !== 'object') node[key] = {};
			node = node[key] as Record<string, unknown>;
		}
		const last = keys.at(-1)!;
		if (value === null || value === undefined) delete node[last];
		else node[last] = clone(value);
		// Prune empty parents, like the database does.
		for (let index = keys.length - 2; index >= 0; index--) {
			const parent = parents[index];
			const child = parent[keys[index]] as Record<string, unknown>;
			if (child && typeof child === 'object' && !Object.keys(child).length) delete parent[keys[index]];
		}
	}

	async get<T>(path: string) {
		return clone(this.read(path)) as T | null;
	}
	async put(path: string, value: unknown) {
		this.writes++;
		this.write(path, value);
	}
	async patch(path: string, value: Record<string, unknown>) {
		this.writes++;
		for (const [key, child] of Object.entries(value)) this.write([path, key].filter(Boolean).join('/'), child);
	}
	async remove(path: string) {
		this.writes++;
		this.write(path, null);
	}
	async transaction<T>(path: string, update: (current: T | null) => T | null | undefined) {
		const current = clone(this.read(path)) as T | null;
		const next = update(current);
		if (next === undefined) return { committed: false, value: current };
		this.write(path, next);
		return { committed: true, value: next };
	}
}

export class TestClock implements Clock {
	time: number;
	constructor(time = Date.parse('2026-11-12T12:00:00Z')) {
		this.time = time;
	}
	now() {
		return this.time;
	}
	advance(ms: number) {
		this.time += ms;
	}
}

export const quietLog: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** A YouTube API whose answers the test sets. Every call is recorded. */
export class FakeYoutube implements YoutubeApi {
	calls: string[] = [];
	active: Broadcast[] = [];
	upcoming: Broadcast[] = [];
	details = new Map<string, LiveDetails | null>();
	inserted: { liveChatId: string; text: string; id: string }[] = [];
	/** Errors to throw from the next calls of a method, in order. */
	failures = new Map<string, YoutubeApiError[]>();
	private nextId = 1;

	private fail(method: string) {
		const error = this.failures.get(method)?.shift();
		if (error) throw error;
	}
	async myChannel() {
		this.calls.push('myChannel');
		return { id: ownChannel, title: 'OZ Radio Bandung' };
	}
	async broadcasts(status: 'active' | 'upcoming') {
		this.calls.push(`broadcasts:${status}`);
		this.fail('broadcasts');
		return status === 'active' ? this.active : this.upcoming;
	}
	async liveDetails(videoId: string) {
		this.calls.push(`liveDetails:${videoId}`);
		this.fail('liveDetails');
		return this.details.get(videoId) ?? null;
	}
	async listMessages(): Promise<ChatPage> {
		this.calls.push('listMessages');
		return { items: [], nextPageToken: null, pollingIntervalMillis: 5000, offlineAt: null };
	}
	async streamMessages() {
		this.calls.push('streamMessages');
	}
	async insertMessage(liveChatId: string, text: string) {
		this.calls.push('insertMessage');
		this.fail('insertMessage');
		const id = `LCC.sent-${this.nextId++}`;
		this.inserted.push({ liveChatId, text, id });
		return { id };
	}
}

export const ownChannel = 'UCozradio0000000000000000';

export const liveBroadcast = (id = 'vid00000001', liveChatId = 'chat-1'): Broadcast => ({
	id,
	title: 'OZ Bandung live',
	lifeCycleStatus: 'live',
	liveChatId,
	scheduledStartTime: null,
	actualStartTime: '2026-11-12T11:55:00Z',
	actualEndTime: null,
});

export const liveDetails = (videoId = 'vid00000001', overrides: Partial<LiveDetails> = {}): LiveDetails => ({
	videoId,
	concurrentViewers: 1250,
	activeLiveChatId: 'chat-1',
	actualStartTime: '2026-11-12T11:55:00Z',
	actualEndTime: null,
	...overrides,
});

export const chatItem = (id: string, text: string, overrides: { channelId?: string; name?: string; publishedAt?: string; owner?: boolean } = {}): YoutubeChatItem => ({
	id,
	snippet: {
		type: 'textMessageEvent',
		liveChatId: 'chat-1',
		authorChannelId: overrides.channelId ?? 'UCviewer000000000000000001',
		publishedAt: overrides.publishedAt ?? '2026-11-12T12:00:00Z',
		displayMessage: text,
		textMessageDetails: { messageText: text },
	},
	authorDetails: {
		channelId: overrides.channelId ?? 'UCviewer000000000000000001',
		displayName: overrides.name ?? 'YouTube User',
		profileImageUrl: 'https://yt3.ggpht.com/avatar.jpg',
		isChatOwner: overrides.owner ?? false,
		isChatModerator: false,
	},
});

export const page = (items: YoutubeChatItem[], extra: Partial<ChatPage> = {}): ChatPage => ({
	items,
	nextPageToken: 'token-next',
	pollingIntervalMillis: 3000,
	offlineAt: null,
	...extra,
});

/** The CMS history, in memory. */
export class MemoryAnalytics implements AnalyticsStore {
	broadcasts: (BroadcastDoc & { videoId: string; title: string })[] = [];
	snapshots: (SnapshotDoc & { broadcast: BroadcastDoc['id']; combinedEstimatedViewers: number | null; dataAvailability: string })[] = [];
	async findBroadcast(broadcastId: string) {
		return clone(this.broadcasts.find((item) => item.broadcastId === broadcastId) ?? null);
	}
	async createBroadcast(data: Omit<BroadcastDoc, 'id'> & { videoId: string; title: string }) {
		const doc = { ...data, id: this.broadcasts.length + 1 };
		this.broadcasts.push(doc);
		return clone(doc);
	}
	async updateBroadcast(id: BroadcastDoc['id'], data: Partial<BroadcastDoc>) {
		const doc = this.broadcasts.find((item) => item.id === id)!;
		Object.assign(doc, data);
		return clone(doc);
	}
	async latestSnapshot(broadcast: BroadcastDoc['id']) {
		const own = this.snapshots.filter((item) => item.broadcast === broadcast).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
		return clone(own[0] ?? null);
	}
	async createSnapshot(data: MemoryAnalytics['snapshots'][number] & { videoId: string }) {
		this.snapshots.push(clone(data));
	}
}

export const testConfig: SyncConfig = {
	room: 'bandung',
	broadcastCheckMs: 120_000,
	viewerRefreshMs: 60_000,
	websiteViewersMs: 15_000,
	snapshotMs: 300_000,
	outboxMs: 2_000,
	leaseMs: 45_000,
	dailyQuota: 10_000,
	outboundPerMinute: 20,
	backlogMs: 120_000,
	pollMinMs: 10_000,
	outbox: { maxAttempts: 3, staleAfterMs: 120_000, uncertainWaitMs: 20_000, quotaReserve: 500 },
};

/** A sync with a connected channel, ready to drive step by step (no timers). */
export const setup = async (options: { connected?: boolean } = {}) => {
	const store = new MemoryStore();
	const clock = new TestClock();
	const youtube = new FakeYoutube();
	const analytics = new MemoryAnalytics();
	if (options.connected !== false) {
		await store.put(paths.auth, {
			refreshToken: 'v1.encrypted',
			channelId: ownChannel,
			channelTitle: 'OZ Radio Bandung',
			scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
			connectedAt: clock.now(),
			connectedBy: 'dev@ozradio.test',
			status: 'ok',
		});
	}
	const sync = new YoutubeSync({
		store,
		clock,
		log: quietLog,
		api: youtube,
		blocklist: async () => defaultBlocklist,
		analytics,
		ownerId: 'test-process',
		resetCredentials: () => {},
	}, testConfig);
	await sync.load();
	return { store, clock, youtube, analytics, sync };
};

/** A website message as /api/chat saves it. */
export const saveWebsiteMessage = async (store: MemoryStore, id: string, text: string, name = 'Bran', ys?: string) => {
	await store.put(`${paths.messages('bandung')}/${id}`, { u: 'firebase-uid-1', n: name, t: text, ts: Date.parse('2026-11-12T12:00:00Z'), ...(ys ? { ys } : {}) });
};
