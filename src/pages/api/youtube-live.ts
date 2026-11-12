import type { APIRoute } from 'astro';
import { defaultStationSettings } from '../../lib/station-defaults';
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

// 2. Otherwise YouTube's page. The channel live embed (embed/live_stream?channel=…) answers "This video is unavailable"
//    for this channel, while the embed for the broadcast itself plays, so the broadcast is looked up here: while a
//    channel is live, youtube.com/channel/<id>/live is that broadcast's watch page. No API key, which also means this
//    reads YouTube's markup and needs revisiting if YouTube changes it. It only ever finds *public* streams, and YouTube
//    can take a few minutes after going live before /live points at the stream.
const fromPage = async (channel: string): Promise<LiveStatus> => {
	const response = await fetch(`https://www.youtube.com/channel/${channel}/live`, {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
			'Accept-Language': 'en',
			// Skips the cookie consent page YouTube shows to visitors from some regions.
			Cookie: 'SOCS=CAI',
		},
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) throw new Error('YouTube live page request failed.');

	const html = await response.text();
	// Without a broadcast the page is the channel page, which has neither of these.
	const videoId = html.match(/"videoDetails":\{"videoId":"([\w-]{11})"/)?.[1]
		?? html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1]
		?? '';
	// A scheduled broadcast also has a watch page; only a running one says it is live, in either of two places.
	const live = Boolean(videoId) && /"isLive":true|"isLiveNow":true/.test(html);
	return { live, videoId: live ? videoId : '', source: 'page' };
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
