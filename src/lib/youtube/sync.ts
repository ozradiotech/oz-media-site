// The YouTube sync worker. One runs per site process; a lease in the database makes sure only one of them (across
// processes and machines: local development shares the database) talks to YouTube at a time. Every step catches its
// own errors: whatever YouTube does, the website chat keeps working, because it never depends on this.
import { YoutubeApiError, type ChatPage, type QuotaCall, type YoutubeApi } from './api.ts';
import { checkDelay, discover, followLive, nextState, type Observation } from './broadcast.ts';
import { defaultSettings, failAllPending, processOutbox, RateLimiter, readSettings, type OutboxConfig, type OutboxContext } from './outbox.ts';
import { paths } from './paths.ts';
import { QuotaTracker } from './quota.ts';
import { handlePage, type ReaderContext } from './reader.ts';
import { closeBroadcast, recordSnapshot, type AnalyticsStore } from './snapshots.ts';
import type { Clock, Logger, PublicLiveState, StoredAuth, Store, SyncSettings, SyncState } from './types.ts';
import { countViewers } from './viewers.ts';
import type { Blocklist } from '../chat-filter.ts';

export type SyncConfig = {
	room: string;
	broadcastCheckMs: number;
	viewerRefreshMs: number;
	websiteViewersMs: number;
	snapshotMs: number;
	outboxMs: number;
	leaseMs: number;
	dailyQuota: number;
	outboundPerMinute: number;
	/** Chat already on YouTube when the reader first connects to a broadcast older than this isn't copied in. */
	backlogMs: number;
	/** Polling fallback: never more often than this, whatever YouTube suggests. */
	pollMinMs: number;
	outbox: OutboxConfig;
};

export type SyncDeps = {
	store: Store;
	clock: Clock;
	log: Logger;
	api: YoutubeApi;
	blocklist(): Promise<Blocklist>;
	analytics: AnalyticsStore | null;
	/** This process, for the lease. */
	ownerId: string;
	/** Drops cached tokens after a disconnect. */
	resetCredentials(): void;
};

const emptyState = (now: number): SyncState => ({
	state: 'OFFLINE',
	broadcastId: null,
	videoId: null,
	liveChatId: null,
	title: null,
	startedAt: null,
	updatedAt: now,
	pageToken: null,
	readerMode: null,
	youtubeViewers: null,
	youtubeViewersAt: null,
	lastError: null,
	quota: { day: '', used: 0 },
	counts: { sent: 0, failed: 0, imported: 0 },
});

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
	if (signal.aborted) return resolve();
	const timer = setTimeout(resolve, ms);
	signal.addEventListener('abort', () => {
		clearTimeout(timer);
		resolve();
	}, { once: true });
});

export class YoutubeSync {
	readonly deps: SyncDeps;
	readonly config: SyncConfig;
	state: SyncState;
	settings: SyncSettings = { ...defaultSettings };
	auth: StoredAuth | null = null;
	quota: QuotaTracker;
	websiteViewers: number | null = null;
	websiteViewersAt: number | null = null;
	leader = false;
	private errorsInARow = 0;
	private checks = 0;
	private loaded = false;
	private reader: { liveChatId: string; abort: AbortController; done: Promise<void> } | null = null;
	private outboxRunning = false;
	private lastPublished = '';
	private lastStateSave = 0;
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private running = false;
	readonly outboxContext: OutboxContext;
	readonly readerContext: ReaderContext;

	constructor(deps: SyncDeps, config: SyncConfig) {
		this.deps = deps;
		this.config = config;
		const now = deps.clock.now();
		this.state = emptyState(now);
		this.quota = new QuotaTracker(config.dailyQuota, null, now);
		this.outboxContext = {
			store: deps.store,
			clock: deps.clock,
			log: deps.log,
			api: this.countedApi(deps.api),
			quota: this.quota,
			limiter: new RateLimiter(config.outboundPerMinute),
			config: config.outbox,
			live: () => this.state.state === 'LIVE' && this.state.liveChatId && this.state.broadcastId
				? { broadcastId: this.state.broadcastId, liveChatId: this.state.liveChatId }
				: null,
			settings: () => this.settings,
			uncertain: new Map(),
			sentIds: new Set(),
			counts: this.state.counts,
			onChatGone: () => this.soon('broadcast', 0),
			onAuthRevoked: (error) => this.authRevoked(error),
			onQuotaExhausted: () => void this.quotaExhausted(),
		};
		this.readerContext = {
			store: deps.store,
			clock: deps.clock,
			room: config.room,
			ownChannelId: null,
			blocklist: deps.blocklist,
			fromYoutube: () => this.settings.fromYoutube,
			outbox: this.outboxContext,
			imported: new Set(),
			counts: this.state.counts,
			backlogMs: config.backlogMs,
		};
	}

