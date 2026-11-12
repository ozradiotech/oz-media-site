// The free way to see whether a channel is live: its public page, youtube.com/channel/<id>/live, which while a
// broadcast runs (or is scheduled) is that broadcast's watch page. No API key and no quota, so it is checked first; the
// YouTube Data API is only asked to confirm and follow what this finds. It reads YouTube's markup, so it needs
// revisiting if YouTube changes it, and it only sees *public* broadcasts (the API check every so often covers unlisted).
import type { FetchLike } from './api.ts';

export type PageStatus = { status: 'live' | 'upcoming' | 'none'; videoId: string };

export type PageCheck = (channelId: string) => Promise<PageStatus>;

/** Reads a channel's /live page from its HTML. */
export const parseLivePage = (html: string): PageStatus => {
	// Without a broadcast the page is the channel page, which has neither of these.
	const videoId = html.match(/"videoDetails":\{"videoId":"([\w-]{11})"/)?.[1]
		?? html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1]
		?? '';
	if (!videoId) return { status: 'none', videoId: '' };
	// A scheduled broadcast also has a watch page; only a running one says it is live, in either of two places.
	return { status: /"isLive":true|"isLiveNow":true/.test(html) ? 'live' : 'upcoming', videoId };
};

export const createPageCheck = (fetchImpl: FetchLike = fetch): PageCheck => async (channelId) => {
	const response = await fetchImpl(`https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`, {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
			'Accept-Language': 'en',
			// Skips the cookie consent page YouTube shows to visitors from some regions.
			Cookie: 'SOCS=CAI',
		},
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) throw new Error(`YouTube live page answered ${response.status}.`);
	return parseLivePage(await response.text());
};
