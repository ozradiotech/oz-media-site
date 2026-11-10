import type { APIRoute } from 'astro';
import { getVisibleNews, newsIndexPath, newsPath } from '../lib/news';

// Rendered per request, like the news pages, so new articles are listed as soon as they are published.
// Add new public pages to staticPaths; /admin and /analytics stay out on purpose.
export const prerender = false;

const staticPaths = ['/', '/oz-bandung', '/oz-bali', newsIndexPath, '/privacy-policy'];

const escapeXml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const GET: APIRoute = async ({ site }) => {
	const news = await getVisibleNews();
	const urls = [
		...staticPaths.map((path) => ({ path, lastmod: undefined as Date | undefined })),
		...news.map((entry) => ({ path: newsPath(entry), lastmod: entry.data.publishedAt })),
	];

	const body = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls.map(({ path, lastmod }) => {
			const loc = `<loc>${escapeXml(new URL(path, site).href)}</loc>`;
			return lastmod ? `\t<url>${loc}<lastmod>${lastmod.toISOString()}</lastmod></url>` : `\t<url>${loc}</url>`;
		}),
		'</urlset>',
		'',
	].join('\n');

	return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
