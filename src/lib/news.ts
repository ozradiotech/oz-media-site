import { getLiveCollection, type LiveDataEntry } from 'astro:content';
import type { NewsData } from '../live.config';

// OZ News lives under OZ Bandung: /oz-bandung/news lists every article, /oz-bandung/news/<slug> shows one.
export type NewsEntry = LiveDataEntry<NewsData>;

/** Every published article, from the CMS. A CMS outage leaves the list empty rather than breaking the page. */
const getNews = async () => {
	const { entries, error } = await getLiveCollection('news');
	if (error) console.error('[news]', error);
	return (entries ?? []) as NewsEntry[];
};

export const newsIndexPath = '/oz-bandung/news';
export const newsPath = (entry: NewsEntry) => `${newsIndexPath}/${entry.id}`;

/** Newest first; undated articles sink to the bottom, ties go alphabetical. */
export const sortNews = (entries: NewsEntry[]) => [...entries].sort((a, b) => {
	const dateDifference = (b.data.publishedAt?.getTime() ?? 0) - (a.data.publishedAt?.getTime() ?? 0);
	return dateDifference || a.data.title.localeCompare(b.data.title);
});

/** Published articles, newest first. */
export const getVisibleNews = async () => sortNews(await getNews());

/**
 * The news categories, in the order the filter shows them. Values match the CMS's list (oz-cms
 * src/newsCategories.ts); add or rename a category in both places.
 */
export const newsCategories = [
	{ value: 'politics', label: 'Politics & Government' },
	{ value: 'business', label: 'Business & Economy' },
	{ value: 'science', label: 'Science & Technology' },
	{ value: 'health', label: 'Health & Environment' },
	{ value: 'sports', label: 'Sports' },
	{ value: 'entertainment', label: 'Entertainment & Culture' },
] as const;

/** The category's name for kickers and the filter; "OZ News" when an article has none. */
export const newsCategoryLabel = (value: string) =>
	newsCategories.find((category) => category.value === value)?.label ?? 'OZ News';

/** The byline name: the author's name from the CMS, or the newsroom. */
export const newsAuthor = (entry: NewsEntry) => entry.data.authorName || 'OZ Radio Bandung Newsroom';

/**
 * Pictures that aren't landscape (narrower than 3:2) are shown whole on a blurred copy of themselves instead of
 * being cropped to the 16:9 frame. Spread the result onto the element that holds the <img> (see [data-boxed] in
 * src/styles/media-fit.css). Pictures without a known size are left as they are.
 */
export const imageFrame = (data: { image: string; imageWidth?: number; imageHeight?: number }, src = data.image) => {
	const boxed = Boolean(data.imageWidth && data.imageHeight && data.imageWidth / data.imageHeight < 1.5);
	return boxed ? { 'data-boxed': '', style: `--media-fit-image: url("${src.replace(/"/g, '%22')}")` } : {};
};

// Dates print in the newsroom's own time zone, whatever the server's is.
const newsTimeZone = 'Asia/Jakarta';

export const formatNewsDate = (date: Date) =>
	date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: newsTimeZone });

export const formatNewsShortDate = (date: Date) =>
	date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: newsTimeZone });

export const formatNewsDateTime = (date: Date) => {
	const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: newsTimeZone });
	const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: newsTimeZone }).replace(':', '.');
	return `${day}, ${time} WIB`;
};

/** Minutes at ~200 words a minute, counted from the summary and the article text. */
export const readingMinutes = (entry: NewsEntry) => {
	const text = `${entry.data.summary} ${entry.rendered?.html ?? ''}`.replace(/<[^>]*>/g, ' ');
	const words = text.split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.round(words / 200));
};

// Common Indonesian and English words that say nothing about what a story is about.
const stopWords = new Set(`yang dan di ke dari untuk dengan pada dalam ini itu juga akan tidak sudah telah oleh karena
	sebagai atau bisa dapat lebih kembali masih setelah saat secara para serta hingga tersebut menjadi ada adalah agar
	bagi kami kita mereka ia dia nya pun lagi baru satu dua tiga hari tahun bulan resmi kini jadi begitu sangat
	the a an of to in on for and is are was with by at from as its it be this that new`.split(/\s+/));

const keywords = (entry: NewsEntry) => new Set(
	`${entry.data.title} ${entry.data.summary}`
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 2 && !stopWords.has(word)),
);

/**
 * Stories to read next: the ones sharing the most words with this article's title and summary,
 * with a nudge toward stories published around the same time. Falls back to the latest when nothing overlaps.
 */
export const relatedNews = (entry: NewsEntry, all: NewsEntry[], count: number) => {
	const own = keywords(entry);
	const ownTime = entry.data.publishedAt?.getTime() ?? 0;
	return all
		.filter((other) => other.id !== entry.id)
		.map((other, index) => {
			let shared = 0;
			for (const word of keywords(other)) if (own.has(word)) shared += 1;
			const daysApart = Math.abs(ownTime - (other.data.publishedAt?.getTime() ?? 0)) / 86400000;
			return { other, index, score: shared * 3 + 1 / (1 + daysApart / 30) };
		})
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, count)
		.map(({ other }) => other);
};
