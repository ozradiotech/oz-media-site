// Server only. The Online digital section's videos and posts (src/lib/online-feed.ts says what goes where).
import { YOUTUBE_CHANNEL_ID } from 'astro:env/server';
import { cmsFetch, cmsImage, mediaUrl, type CmsMedia } from './cms';
import { buildOnlineContent, parseYoutubeFeed, postCards, postCount, type CmsSocialPost, type FeedVideo } from './online-feed';
import { defaultStationSettings, type StationSettings } from './station-defaults';

// YouTube updates the feed within minutes of an upload; a quarter of an hour is soon enough and keeps us polite.
const feedCacheMs = 15 * 60_000;
// After a failure, try again sooner, meanwhile showing the last feed that worked.
const feedRetryMs = 60_000;
const feeds = new Map<string, { at: number; ttl: number; videos: Promise<FeedVideo[]> }>();

const fetchFeed = async (channelId: string) => {
	const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) throw new Error(`YouTube feed answered ${response.status}.`);
	return parseYoutubeFeed(await response.text());
};

/** The channel's newest uploads, cached; the last good list (or none) if YouTube can't be reached. */
const youtubeFeed = (channelId: string): Promise<FeedVideo[]> => {
	const hit = feeds.get(channelId);
	if (hit && Date.now() - hit.at < hit.ttl) return hit.videos;
	const previous = hit?.videos ?? Promise.resolve([]);
	const videos = fetchFeed(channelId).catch(async (error) => {
		console.error('[online] YouTube feed:', error);
		feeds.set(channelId, { at: Date.now(), ttl: feedRetryMs, videos: previous });
		return previous;
	});
	feeds.set(channelId, { at: Date.now(), ttl: feedCacheMs, videos });
	return videos;
};

const socialPosts = () =>
	cmsFetch<{ docs: CmsSocialPost[] }>(`social-posts?where[_status][equals]=published&sort=-postedAt&limit=${postCount}&depth=1`)
		.then(({ docs }) => postCards(docs, (cover) => cmsImage(mediaUrl(cover as CmsMedia), 400)))
		.catch((error) => {
			console.error('[online] social posts:', error);
			return [];
		});

/**
 * The videos and posts for OZ Bandung's Online digital section. The videos come from the livestream's channel
 * (Broadcast → Streams), else the one the YouTube integration is locked to, else the built-in one.
 */
export const getOnlineContent = async (station: StationSettings) => {
	const channelId = station.youtubeLive.channelId || YOUTUBE_CHANNEL_ID?.trim() || defaultStationSettings.youtubeLive.channelId;
	const [feed, posts] = await Promise.all([youtubeFeed(channelId), socialPosts()]);
	return buildOnlineContent({ feed, pinned: station.youtube.videos, posts });
};