	/** Counts every call against the quota. */
	private countedApi(api: YoutubeApi): YoutubeApi {
		const spend = (call: QuotaCall) => this.quota.spend(call, this.deps.clock.now());
		return {
			myChannel: () => (spend('channels'), api.myChannel()),
			broadcasts: (status) => (spend('broadcasts'), api.broadcasts(status)),
			liveDetails: (videoId) => (spend('videos'), api.liveDetails(videoId)),
			listMessages: (chat, token) => (spend('listMessages'), api.listMessages(chat, token)),
			streamMessages: (chat, token, onPage, signal) => (spend('streamMessages'), api.streamMessages(chat, token, onPage, signal)),
			insertMessage: (chat, text) => (spend('insertMessage'), api.insertMessage(chat, text)),
		};
	}

	private get api() {
		return this.outboxContext.api;
	}

	// ---------- State ----------

	/** Picks up where the last run left off: broadcast, reader position, quota spent, counters. */
	async load() {
		const now = this.deps.clock.now();
		const [saved, settings, auth] = await Promise.all([
			this.deps.store.get<SyncState>(paths.state),
			readSettings(this.deps.store),
			this.deps.store.get<StoredAuth>(paths.auth),
		]);
		if (saved) {
			this.state = { ...emptyState(now), ...saved, counts: { ...emptyState(now).counts, ...saved.counts } };
			this.outboxContext.counts = this.state.counts;
			this.readerContext.counts = this.state.counts;
		}
		this.quota = new QuotaTracker(this.config.dailyQuota, saved?.quota ?? null, now);
		this.outboxContext.quota = this.quota;
		this.settings = settings;
		this.auth = auth;
		this.readerContext.ownChannelId = auth?.channelId ?? null;
		this.loaded = true;
	}

	async refreshSettings() {
		[this.settings, this.auth] = await Promise.all([
			readSettings(this.deps.store),
			this.deps.store.get<StoredAuth>(paths.auth),
		]);
		this.readerContext.ownChannelId = this.auth?.channelId ?? null;
	}

	async saveState(force = true) {
		const now = this.deps.clock.now();
		if (!force && now - this.lastStateSave < 5_000) return;
		this.lastStateSave = now;
		this.state.updatedAt = now;
		this.state.quota = { ...this.quota.record };
		await this.deps.store.put(paths.state, this.state);
	}

	private recordError(message: string, code?: string) {
		this.state.lastError = { at: this.deps.clock.now(), message, code };
		this.deps.log.warn(message);
	}

	/**
	 * YouTube refused for lack of quota: nothing can be asked until midnight Pacific. The last viewer count would only go
	 * stale, so it is dropped, and the public state says "unknown" rather than claiming the broadcast is still live.
	 */
	async quotaExhausted() {
		this.quota.exhaust(this.deps.clock.now());
		this.state.youtubeViewers = null;
		this.state.youtubeViewersAt = null;
		this.recordError('YouTube quota used up for today; sync resumes after midnight Pacific time.', 'quota');
		await this.publish().catch(() => undefined);
	}

	/** While the quota is used up, a broadcast we were following (or waiting for) can't be checked. */
	private isBlind(now: number) {
		return this.quota.isExhausted(now) && (this.state.state === 'LIVE' || this.state.state === 'UPCOMING');
	}

	private authRevoked(error: YoutubeApiError) {
		this.recordError(`YouTube access was refused (${error.reason || error.message}). Connect the channel again.`, 'auth');
		this.stopReader();
		this.soon('broadcast', 0);
	}

	isConnected() {
		return Boolean(this.auth?.refreshToken && this.auth.status === 'ok');
	}

	/** Whether messages actually cross over right now. Drives the "synced with YouTube" indicator. */
	isSyncing() {
		const now = this.deps.clock.now();
		return this.state.state === 'LIVE' && Boolean(this.state.liveChatId) && this.isConnected() &&
			(this.settings.toYoutube || this.settings.fromYoutube) && !this.quota.isExhausted(now);
	}

