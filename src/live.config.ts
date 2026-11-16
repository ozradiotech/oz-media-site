// Content from the Payload CMS (oz-cms), fetched when a page is requested, so a published edit shows up within
// seconds instead of after a rebuild. Each collection keeps the shape the old Markdown collections had, so pages
// read `entry.data` as before; rich text comes as HTML for `render(entry)`.
import { defineLiveCollection } from 'astro:content';
import type { LiveLoader } from 'astro/loaders';
import { cmsFetch, mediaUrl, type CmsMedia } from './lib/cms';

interface Doc {
	id: number;
	slug: string;
	[field: string]: any;
}
interface DocList {
	docs: Doc[];
}

const image = (media: CmsMedia | number | null | undefined, fallbackAlt = '') => ({
	image: mediaUrl(media),
	imageAlt: (typeof media === 'object' && media?.alt) || fallbackAlt,
	// The original's shape, so pages can frame pictures that aren't landscape instead of cropping them.
	imageWidth: (typeof media === 'object' && media?.width) || undefined,
	imageHeight: (typeof media === 'object' && media?.height) || undefined,
});

/**
 * A loader for one Payload collection. The CMS only returns published items to the site, so everything here is
 * visible. Entries are found by slug, which is also the entry id (the old Markdown file name).
 */
const payload = <TData extends Record<string, any>>(
	collection: string,
	toData: (doc: Doc) => TData,
	options: { sort?: string; html?: string; depth?: number; id?: (doc: Doc) => string } = {},
): LiveLoader<TData, { id: string }> => {
	const { sort = '_order', html, depth = 1, id = (doc) => doc.slug } = options;
	const toEntry = (doc: Doc) => ({
		id: id(doc),
		data: toData(doc),
		rendered: html ? { html: doc[html] ?? '' } : undefined,
	});
	return {
		name: `payload:${collection}`,
		loadCollection: async () => {
			try {
				const { docs } = await cmsFetch<DocList>(`${collection}?limit=0&pagination=false&depth=${depth}&sort=${sort}`);
				return { entries: docs.map(toEntry) };
			} catch (error) {
				return { error: error as Error };
			}
		},
		loadEntry: async ({ filter }) => {
			try {
				const field = collection === 'social-stats' ? 'month' : 'slug';
				const query = `where[${field}][equals]=${encodeURIComponent(filter.id)}`;
				const { docs } = await cmsFetch<DocList>(`${collection}?${query}&limit=1&depth=${depth}`);
				return docs[0] ? toEntry(docs[0]) : undefined;
			} catch (error) {
				return { error: error as Error };
			}
		},
	};
};

const programs = defineLiveCollection({
	loader: payload(
		'programs',
		(doc) => ({
			title: doc.title as string,
			visible: true,
			order: 0,
			...image(doc.image, doc.title),
			schedule: (doc.schedule ?? []).map(({ days, time }: { days: string; time: string }) => ({ days, time })),
			// Announcer entry ids (slugs), as the Markdown files listed them.
			hosts: (doc.hosts ?? []).map((host: Doc | number) => (typeof host === 'object' ? host.slug : '')).filter(Boolean) as string[],
		}),
		{ html: 'descriptionHtml' },
	),
});

const announcers = defineLiveCollection({
	loader: payload(
		'announcers',
		(doc) => ({
			name: doc.name as string,
			visible: true,
			order: 0,
			...image(doc.image, ''),
			instagram: (doc.instagram ?? '') as string,
		}),
		{ html: 'profileHtml' },
	),
});

/** An optional text field: trimmed, or empty. */
const optional = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
/** An optional link: only full http(s) addresses get through. */
const link = (value: unknown) => (/^https?:\/\/\S+$/.test(optional(value)) ? optional(value) : '');
const date = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : undefined);
const videoTypes = new Set(['video/mp4', 'video/webm']);

