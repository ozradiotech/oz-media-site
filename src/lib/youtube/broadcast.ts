// Broadcast detection: what YouTube says about the channel's broadcasts, and the state that follows from it.
import type { Broadcast, LiveDetails, YoutubeApi } from './api.ts';
import type { BroadcastState } from './types.ts';

export type Observation =
	/** A public broadcast is live. `liveChatId` is null if its chat is off. */
	| { kind: 'live'; broadcastId: string; videoId: string; title: string; liveChatId: string | null; startedAt: number | null; viewers: number | null }
	| { kind: 'upcoming'; broadcastId: string; title: string }
	/** Nothing live or scheduled, or the broadcast we were following has ended. */
	| { kind: 'none' }
	| { kind: 'error'; message: string };

// `testing` is the private preview before going public: not live for viewers, so not synced.
const liveStatuses = new Set(['live', 'liveStarting']);
const upcomingStatuses = new Set(['created', 'ready', 'testStarting', 'testing']);

const time = (value: string | null) => {
	const parsed = Date.parse(value ?? '');
	return Number.isFinite(parsed) ? parsed : null;
};

const fromLive = (broadcast: Broadcast, details: LiveDetails | null): Observation => ({
	kind: 'live',
	broadcastId: broadcast.id,
	// A broadcast's id is its video's id.
	videoId: broadcast.id,
	title: broadcast.title,
	liveChatId: details?.activeLiveChatId ?? broadcast.liveChatId,
	startedAt: time(details?.actualStartTime ?? broadcast.actualStartTime),
	viewers: details?.concurrentViewers ?? null,
});

/**
 * Looks for a live broadcast (1 unit, plus 1 for its details). Scheduled broadcasts are only looked for when
 * `includeUpcoming`, which saves a unit on most checks.
 */
export const discover = async (api: YoutubeApi, includeUpcoming: boolean): Promise<Observation> => {
	const active = (await api.broadcasts('active')).find((broadcast) => liveStatuses.has(broadcast.lifeCycleStatus));
	if (active) return fromLive(active, await api.liveDetails(active.id));
	if (!includeUpcoming) return { kind: 'none' };
	const upcoming = (await api.broadcasts('upcoming')).find((broadcast) => upcomingStatuses.has(broadcast.lifeCycleStatus));
	return upcoming ? { kind: 'upcoming', broadcastId: upcoming.id, title: upcoming.title } : { kind: 'none' };
};

/**
 * The free public page (page-check.ts) says this video is live: confirm it with the API (1 unit) and get its live chat.
 * A video that hasn't started or has ended is not live, whatever the page said.
 */
export const confirmLive = async (api: YoutubeApi, videoId: string): Promise<Observation> => {
	const details = await api.liveDetails(videoId);
	if (!details || details.actualEndTime || !details.actualStartTime) return { kind: 'none' };
	return {
		kind: 'live',
		broadcastId: videoId,
		videoId,
		title: details.title,
		liveChatId: details.activeLiveChatId,
		startedAt: time(details.actualStartTime),
		viewers: details.concurrentViewers,
	};
};

/** While live, only the video is checked (1 unit): it carries the viewer count and says when the broadcast ends. */
export const followLive = async (api: YoutubeApi, current: { broadcastId: string; title: string }): Promise<Observation> => {
	const details = await api.liveDetails(current.broadcastId);
	// Gone, or it has an end time: over.
	if (!details || details.actualEndTime) return { kind: 'none' };
	return {
		kind: 'live',
		broadcastId: current.broadcastId,
		videoId: details.videoId,
		title: details.title || current.title,
		// Null while the chat is switched off; the sync pauses until it is back.
		liveChatId: details.activeLiveChatId,
		startedAt: time(details.actualStartTime),
		viewers: details.concurrentViewers,
	};
};

/** The next state. A few failed checks in a row while live don't stop the sync: `errorsInARow` counts them. */
export const nextState = (previous: BroadcastState, observation: Observation, errorsInARow = 0): BroadcastState => {
	switch (observation.kind) {
		case 'live':
			return 'LIVE';
		case 'upcoming':
			return previous === 'LIVE' ? 'ENDING' : 'UPCOMING';
		case 'none':
			if (previous === 'LIVE') return 'ENDING';
			if (previous === 'ENDING') return 'ENDED';
			return 'OFFLINE';
		case 'error':
			return previous === 'LIVE' && errorsInARow < 3 ? 'LIVE' : 'ERROR';
	}
};

export type Intervals = { broadcastCheckMs: number; viewerRefreshMs: number };

/** How long until the next check, by state. Errors back off up to the offline interval. */
export const checkDelay = (state: BroadcastState, intervals: Intervals, errorsInARow = 0) => {
	switch (state) {
		case 'LIVE':
			return intervals.viewerRefreshMs;
		case 'UPCOMING':
			return Math.min(60_000, intervals.broadcastCheckMs);
		case 'ENDING':
			return 1_000;
		case 'ERROR':
			return Math.min(intervals.broadcastCheckMs, 15_000 * 2 ** Math.min(errorsInARow, 5));
		default:
			return intervals.broadcastCheckMs;
	}
};