	/** The public summary under the room's meta. Written only when something changed. */
	async publish() {
		const now = this.deps.clock.now();
		const blind = this.isBlind(now);
		const live = this.state.state === 'LIVE' && !blind;
		const state: PublicLiveState = {
			state: blind ? 'unknown' : live ? 'live' : this.state.state === 'UPCOMING' ? 'upcoming' : 'offline',
			sync: this.isSyncing(),
			channelId: this.isConnected() ? this.auth?.channelId ?? null : null,
			videoId: live ? this.state.videoId : null,
			youtubeViewers: live ? this.state.youtubeViewers : null,
			youtubeViewersAt: live ? this.state.youtubeViewersAt : null,
			websiteViewers: live ? this.websiteViewers : null,
			websiteViewersAt: live ? this.websiteViewersAt : null,
			updatedAt: now,
		};
		const { updatedAt: _, ...comparable } = state;
		const key = JSON.stringify(comparable);
		if (key === this.lastPublished) return;
		await this.deps.store.put(paths.publicLive(this.config.room), state);
		this.lastPublished = key;
	}

	// ---------- Broadcast detection ----------

	async checkBroadcast() {
		if (!this.loaded) await this.load();
		await this.refreshSettings();
		const now = this.deps.clock.now();
		const previous = this.state.state;

		if (!this.isConnected()) {
			if (previous === 'LIVE') await this.endBroadcast();
			Object.assign(this.state, { state: 'OFFLINE', broadcastId: null, videoId: null, liveChatId: null, title: null, startedAt: null, youtubeViewers: null, youtubeViewersAt: null });
			await this.saveState();
			await this.publish();
			return;
		}
		if (this.quota.isExhausted(now)) {
			// Nothing can be asked until the quota resets; the website chat carries on regardless.
			await this.saveState();
			await this.publish();
			return;
		}

		let observation: Observation;
		try {
			this.checks++;
			observation = previous === 'LIVE' && this.state.broadcastId
				? await followLive(this.api, { broadcastId: this.state.broadcastId, title: this.state.title ?? '' })
				: await discover(this.api, previous === 'UPCOMING' || this.checks % 3 === 1);
			this.errorsInARow = 0;
		} catch (error) {
			this.errorsInARow++;
			const apiError = error instanceof YoutubeApiError ? error : null;
			if (apiError?.kind === 'quota') await this.quotaExhausted();
			if (apiError?.kind === 'auth_revoked') this.authRevoked(apiError);
			observation = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
			this.recordError(`Broadcast check failed: ${observation.message}`, apiError?.reason);
		}

		let next = nextState(previous, observation, this.errorsInARow);
		if (observation.kind === 'live') {
			if (previous === 'LIVE' && this.state.broadcastId !== observation.broadcastId) await this.endBroadcast();
			const chatChanged = this.state.liveChatId !== observation.liveChatId;
			Object.assign(this.state, {
				broadcastId: observation.broadcastId,
				videoId: observation.videoId,
				title: observation.title,
				liveChatId: observation.liveChatId,
				startedAt: observation.startedAt ?? this.state.startedAt ?? now,
				// Null when YouTube didn't give one (hidden or not yet known): shown as unavailable, never as 0.
				youtubeViewers: observation.viewers,
				youtubeViewersAt: observation.viewers === null ? null : now,
			});
			if (chatChanged) this.state.pageToken = null;
			if (previous !== 'LIVE') this.deps.log.info(`Broadcast ${observation.broadcastId} is live.`);
		} else if (observation.kind === 'upcoming') {
			if (next === 'ENDING') await this.endBroadcast();
			if (next === 'ENDING') next = 'ENDED';
			Object.assign(this.state, { broadcastId: observation.broadcastId, title: observation.title, videoId: null, liveChatId: null, youtubeViewers: null, youtubeViewersAt: null });
		} else if (observation.kind === 'none') {
			if (next === 'ENDING') {
				this.state.state = 'ENDING';
				await this.saveState();
				await this.endBroadcast();
				next = 'ENDED';
			}
			Object.assign(this.state, { broadcastId: null, videoId: null, liveChatId: null, title: null, startedAt: null, youtubeViewers: null, youtubeViewersAt: null });
		}
		this.state.state = next;

		// The reader follows the state. With YouTube → website off it isn't needed, which saves its quota.
		if (next === 'LIVE' && this.state.liveChatId && this.settings.fromYoutube) this.startReader(this.state.liveChatId);
		else this.stopReader();

		await this.saveState();
		await this.publish();
	}

