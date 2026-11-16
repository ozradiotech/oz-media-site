// The Online digital section's content, put together from three sources: the YouTube channel's public feed (its 15
// newest uploads, no API key or quota), the videos pinned in the CMS (Digital → Socials → YouTube) and the Instagram and
// TikTok posts added in the CMS (Digital → Social posts). Pure, so it is tested on its own (tests/online-feed.test.ts);
// src/lib/online.ts fetches.

export type FeedVideo = {
	id: string;
	title: string;
	/** ISO date; empty for pinned videos, which come from the CMS without one. */
	publishedAt: string;
	views: number | null;
	/** Uploaded as a Short (its link is /shorts/…). */
	short: boolean;
};

export type PostCard = {
	platform: 'youtube' | 'instagram' | 'tiktok';
	url: string;
	image: string;
	caption: string;
	postedAt: string;
};

export type OnlineContent = {
	/** The large player's video first, then the rest of the list. Empty when the feed failed and nothing is pinned. */
	videos: FeedVideo[];
	/** Shorts and Instagram/TikTok posts, newest first. */
	posts: PostCard[];
};

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (value: string) =>
	value.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, code: string) => {
		if (code[0] !== '#') return entities[code] ?? match;
		const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
		return Number.isFinite(point) ? String.fromCodePoint(point) : match;
	});

/** The entries of https://www.youtube.com/feeds/videos.xml?channel_id=…, newest first as YouTube lists them. */
export const parseYoutubeFeed = (xml: string): FeedVideo[] =>
	Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g), ([, entry]) => {
		const id = entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1] ?? '';
		const views = entry.match(/<media:statistics views="(\d+)"/)?.[1];
		return {
			id,
			title: decode(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? ''),
			publishedAt: entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? '',
			views: views === undefined ? null : Number(views),
			short: /<link rel="alternate" href="https:\/\/www\.youtube\.com\/shorts\//.test(entry),
		};
	}).filter((video) => video.id && video.title);

/**
 * A livestream's recording under the streaming app's default title ("Live streaming of OZ Media"). Many a week and all
 * named alike, so they stay under Past livestreams instead of filling the list. A recording given a real title counts
 * as a video.
 */
export const isStreamReplay = (video: Pick<FeedVideo, 'title'>) => /^live\s*streaming of\b/i.test(video.title);

/** How many videos the YouTube card shows: one large, the rest in the list beside it. */
export const videoCount = 5;
/** How many posts the posts card holds. */
export const postCount = 12;

export const buildOnlineContent = ({
	feed,
	pinned,
	posts,
}: {
	feed: FeedVideo[];
	pinned: { id: string; title: string }[];
	posts: PostCard[];
}): OnlineContent => {
	const uploads = feed.filter((video) => !video.short);
	const episodes = uploads.filter((video) => !isStreamReplay(video));
	// Pinned first, then the newest videos; only stream recordings when there is nothing else.
	const candidates = [
		...pinned.map((video) => feed.find((entry) => entry.id === video.id) ?? { ...video, publishedAt: '', views: null, short: false }),
		...(episodes.length ? episodes : uploads),
	];
	const videos = candidates.filter((video, index) => candidates.findIndex((other) => other.id === video.id) === index).slice(0, videoCount);
	const shorts: PostCard[] = feed
		.filter((video) => video.short)
		.map((video) => ({
			platform: 'youtube',
			url: `https://www.youtube.com/shorts/${video.id}`,
			// The 4:3 picture letterboxes the upright Short in its middle third, which is what an upright card crops to.
			image: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
			caption: video.title,
			postedAt: video.publishedAt,
		}));
	const time = (value: string) => Date.parse(value) || 0;
	return {
		videos,
		posts: [...shorts, ...posts].sort((a, b) => time(b.postedAt) - time(a.postedAt)).slice(0, postCount),
	};
};

/** A CMS Social post as the REST API returns it (depth 1, so the cover comes with its sizes). */
export type CmsSocialPost = {
	url?: string | null;
	caption?: string | null;
	postedAt?: string | null;
	platform?: string | null;
	cover?: { url?: string | null; sizes?: Record<string, { url?: string | null; width?: number | null } | undefined> } | number | null;
};

/** The CMS's posts as cards; one without a link, cover or known platform is left out. `image` picks the cover's size. */
export const postCards = (docs: CmsSocialPost[], image: (cover: NonNullable<CmsSocialPost['cover']>) => string): PostCard[] =>
	docs.flatMap((doc) => {
		const platform = doc.platform === 'instagram' || doc.platform === 'tiktok' ? doc.platform : null;
		const src = doc.cover ? image(doc.cover) : '';
		if (!platform || !doc.url || !/^https:\/\//.test(doc.url) || !src) return [];
		return [{ platform, url: doc.url, image: src, caption: doc.caption?.trim() ?? '', postedAt: doc.postedAt ?? '' }];
	});

/** "16 Nov" this year, "16 Nov 2025" before; empty for no date. Jakarta time. */
export const shortDate = (iso: string, now = new Date()) => {
	const time = Date.parse(iso);
	if (!time) return '';
	const year = (date: Date | number) => new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date);
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		...(year(time) === year(now) ? {} : { year: 'numeric' }),
		timeZone: 'Asia/Jakarta',
	}).format(time);
};

/** "1.2K views". */
export const viewCount = (views: number | null) =>
	views === null ? '' : `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(views)} ${views === 1 ? 'view' : 'views'}`;
