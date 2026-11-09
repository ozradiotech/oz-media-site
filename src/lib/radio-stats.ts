// Server only. Turns stored radio events (src/lib/radio-events.ts) into listening sessions and the summaries on
// /analytics. Days and hours are the station's (Asia/Jakarta, UTC+7).
import type { StoredEvent } from './event-store';

export const radioEventTypeSet = new Set(['play_click', 'stream_start', 'heartbeat', 'stream_end', 'interruption', 'stream_error']);

export type ListeningSession = {
	sid: string;
	startedAt: string;
	stream: string;
	source: string;
	device: string;
	os: string;
	browser: string;
	/** The lasting listener id, only for visitors who accepted analytics cookies. */
	vid: string | null;
	listenedMs: number;
	/** Why it ended; "unknown" when the page went away without saying (a crash, or a phone killing the tab). */
	endReason: string;
	interruptions: number;
	waitMs: number | null;
};

const jakartaOffset = 7 * 3_600_000;
const jakartaDay = (time: number) => new Date(time + jakartaOffset).toISOString().slice(0, 10);
const jakartaHour = (time: number) => new Date(time + jakartaOffset).getUTCHours();
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const number = (value: unknown) => (typeof value === 'number' ? value : 0);

/** Sessions that started in [start, end). `events` should reach a little past `end`, so late endings are included. */
export const buildSessions = (events: StoredEvent[], start: number, end: number) => {
	const sessions = new Map<string, ListeningSession>();
	for (const event of events) {
		const sid = text(event.sid);
		if (!sid) continue;
		if (event.type === 'stream_start') {
			const time = Date.parse(event.at);
			if (time < start || time >= end || sessions.has(sid)) continue;
			sessions.set(sid, {
				sid,
				startedAt: event.at,
				stream: text(event.stream),
				source: text(event.source),
				device: text(event.device, 'desktop'),
				os: text(event.os, 'Other'),
				browser: text(event.browser, 'Other'),
				vid: text(event.vid) || null,
				listenedMs: 0,
				endReason: 'unknown',
				interruptions: 0,
				waitMs: typeof event.waitMs === 'number' ? event.waitMs : null,
			});
			continue;
		}
		const session = sessions.get(sid);
		if (!session) continue;
		if (event.type === 'heartbeat' || event.type === 'stream_end') session.listenedMs = Math.max(session.listenedMs, number(event.listenedMs));
		if (event.type === 'stream_end') session.endReason = text(event.reason, 'unknown');
		if (event.type === 'interruption') session.interruptions += 1;
	}
	return [...sessions.values()];
};

const count = <T>(items: T[], key: (item: T) => string) => {
	const counts: Record<string, number> = {};
	for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
	return counts;
};

const sum = <T>(items: T[], key: (item: T) => string, value: (item: T) => number) => {
	const sums: Record<string, number> = {};
	for (const item of items) sums[key(item)] = (sums[key(item)] ?? 0) + value(item);
	return sums;
};

const median = (values: number[]) => {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** How long sessions lasted, for spotting where listeners drop off. */
export const lengthBuckets: [string, number][] = [
	['Under 1 min', 60_000],
	['1–5 min', 5 * 60_000],
	['5–15 min', 15 * 60_000],
	['15–30 min', 30 * 60_000],
	['30–60 min', 60 * 60_000],
	['1–2 hours', 2 * 3_600_000],
	['2 hours +', Infinity],
];

export const summarise = (events: StoredEvent[], sessions: ListeningSession[], start: number, end: number) => {
	const inRange = events.filter((event) => {
		const time = Date.parse(event.at);
		return time >= start && time < end;
	});
	const clicks = inRange.filter((event) => event.type === 'play_click');
	const errors = inRange.filter((event) => event.type === 'stream_error');
	const hours = (session: ListeningSession) => session.listenedMs / 3_600_000;

	// Listeners are only known by their lasting id, so these count consenting visitors only.
	const daysByListener = new Map<string, Set<string>>();
	for (const session of sessions) {
		if (!session.vid) continue;
		const days = daysByListener.get(session.vid) ?? new Set<string>();
		days.add(jakartaDay(Date.parse(session.startedAt)));
		daysByListener.set(session.vid, days);
	}

	// Every day in the range, including quiet ones, so the trend has no gaps.
	const firstDay = Number.isFinite(start) ? start : Math.min(...sessions.map((session) => Date.parse(session.startedAt)), ...clicks.map((event) => Date.parse(event.at)), Date.now());
	const lastDay = Math.min(Number.isFinite(end) ? end - 1 : Date.now(), Date.now());
	const days: string[] = [];
	for (let time = firstDay; jakartaDay(time) <= jakartaDay(lastDay) && days.length < 400; time += 86_400_000) days.push(jakartaDay(time));
	const daySessions = count(sessions, (session) => jakartaDay(Date.parse(session.startedAt)));
	const dayHours = sum(sessions, (session) => jakartaDay(Date.parse(session.startedAt)), hours);
	const dayClicks = count(clicks, (event) => jakartaDay(Date.parse(event.at)));
	const dayErrors = count(errors, (event) => jakartaDay(Date.parse(event.at)));

	const lengths = sessions.map((session) => session.listenedMs);
	const waits = sessions.map((session) => session.waitMs).filter((wait): wait is number => wait !== null);

	return {
		totals: {
			playClicks: clicks.length,
			streamStarts: sessions.length,
			listeningHours: sessions.reduce((total, session) => total + hours(session), 0),
			medianMinutes: median(lengths) / 60_000,
			averageMinutes: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length / 60_000 : 0,
			medianWaitSeconds: median(waits) / 1000,
			errors: errors.length,
			interruptions: sessions.reduce((total, session) => total + session.interruptions, 0),
			knownListeners: daysByListener.size,
			returningListeners: [...daysByListener.values()].filter((listenerDays) => listenerDays.size > 1).length,
			anonymousSessions: sessions.filter((session) => !session.vid).length,
		},
		daily: days.map((day) => ({
			day,
			playClicks: dayClicks[day] ?? 0,
			sessions: daySessions[day] ?? 0,
			listeningHours: dayHours[day] ?? 0,
			errors: dayErrors[day] ?? 0,
		})),
		hourOfDay: Array.from({ length: 24 }, (_, hour) => sessions.filter((session) => jakartaHour(Date.parse(session.startedAt)) === hour).length),
		sessionLengths: lengthBuckets.map(([label, limit], index) => [
			label,
			sessions.filter((session) => session.listenedMs < limit && session.listenedMs >= (index ? lengthBuckets[index - 1][1] : 0)).length,
		] as [string, number]),
		endReasons: count(sessions, (session) => session.endReason),
		devices: count(sessions, (session) => session.device),
		deviceHours: sum(sessions, (session) => session.device, hours),
		streams: count(sessions, (session) => session.stream),
		sources: count(sessions, (session) => session.source),
		os: count(sessions, (session) => session.os),
		browsers: count(sessions, (session) => session.browser),
		errorCodes: count(errors, (event) => text(event.code, 'unknown')),
	};
};

export type RadioSummary = ReturnType<typeof summarise>;