	/** The broadcast is over: stop reading, give up on unsent messages, and close its record in the analytics. */
	async endBroadcast() {
		const broadcastId = this.state.broadcastId;
		this.stopReader();
		await failAllPending(this.outboxContext, 'broadcast_ended').catch((error) => this.deps.log.error('Could not clear the queue.', error));
		if (broadcastId && this.deps.analytics) {
			await closeBroadcast(this.deps.analytics, broadcastId, this.deps.clock.now()).catch((error) => this.deps.log.error('Could not close the broadcast record.', error));
		}
		this.state.pageToken = null;
		this.state.readerMode = null;
		this.deps.log.info(`Broadcast ${broadcastId ?? ''} ended; YouTube sync stopped.`);
	}

	// ---------- Reading YouTube chat ----------

	/** One page of YouTube chat, from the stream or a poll. */
	async handleChatPage(page: ChatPage, initial: boolean) {
		const result = await handlePage(this.readerContext, page, initial);
		if (page.nextPageToken) this.state.pageToken = page.nextPageToken;
		await this.saveState(false);
		if (page.offlineAt) this.soon('broadcast', 0);
		return result;
	}

	startReader(liveChatId: string) {
		if (!this.running || (this.reader && this.reader.liveChatId === liveChatId)) return;
		this.stopReader();
		const abort = new AbortController();
		const done = this.readLoop(liveChatId, abort.signal).catch((error) => this.deps.log.error('Reader stopped.', error));
		this.reader = { liveChatId, abort, done };
	}

	stopReader() {
		this.reader?.abort.abort();
		this.reader = null;
	}

	private async readLoop(liveChatId: string, signal: AbortSignal) {
		let streamFailures = 0;
		let failures = 0;
		// The first page after (re)connecting without a saved place is history.
		let initial = !this.state.pageToken;
		while (!signal.aborted) {
			const now = this.deps.clock.now();
			const useStream = streamFailures < 2;
			const call: QuotaCall = useStream ? 'streamMessages' : 'listMessages';
			if (!this.quota.canSpend(call, now)) {
				await sleep(60_000, signal);
				continue;
			}
			this.state.readerMode = useStream ? 'stream' : 'poll';
			try {
				if (useStream) {
					await this.api.streamMessages(liveChatId, this.state.pageToken, async (page) => {
						await this.handleChatPage(page, initial);
						initial = false;
						failures = 0;
					}, signal);
					// The server closed the stream; carry on from the saved place.
					await sleep(1_000, signal);
				} else {
					const page = await this.api.listMessages(liveChatId, this.state.pageToken);
					await this.handleChatPage(page, initial);
					initial = false;
					failures = 0;
					await sleep(Math.max(page.pollingIntervalMillis ?? 0, this.config.pollMinMs), signal);
				}
			} catch (error) {
				if (signal.aborted) return;
				const apiError = error instanceof YoutubeApiError ? error : new YoutubeApiError('transient', 0, 'unknown', String(error));
				this.recordError(`Reading YouTube chat failed: ${apiError.reason || apiError.message}`, apiError.reason);
				if (apiError.kind === 'quota') {
					await this.quotaExhausted();
					continue;
				}
				if (apiError.kind === 'chat_gone') {
					this.soon('broadcast', 0);
					return;
				}
				if (apiError.kind === 'auth_revoked') {
					this.authRevoked(apiError);
					return;
				}
				// The stream isn't available to us: use polling for the rest of this broadcast.
				if (useStream && apiError.kind === 'permanent') streamFailures++;
				failures++;
				await sleep(Math.min(60_000, 2_000 * 2 ** Math.min(failures, 5)), signal);
			}
		}
	}

	// ---------- Sending to YouTube ----------

	async processOutboxOnce() {
		if (this.outboxRunning) return true;
		this.outboxRunning = true;
		try {
			this.settings = await readSettings(this.deps.store);
			return await processOutbox(this.outboxContext);
		} finally {
			this.outboxRunning = false;
			await this.saveState(false).catch(() => undefined);
		}
	}

