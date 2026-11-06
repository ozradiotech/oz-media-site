import type { APIRoute } from 'astro';

// Built once; points crawlers at the sitemap and keeps them out of the CMS, internal pages and the API.
export const prerender = true;

export const GET: APIRoute = ({ site }) => {
	const lines = [
		'User-agent: *',
		'Allow: /',
		'Disallow: /admin',
		'Disallow: /analytics',
		'Disallow: /api/',
		'',
		`Sitemap: ${new URL('/sitemap.xml', site).href}`,
		'',
	];
	return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
