// Server only. Summarises the live chat events (src/lib/chat-analytics.ts from the server, src/lib/chat-events.ts from
// browsers) for /analytics. Days and hours are the station's (Asia/Jakarta, UTC+7).
//
// People and views are kept apart: a chatter is an account that posted (counted by its hashed id), a view is one page
// load that showed the chat. One person can make many views, so views are never counted as people.
import type { StoredEvent } from './event-store';

export const chatEventTypeSet = new Set([
	'chat_message', 'chat_refused', 'chat_report', 'chat_moderation',
	'chat_view', 'chat_sign_in', 'chat_first_message', 'chat_send_error', 'chat_connection',
]);

const jakartaOffset = 7 * 3_600_000;
const jakartaDay = (time: number) => new Date(time + jakartaOffset).toISOString().slice(0, 10);
const jakartaHour = (time: number) => new Date(time + jakartaOffset).getUTCHours();
const text = (value: unknown, fallback = '') => (typeof value === 'string' && value ? value : fallback);

const count = (events: StoredEvent[], key: (event: StoredEvent) => string) => {
	const counts: Record<string, number> = {};
	for (const event of events) counts[key(event)] = (counts[key(event)] ?? 0) + 1;
	return counts;
};

const median = (values: number[]) => {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Chatters active in the last this-many minutes count as active now. */
export const activeWindowMinutes = 15;

/** `recentMessages`: chat_message events from the last activeWindowMinutes, whatever the chosen dates. */
export const summariseChat = (events: StoredEvent[], start: number, end: number, recentMessages: StoredEvent[], now = Date.now()) => {
	const of = (type: string) => events.filter((event) => event.type === type);
	const messages = of('chat_message');
	const refused = of('chat_refused');
	const views = of('chat_view');
	const signIns = of('chat_sign_in');
	const moderation = of('chat_moderation');
	const reports = of('chat_report');
	const connections = of('chat_connection');

	// Chatters by the days they posted on, for returning chatters.
	const daysByChatter = new Map<string, Set<string>>();
	for (const message of messages) {
		const cid = text(message.cid);
		if (!cid) continue;
		const days = daysByChatter.get(cid) ?? new Set<string>();
		days.add(jakartaDay(Date.parse(message.at)));
		daysByChatter.set(cid, days);
	}

	// Messages per visit: page loads that posted at least once.
	const messagesByTab = count(messages.filter((message) => text(message.tab)), (message) => text(message.tab));
	const tabCounts = Object.values(messagesByTab);

	const activeNow = new Set(recentMessages.map((message) => text(message.cid)).filter(Boolean)).size;

	const firstDay = Number.isFinite(start) ? start : Math.min(...events.map((event) => Date.parse(event.at)), now);
	const lastDay = Math.min(Number.isFinite(end) ? end - 1 : now, now);
	const days: string[] = [];
	for (let time = firstDay; jakartaDay(time) <= jakartaDay(lastDay) && days.length < 400; time += 86_400_000) days.push(jakartaDay(time));
	const byDay = (list: StoredEvent[]) => count(list, (event) => jakartaDay(Date.parse(event.at)));
	const dayMessages = byDay(messages);
	const dayViews = byDay(views);
	const daySignIns = byDay(signIns.filter((event) => event.status === 'success'));
	const dayRefused = byDay(refused);
	const dayChatters: Record<string, Set<string>> = {};
	for (const message of messages) {
		const day = jakartaDay(Date.parse(message.at));
		(dayChatters[day] ??= new Set()).add(text(message.cid));
	}

	const signInStatus = count(signIns, (event) => text(event.status, 'unknown'));
	const waits = of('chat_first_message').map((event) => Number(event.waitMs)).filter(Number.isFinite);

	return {
		totals: {
			messages: messages.length,
			moderatorMessages: messages.filter((message) => message.moderator === 1).length,
			chatters: daysByChatter.size,
			returningChatters: [...daysByChatter.values()].filter((chatterDays) => chatterDays.size > 1).length,
			activeNow,
			messagesPerChatter: daysByChatter.size ? messages.length / daysByChatter.size : 0,
			messagesPerVisit: tabCounts.length ? tabCounts.reduce((a, b) => a + b, 0) / tabCounts.length : 0,
			views: views.length,
			signedInViews: views.filter((view) => view.signedIn === 1).length,
			signInAttempts: signInStatus.attempt ?? 0,
			signIns: signInStatus.success ?? 0,
			newAccounts: signIns.filter((event) => event.status === 'success' && event.newAccount === 1).length,
			refused: refused.length,
			networkFailures: of('chat_send_error').length,
			reports: reports.length,
			hiddenByReports: reports.filter((report) => report.hidden === 1).length,
			moderationActions: moderation.length,
			medianFirstMessageSeconds: median(waits) / 1000,
			disconnections: connections.filter((event) => event.state === 'disconnected').length,
		},
		daily: days.map((day) => ({
			day,
			messages: dayMessages[day] ?? 0,
			chatters: dayChatters[day]?.size ?? 0,
			views: dayViews[day] ?? 0,
			signIns: daySignIns[day] ?? 0,
			refused: dayRefused[day] ?? 0,
		})),
		hourOfDay: Array.from({ length: 24 }, (_, hour) => messages.filter((message) => jakartaHour(Date.parse(message.at)) === hour).length),
		viewers: { signedIn: views.filter((view) => view.signedIn === 1).length, anonymous: views.filter((view) => view.signedIn !== 1).length },
		signInOutcomes: signInStatus,
		signInErrors: count(signIns.filter((event) => event.status === 'failed'), (event) => text(event.code, 'unknown')),
		refusals: count(refused, (event) => text(event.reason, 'error')),
		moderation: count(moderation, (event) => text(event.action, 'unknown')),
		disconnectCauses: count(connections.filter((event) => event.state === 'disconnected'), (event) => text(event.cause, 'network')),
	};
};

export type ChatSummary = ReturnType<typeof summariseChat>;
