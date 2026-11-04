import { getCollection, type CollectionEntry } from 'astro:content';

// OZ News lives under OZ Bandung: /oz-bandung/news lists every article, /oz-bandung/news/<file name> shows one.
export type NewsEntry = CollectionEntry<'news'>;

export const newsIndexPath = '/oz-bandung/news';
export const newsPath = (entry: NewsEntry) => `${newsIndexPath}/${entry.id}`;

/** Newest first; undated articles sink to the bottom, ties go alphabetical. */
export const sortNews = (entries: NewsEntry[]) => [...entries].sort((a, b) => {
	const dateDifference = (b.data.publishedAt?.getTime() ?? 0) - (a.data.publishedAt?.getTime() ?? 0);
	return dateDifference || a.data.title.localeCompare(b.data.title);
});

/** Articles switched on in the CMS ("Show on site"), newest first. */
export const getVisibleNews = async () => sortNews(await getCollection('news', ({ data }) => data.visible));

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

/** Minutes at ~200 words a minute, counted from the summary and the Markdown body. */
export const readingMinutes = (entry: NewsEntry) => {
	const text = `${entry.data.summary} ${entry.body ?? ''}`.replace(/[#*_>`[\]()!-]/g, ' ');
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
