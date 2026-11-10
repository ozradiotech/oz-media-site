import type { APIRoute } from 'astro';

// `?channel=UC…` picks the YouTube channel; without one (or with an invalid id) it falls back to OZ Media.
const defaultChannel = 'UCdc4ztl0di-Fv58CI5TK73w';
// One lookup per channel per minute, however many visitors ask, so a new broadcast shows up within a minute.
const cacheMs = 60_000;

type LiveStatus = { live: boolean; videoId: string };
const cache = new Map<string, { status: LiveStatus; expires: number }>();

// YouTube's channel live embed (embed/live_stream?channel=…) answers "This video is unavailable" for this channel,
// while the embed for the broadcast itself plays. So the broadcast is looked up here: while a channel is live,
// youtube.com/channel/<id>/live is that broadcast's watch page. There is no API key involved, which also means this
// reads YouTube's page markup and needs revisiting if YouTube changes it.
const lookUp = async (channel: string): Promise<LiveStatus> => {
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
	// Without a broadcast the page is the channel page, which has no videoDetails.
	const videoId = html.match(/"videoDetails":\{"videoId":"([\w-]{11})"/)?.[1] ?? '';
	// A scheduled broadcast also has a watch page, but its videoDetails only gain "isLive" once it starts.
	const live = Boolean(videoId) && /"isLive":true/.test(html);
	return { live, videoId: live ? videoId : '' };
};

export const GET: APIRoute = async ({ url }) => {
	const requestedChannel = url.searchParams.get('channel') ?? '';
	const channel = /^UC[\w-]{22}$/.test(requestedChannel) ? requestedChannel : defaultChannel;
	const headers = { 'Cache-Control': 'public, max-age=30' };

	const cached = cache.get(channel);
	if (cached && cached.expires > Date.now()) return Response.json(cached.status, { headers });

	try {
		const status = await lookUp(channel);
		cache.set(channel, { status, expires: Date.now() + cacheMs });
		return Response.json(status, { headers });
	} catch {
		return Response.json({ live: false, videoId: '' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
	}
};
