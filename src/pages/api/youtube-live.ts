import type { APIRoute } from 'astro';
import { defaultStationSettings } from '../../lib/station-defaults';
import { createPageCheck } from '../../lib/youtube/page-check';
import { isYoutubeConfigured, publicLiveState } from '../../lib/youtube/runtime';

// `?channel=UC…` picks the YouTube channel. Without one: the channel connected to the YouTube integration, or else the
// built-in one (OZ Media). The page sends the channel set in the CMS (Broadcast → Streams), if any.
const defaultChannel = defaultStationSettings.youtubeLive.channelId;
// A found broadcast is reused for a minute; "not live" only briefly, so a stream that just started shows up soon.
const liveCacheMs = 60_000;
const offlineCacheMs = 20_000;

type LiveStatus = { live: boolean; videoId: string; source?: 'api' | 'page' };
const cache = new Map<string, { status: LiveStatus; expires: number }>();

// 1. When the YouTube integration (src/lib/youtube) has this channel connected, its state is the answer: it comes from
//    the YouTube Data API, sees unlisted broadcasts too, and costs no extra quota (the worker checks anyway).
const fromIntegration = async (channel: string): Promise<LiveStatus | null> => {
	if (!isYoutubeConfigured) return null;
	const state = await publicLiveState();
	if (!state || state.channelId !== channel) return null;
	return state.state === 'live' && state.videoId ? { live: true, videoId: state.videoId, source: 'api' } : { live: false, videoId: '', source: 'api' };
};

// 2. Otherwise YouTube's public page for the channel (src/lib/youtube/page-check.ts): free, but it only sees public
//    broadcasts, and YouTube can take a few minutes after going live before it points at the stream. (The channel's
//    live embed, embed/live_stream?channel=…, answers "This video is unavailable" for this channel, so the broadcast's own
//    video is looked up and embedded instead.)
const pageCheck = createPageCheck();
const fromPage = async (channel: string): Promise<LiveStatus> => {
	const page = await pageCheck(channel);
	return page.status === 'live' ? { live: true, videoId: page.videoId, source: 'page' } : { live: false, videoId: '', source: 'page' };
};

export const GET: APIRoute = async ({ url }) => {
	const requestedChannel = url.searchParams.get('channel') ?? '';
	const connectedChannel = isYoutubeConfigured ? (await publicLiveState())?.channelId ?? null : null;
	const channel = /^UC[\w-]{22}$/.test(requestedChannel) ? requestedChannel : connectedChannel ?? defaultChannel;
	const headers = { 'Cache-Control': 'public, max-age=15' };

	const cached = cache.get(channel);
	if (cached && cached.expires > Date.now()) return Response.json(cached.status, { headers });

	// The integration's "live" is trusted at once; its "not live" can lag a check behind, so the page is still asked.
	const api = await fromIntegration(channel).catch(() => null);
	try {
		const status = api?.live ? api : await fromPage(channel);
		cache.set(channel, { status, expires: Date.now() + (status.live ? liveCacheMs : offlineCacheMs) });
		return Response.json(status, { headers });
	} catch {
		if (api) return Response.json(api, { headers });
		return Response.json({ live: false, videoId: '' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
	}
};
