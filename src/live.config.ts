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

const activities = defineLiveCollection({
	loader: payload(
		'activities',
		(doc) => ({
			title: doc.title as string,
			visible: true,
			category: doc.category as string,
			artStyle: (doc.artStyle ?? 'listen') as 'listen' | 'meet' | 'create',
			artLabel: (doc.artLabel ?? '') as string,
			status: (doc.status ?? '') as string,
			order: 0,
			summary: (doc.summary ?? '') as string,
			...image(doc.image, doc.title),
		}),
		{ html: 'bodyHtml' },
	),
});

const toNews = (doc: Doc) => ({
	title: doc.title as string,
	visible: true,
	category: (doc.category ?? 'OZ News') as string,
	publishedAt: doc.publishedAt ? new Date(doc.publishedAt) : undefined,
	summary: (doc.summary ?? '') as string,
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
