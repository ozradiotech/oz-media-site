import type { APIRoute } from 'astro';
import { dateRange, requireAnalyticsUser } from '../../../lib/analytics-access';
import { chatErrorResponse } from '../../../lib/chat-server';
import { csvFileName, toCsv, type CsvCell } from '../../../lib/csv';
import { readEvents } from '../../../lib/event-store';
import { siteEventTypeSet, summariseSite } from '../../../lib/site-stats';

// Site performance for the dashboard: Core Web Vitals, page load time and JavaScript errors, from /api/track.
// Analytics role only.
//   GET /api/analytics/site?from=2026-11-01&to=2026-11-30        JSON summary
//   …&format=csv&table=vitals | errors                             spreadsheet: every measurement, or every error

export const prerender = false;

const csv = (name: string, headers: string[], rows: CsvCell[][]) =>
	new Response(toCsv(headers, rows), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${csvFileName(name)}"`,
			'Cache-Control': 'no-store',
		},
	});

export const GET: APIRoute = async ({ request, url }) => {
	try {
		await requireAnalyticsUser(request);
		const { start, end } = dateRange(url);
		const events = await readEvents(start, end, siteEventTypeSet);

		if (url.searchParams.get('format') !== 'csv') {
			return Response.json(summariseSite(events, start, end), { headers: { 'Cache-Control': 'no-store' } });
		}
		if (url.searchParams.get('table') === 'errors') {
			const errors = events.filter((event) => event.type === 'js_error');
			return csv('site-errors', ['At (UTC)', 'Page', 'Message', 'Script', 'Line', 'Device', 'OS', 'Browser'],
				errors.map((event) => [event.at, event.page, event.message, event.source, event.line, event.device, event.os, event.browser]));
		}
		const vitals = events.filter((event) => event.type === 'web_vital');
		return csv('site-vitals', ['At (UTC)', 'Page', 'Metric', 'Value (ms; CLS is a score)', 'Rating', 'Device', 'OS', 'Browser', 'Page view id'],
			vitals.map((event) => [event.at, event.page, event.name, event.value, event.rating, event.device, event.os, event.browser, event.tab]));
	} catch (error) {
		return chatErrorResponse(error);
	}
};
