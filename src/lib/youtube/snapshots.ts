// Livestream history for /analytics. Firebase carries the live numbers; every few minutes while a broadcast is live,
// one snapshot of both counts goes to the CMS's Postgres (oz-cms: livestream-broadcasts, livestream-snapshots).
// Heartbeats are never written there. A count that wasn't available is stored as empty, never as zero.

export type Availability = 'both' | 'youtube_only' | 'website_only' | 'none';

export type SnapshotInput = {
	broadcastId: string;
	videoId: string;
	title: string;
	startedAt: number | null;
	youtubeViewers: number | null;
	websiteViewers: number | null;
};

export type BroadcastDoc = {
	id: string | number;
	broadcastId: string;
	startedAt?: string | null;
	endedAt?: string | null;
	peakYoutubeViewers?: number | null;
	peakWebsiteViewers?: number | null;
	youtubeViewerSum?: number | null;
	youtubeSamples?: number | null;
	websiteViewerSum?: number | null;
	websiteSamples?: number | null;
};

export type SnapshotDoc = {
	youtubeConcurrentViewers: number | null;
	websiteActiveViewers: number | null;
	recordedAt: string;
};

/** The CMS calls the snapshots need; the real one is in runtime.ts. */
export interface AnalyticsStore {
	findBroadcast(broadcastId: string): Promise<BroadcastDoc | null>;
	createBroadcast(data: Omit<BroadcastDoc, 'id'> & { videoId: string; title: string }): Promise<BroadcastDoc>;
	updateBroadcast(id: BroadcastDoc['id'], data: Partial<BroadcastDoc>): Promise<BroadcastDoc>;
	latestSnapshot(broadcast: BroadcastDoc['id']): Promise<SnapshotDoc | null>;
	createSnapshot(data: SnapshotDoc & {
		broadcast: BroadcastDoc['id'];
		videoId: string;
		combinedEstimatedViewers: number | null;
		dataAvailability: Availability;
	}): Promise<unknown>;
}

export const availability = (youtube: number | null, website: number | null): Availability =>
	youtube !== null && website !== null ? 'both' : youtube !== null ? 'youtube_only' : website !== null ? 'website_only' : 'none';

/** Only when both are known: an estimate, since one person can be counted on both sides. */
export const combinedEstimate = (youtube: number | null, website: number | null) =>
	youtube !== null && website !== null ? youtube + website : null;

const iso = (time: number) => new Date(time).toISOString();

/**
 * Takes a snapshot unless it would repeat the last one: same numbers within `repeatWindowMs` are skipped, so a quiet
 * broadcast doesn't fill the table. The last snapshot is read back from the CMS, so this holds across restarts too.
 */
export const recordSnapshot = async (
	store: AnalyticsStore,
	input: SnapshotInput,
	now: number,
	options: { repeatWindowMs: number },
): Promise<'recorded' | 'skipped'> => {
	const broadcast = (await store.findBroadcast(input.broadcastId)) ?? (await store.createBroadcast({
		broadcastId: input.broadcastId,
		videoId: input.videoId,
		title: input.title,
		startedAt: iso(input.startedAt ?? now),
		endedAt: null,
		peakYoutubeViewers: null,
		peakWebsiteViewers: null,
		youtubeViewerSum: 0,
		youtubeSamples: 0,
		websiteViewerSum: 0,
		websiteSamples: 0,
	}));

	const last = await store.latestSnapshot(broadcast.id);
	if (
		last &&
		last.youtubeConcurrentViewers === input.youtubeViewers &&
		last.websiteActiveViewers === input.websiteViewers &&
		now - Date.parse(last.recordedAt) < options.repeatWindowMs
	) {
		return 'skipped';
	}

	await store.createSnapshot({
		broadcast: broadcast.id,
		videoId: input.videoId,
		youtubeConcurrentViewers: input.youtubeViewers,
		websiteActiveViewers: input.websiteViewers,
		combinedEstimatedViewers: combinedEstimate(input.youtubeViewers, input.websiteViewers),
		dataAvailability: availability(input.youtubeViewers, input.websiteViewers),
		recordedAt: iso(now),
	});

	// Peaks and the running sums behind the averages, counting only snapshots where the number was known.
	const update: Partial<BroadcastDoc> = { endedAt: null };
	if (input.youtubeViewers !== null) {
		update.peakYoutubeViewers = Math.max(broadcast.peakYoutubeViewers ?? 0, input.youtubeViewers);
		update.youtubeViewerSum = (broadcast.youtubeViewerSum ?? 0) + input.youtubeViewers;
		update.youtubeSamples = (broadcast.youtubeSamples ?? 0) + 1;
	}
	if (input.websiteViewers !== null) {
		update.peakWebsiteViewers = Math.max(broadcast.peakWebsiteViewers ?? 0, input.websiteViewers);
		update.websiteViewerSum = (broadcast.websiteViewerSum ?? 0) + input.websiteViewers;
		update.websiteSamples = (broadcast.websiteSamples ?? 0) + 1;
	}
	await store.updateBroadcast(broadcast.id, update);
	return 'recorded';
};

export const closeBroadcast = async (store: AnalyticsStore, broadcastId: string, endedAt: number) => {
	const broadcast = await store.findBroadcast(broadcastId);
	if (broadcast && !broadcast.endedAt) await store.updateBroadcast(broadcast.id, { endedAt: iso(endedAt) });
};
