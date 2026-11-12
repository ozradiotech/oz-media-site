// Server only. Reads the Payload CMS (oz-cms) over its REST API for the live collections in src/live.config.ts.
import { CMS_API_KEY, CMS_URL } from 'astro:env/server';

/** How long a response is reused before asking the CMS again. Short, so edits show up almost at once. */
const cacheMs = 30_000;
const cache = new Map<string, { at: number; value: Promise<any> }>();

/** GET /api/<path> as the website user, with a short in-memory cache shared by every request. */
export const cmsFetch = async <T>(path: string): Promise<T> => {
	const hit = cache.get(path);
	if (hit && Date.now() - hit.at < cacheMs) return hit.value;
	const value = fetch(new URL(`/api/${path}`, CMS_URL), {
		headers: CMS_API_KEY ? { Authorization: `users API-Key ${CMS_API_KEY}` } : {},
	}).then(async (response) => {
		if (!response.ok) throw new Error(`CMS ${response.status} for /api/${path}: ${await response.text()}`);
		return response.json();
	});
	cache.set(path, { at: Date.now(), value });
	// A failed request is not kept, so the next page view tries again.
	value.catch(() => cache.delete(path));
	return value;
};

/** An uncached request as the website user, for the few things the site writes (the livestream history). */
export const cmsRequest = async <T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> => {
	const response = await fetch(new URL(`/api/${path}`, CMS_URL), {
		method,
		headers: {
			...(CMS_API_KEY ? { Authorization: `users API-Key ${CMS_API_KEY}` } : {}),
			...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new Error(`CMS ${response.status} for ${method} /api/${path}: ${await response.text()}`);
	return response.json() as Promise<T>;
};

export interface CmsMedia {
	url: string;
	alt?: string | null;
	width?: number | null;
	height?: number | null;
	sizes?: Record<string, { url?: string | null; width?: number | null } | undefined>;
}

// Every size the CMS made of an image, so a page can ask for the smallest one that is wide enough.
const imageSizes = new Map<string, { url: string; width: number }[]>();

/** The image's URL, remembering its smaller sizes for `cmsImage`. */
export const mediaUrl = (media: CmsMedia | number | null | undefined) => {
	if (!media || typeof media === 'number') return '';
	const sizes = [...Object.values(media.sizes ?? {}), media]
		.filter((size): size is { url: string; width: number } => Boolean(size?.url && size.width))
		.sort((a, b) => a.width - b.width);
	imageSizes.set(media.url, sizes);
	return media.url;
};

/** The smallest stored size of a CMS image at least `width` pixels wide; other URLs come back unchanged. */
export const cmsImage = (src: string, width: number) => {
	const sizes = imageSizes.get(src);
	return sizes?.find((size) => size.width >= width)?.url ?? sizes?.at(-1)?.url ?? src;
};
