import type { APIRoute } from 'astro';
import { dateRange, requireAnalyticsUser } from '../../../lib/analytics-access';
import { chatErrorResponse } from '../../../lib/chat-server';
import { activeWindowMinutes, chatEventTypeSet, summariseChat } from '../../../lib/chat-stats';
import { csvFileName, toCsv, type CsvCell } from '../../../lib/csv';
import { readEvents } from '../../../lib/event-store';

// Live chat analytics for the dashboard, from the events logged by the chat routes and /api/track. Analytics role only.
//   GET /api/analytics/chat?from=2026-11-01&to=2026-11-30       JSON summary
//   …&format=csv&table=daily | events                            spreadsheet: one row per day, or every raw event

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
		const now = Date.now();
		const [events, recentMessages] = await Promise.all([
			readEvents(start, end, chatEventTypeSet),
			readEvents(now - activeWindowMinutes * 60_000, Infinity, new Set(['chat_message'])),
		]);

		if (url.searchParams.get('format') !== 'csv') {
			return Response.json(summariseChat(events, start, end, recentMessages, now), { headers: { 'Cache-Control': 'no-store' } });
		}
		if (url.searchParams.get('table') === 'events') {
			const columns = ['at', 'type', 'room', 'cid', 'tab', 'vid', 'reason', 'action', 'status', 'newAccount', 'code', 'signedIn', 'hidden', 'moderator', 'waitMs', 'state', 'cause', 'device', 'os', 'browser'];
			return csv('chat-events', columns, events.map((event) => columns.map((column) => event[column])));
		}
		const { daily } = summariseChat(events, start, end, recentMessages, now);
		return csv('chat-daily', ['Day (WIB)', 'Messages', 'Chatters', 'Chat views', 'Sign-ins', 'Refused messages'],
			daily.map((day) => [day.day, day.messages, day.chatters, day.views, day.signIns, day.refused]));
	} catch (error) {
		return chatErrorResponse(error);
	}
};
