import type { APIRoute } from 'astro';
import { dateRange, requireAnalyticsUser } from '../../../lib/analytics-access';
import { chatErrorResponse } from '../../../lib/chat-server';
import { csvFileName, toCsv, type CsvCell } from '../../../lib/csv';
import { readEvents } from '../../../lib/event-store';
import { buildSessions, radioEventTypeSet, summarise } from '../../../lib/radio-stats';

// Radio listening for the analytics dashboard, from the events stored by /api/track. Analytics role only.
//   GET /api/analytics/radio?from=2026-11-01&to=2026-11-30          JSON summary
//   …&format=csv&table=sessions | daily | events                     spreadsheet: one row per listening session,
//                                                                     per day, or every raw event

export const prerender = false;

// A session that starts just before the range ends can keep sending for a while; read a little further for its end.
const lateEvents = 12 * 3_600_000;

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
		const events = await readEvents(start, Number.isFinite(end) ? end + lateEvents : end, radioEventTypeSet);
		const sessions = buildSessions(events, start, end);

		if (url.searchParams.get('format') !== 'csv') {
			return Response.json(summarise(events, sessions, start, end), { headers: { 'Cache-Control': 'no-store' } });
		}

		const table = url.searchParams.get('table');
		if (table === 'events') {
			const inRange = events.filter((event) => Date.parse(event.at) < end);
			const columns = ['at', 'type', 'stream', 'source', 'sid', 'listenedMs', 'reason', 'kind', 'code', 'waitMs', 'device', 'os', 'browser', 'tab', 'vid'];
			return csv('radio-events', columns, inRange.map((event) => columns.map((column) => event[column])));
		}
		if (table === 'daily') {
			const { daily } = summarise(events, sessions, start, end);
			return csv('radio-daily', ['Day (WIB)', 'Play clicks', 'Listening sessions', 'Listening hours', 'Errors'],
				daily.map((day) => [day.day, day.playClicks, day.sessions, Number(day.listeningHours.toFixed(2)), day.errors]));
		}
		return csv('radio-sessions',
			['Started (UTC)', 'Stream', 'Started from', 'Minutes listened', 'Ended by', 'Interruptions', 'Seconds to start', 'Device', 'OS', 'Browser', 'Listener id', 'Session id'],
			sessions.map((session) => [
				session.startedAt,
				session.stream,
				session.source,
				Number((session.listenedMs / 60_000).toFixed(2)),
				session.endReason,
				session.interruptions,
				session.waitMs === null ? null : Number((session.waitMs / 1000).toFixed(1)),
				session.device,
				session.os,
				session.browser,
				session.vid,
				session.sid,
			]));
	} catch (error) {
		return chatErrorResponse(error);
	}
};
