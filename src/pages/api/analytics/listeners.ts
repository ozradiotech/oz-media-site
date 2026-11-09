import type { APIRoute } from 'astro';
import { ChatError, chatErrorResponse, isChatServerConfigured, verifyIdToken } from '../../../lib/chat-server';
import { csvFileName, toCsv } from '../../../lib/csv';
import { readListenerRecords } from '../../../lib/listener-store';

// The listener form records for the analytics dashboard (src/pages/analytics.astro). They hold personal details,
// so only Google accounts with the analytics role can read them (grant it with scripts/chat-admin.mjs).
//   GET /api/analytics/listeners                     JSON, newest first
//   GET /api/analytics/listeners?format=csv          the same as a spreadsheet file
//   &from=2026-10-01&to=2026-10-31                   either end optional, inclusive, Jakarta dates

export const prerender = false;

const isDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
// Dates on the dashboard are the station's (Asia/Jakarta, UTC+7), not the server's.
const jakartaDayStart = (date: string) => Date.parse(`${date}T00:00:00+07:00`);

export const GET: APIRoute = async ({ request, url }) => {
	if (!isChatServerConfigured) return Response.json({ error: 'Analytics sign-in is not set up on this server.' }, { status: 503 });
	try {
		const user = await verifyIdToken(request, 'Please sign in to see the analytics.');
		if (user.analytics !== true) throw new ChatError(403, 'This Google account does not have access to the analytics.');

		const from = url.searchParams.get('from');
		const to = url.searchParams.get('to');
		const start = isDate(from) ? jakartaDayStart(from) : -Infinity;
		const end = isDate(to) ? jakartaDayStart(to) + 86_400_000 : Infinity;
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