const toActivity = (doc: Doc) => {
	const cover = image(doc.image, doc.title);
	const recapVideo = doc.recap?.video && typeof doc.recap.video === 'object' ? doc.recap.video : undefined;
	return {
		title: doc.title as string,
		visible: true,
		/** The category's value (`live-music`, …); `activityCategoryLabel` turns it into its name. */
		category: (doc.category ?? '') as string,
		eventStatus: (doc.eventStatus ?? 'scheduled') as 'scheduled' | 'postponed' | 'cancelled',
		featured: Boolean(doc.featured),
		/** Undated activities count as upcoming, "date to be announced". Midnight WIB means a date without a time. */
		startDate: date(doc.startDate),
		endDate: date(doc.endDate),
		venue: optional(doc.venue),
		mapsUrl: link(doc.mapsUrl),
		priceLabel: optional(doc.priceLabel),
		ticketUrl: link(doc.ticketUrl),
		summary: optional(doc.summary),
		...cover,
		/** The photo carousel on the activity's page: the cover first, then "More photos" in the CMS's order. */
		photos: [cover, ...(doc.gallery ?? []).map((media: CmsMedia | number) => image(media, doc.title))].filter((photo) => photo.image),
		/** OZ announcers at the event, with their portraits. */
		hosts: (doc.hosts ?? [])
			.filter((host: Doc | number): host is Doc => typeof host === 'object' && Boolean(host?.name))
			.map((host: Doc) => ({ slug: host.slug as string, name: host.name as string, instagram: optional(host.instagram), ...image(host.image, host.name) })),
		lineup: (doc.lineup ?? [])
			.filter((act: { name?: string }) => optional(act?.name))
			.map((act: { name: string; note?: string; url?: string }) => ({ name: optional(act.name), note: optional(act.note), url: link(act.url) })),
		partners: (doc.partners ?? [])
			.filter((partner: { name?: string }) => optional(partner?.name))
			.map((partner: { name: string; url?: string; logo?: CmsMedia | number | null }) => ({
				name: optional(partner.name),
				url: link(partner.url),
				logo: mediaUrl(partner.logo),
			})),
		/** A YouTube link wins over an uploaded video; empty when neither is set. */
		recap: {
			youtubeUrl: link(doc.recap?.youtubeUrl),
			videoUrl: recapVideo && /^https?:\/\//.test(recapVideo.url ?? '') ? (recapVideo.url as string) : '',
			videoType: recapVideo && videoTypes.has(recapVideo.mimeType) ? (recapVideo.mimeType as string) : 'video/mp4',
		},
	};
};
export type ActivityData = ReturnType<typeof toActivity>;

// Depth 2 so the hosts come with their portraits.
const activities = defineLiveCollection({
	loader: payload('activities', toActivity, { sort: '-startDate', html: 'bodyHtml', depth: 2 }),
});

const toNews = (doc: Doc) => ({
	title: doc.title as string,
	visible: true,
	/** The category's value (`sports`, …); `newsCategoryLabel` turns it into its name. Empty when none is set. */
	category: (doc.category ?? '') as string,
	publishedAt: doc.publishedAt ? new Date(doc.publishedAt) : undefined,
	summary: (doc.summary ?? '') as string,
	/** The byline: the author's name in the CMS, or empty for the newsroom. */
	authorName: (doc.authorName ?? '') as string,
	sourceName: (doc.sourceName ?? '') as string,
	sourceUrl: (doc.sourceUrl ?? '') as string,
	...image(doc.image, ''),
});
export type NewsData = ReturnType<typeof toNews>;

const news = defineLiveCollection({
	loader: payload('news', toNews, { sort: '-publishedAt', html: 'bodyHtml' }),
});

// The monthly social media numbers for /analytics. The CMS shows these to the website's API key only.
type Counts = Record<string, number>;
const analytics = defineLiveCollection({
	loader: payload(
		'social-stats',
		(doc) => {
			const strip = <T extends Record<string, any>>(group: T): T =>
				Object.fromEntries(
					Object.entries(group ?? {}).map(([key, value]) => [key, value && typeof value === 'object' ? strip(value) : (value ?? 0)]),
				) as T;
			return {
				month: doc.month as string,
				placeholder: Boolean(doc.placeholder),
				youtube: strip(doc.youtube) as Counts & { trafficSources: Counts },
				instagram: strip(doc.instagram) as Counts & { contentViews: Counts },
				tiktok: strip(doc.tiktok) as Counts & { trafficSources: Counts },
			};
		},
		{ sort: 'month', depth: 0, id: (doc) => doc.month },
	),
});

export const collections = { programs, announcers, activities, news, analytics };