	/** A new message was queued in this process: send it now rather than at the next tick. */
	kickOutbox() {
		if (this.leader) this.soon('outbox', 0);
	}

	// ---------- Viewers and history ----------

	async refreshWebsiteViewers() {
		this.websiteViewers = await countViewers(this.deps.store, this.deps.clock);
		this.websiteViewersAt = this.websiteViewers === null ? null : this.deps.clock.now();
		await this.publish();
	}

	async takeSnapshot() {
		if (this.state.state !== 'LIVE' || !this.state.broadcastId || !this.deps.analytics) return null;
		// Quota used up: neither count is known (website heartbeats only count while it is known to be live).
		if (this.isBlind(this.deps.clock.now())) return null;
		return recordSnapshot(this.deps.analytics, {
			broadcastId: this.state.broadcastId,
			videoId: this.state.videoId ?? this.state.broadcastId,
			title: this.state.title ?? '',
			startedAt: this.state.startedAt,
			youtubeViewers: this.state.youtubeViewers,
			websiteViewers: this.websiteViewers,
		}, this.deps.clock.now(), { repeatWindowMs: this.config.snapshotMs * 3 });
	}

	// ---------- Lease and loops ----------

	async acquireLease() {
		const now = this.deps.clock.now();
		const { value } = await this.deps.store.transaction<{ owner: string; until: number }>(paths.lease, (current) =>
			!current || current.until < now || current.owner === this.deps.ownerId
				? { owner: this.deps.ownerId, until: now + this.config.leaseMs }
				: undefined);
		const leader = value?.owner === this.deps.ownerId;
		if (leader !== this.leader) this.deps.log.info(leader ? 'This process now runs the YouTube sync.' : 'Another process runs the YouTube sync.');
		this.leader = leader;
		return leader;
	}

	private soon(name: string, delay: number) {
		const task = this.tasks[name];
		if (!this.running || !task) return;
		clearTimeout(this.timers.get(name));
		this.timers.set(name, setTimeout(() => void this.runTask(name), delay));
	}

	private async runTask(name: string) {
		const task = this.tasks[name];
		let delay = 30_000;
		try {
			delay = await task();
		} catch (error) {
			this.deps.log.error(`${name} failed.`, error);
		}
		this.soon(name, delay);
	}

	/** Each loop returns the delay until it runs again. Only the lease holder does any work. */
	private readonly tasks: Record<string, () => Promise<number>> = {
		lease: async () => {
			const wasLeader = this.leader;
			const leader = await this.acquireLease().catch(() => false);
			if (wasLeader && !leader) this.stopReader();
			if (!wasLeader && leader) {
				await this.load();
				this.soon('broadcast', 0);
			}
			return Math.floor(this.config.leaseMs / 3);
		},
		broadcast: async () => {
			if (!this.leader) return this.config.broadcastCheckMs;
			await this.checkBroadcast();
			return checkDelay(this.state.state, { broadcastCheckMs: this.config.broadcastCheckMs, viewerRefreshMs: this.config.viewerRefreshMs }, this.errorsInARow);
		},
		outbox: async () => {
			if (!this.leader) return this.config.outboxMs * 5;
			const waiting = await this.processOutboxOnce();
			return this.state.state === 'LIVE' || waiting ? this.config.outboxMs : this.config.outboxMs * 10;
		},
		viewers: async () => {
			if (this.leader) await this.refreshWebsiteViewers();
			return this.config.websiteViewersMs;
		},
		snapshot: async () => {
			if (this.leader) await this.takeSnapshot();
			return this.config.snapshotMs;
		},
	};

	start() {
		if (this.running) return;
		this.running = true;
		for (const name of Object.keys(this.tasks)) this.soon(name, name === 'lease' ? 0 : 2_000);
	}

	async stop() {
		this.running = false;
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		this.stopReader();
		if (this.leader) {
			// Let another process take over at once instead of waiting for the lease to run out.
			await this.deps.store.transaction<{ owner: string; until: number }>(paths.lease, (current) =>
				current?.owner === this.deps.ownerId ? null : undefined).catch(() => undefined);
			this.leader = false;
		}
	}

	/** After an admin disconnects or connects the channel. */
	async reconnect() {
		this.deps.resetCredentials();
		this.stopReader();
		await this.refreshSettings();
		this.soon('broadcast', 0);
	}
}
