import type { APIRoute } from 'astro';
import { dateRange, requireAnalyticsUser } from '../../../lib/analytics-access';
import { chatErrorResponse } from '../../../lib/chat-server';
import { csvFileName, toCsv } from '../../../lib/csv';
import { readListenerRecords } from '../../../lib/listener-store';

// The listener form records for the analytics dashboard (src/pages/analytics.astro). They hold personal details,
// so only Google accounts with the analytics role can read them (see src/lib/analytics-access.ts).
//   GET /api/analytics/listeners                     JSON, newest first
//   GET /api/analytics/listeners?format=csv          the same as a spreadsheet file
//   &from=2026-10-01&to=2026-10-31                   either end optional, inclusive, Jakarta dates

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
	try {
		await requireAnalyticsUser(request);
		const { start, end } = dateRange(url);
		const records = (await readListenerRecords()).filter((record) => {
			const time = Date.parse(record.createdAt);
			return time >= start && time < end;
		});

		if (url.searchParams.get('format') !== 'csv') {
			return Response.json({ records }, { headers: { 'Cache-Control': 'no-store' } });
		}
		const csv = toCsv(
			['Sent at (UTC)', 'Name', 'Age', 'Gender', 'Location', 'Stream', 'Google email', 'Google uid'],
			records.map((record) => [record.createdAt, record.name, record.age, record.gender, record.location, record.broadcast, record.googleEmail, record.googleUid]),
		);
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${csvFileName('listeners')}"`,
				'Cache-Control': 'no-store',
			},
		});
	} catch (error) {
		return chatErrorResponse(error);
	}
};
