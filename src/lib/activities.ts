import { getLiveCollection, type LiveDataEntry } from 'astro:content';
import type { ActivityData } from '../live.config';

// On ground activity lives under OZ Bandung, like OZ News: /oz-bandung/activities lists every event, upcoming then
// past, and /oz-bandung/activities/<slug> shows one with its photo carousel. Dates decide which list an event is in.
export type ActivityEntry = LiveDataEntry<ActivityData>;

/** Published activities, newest start first. A CMS outage leaves the list empty rather than breaking the page. */
export const getActivities = async () => {
	const { entries, error } = await getLiveCollection('activities');
	if (error) console.error('[activities]', error);
	return (entries ?? []) as ActivityEntry[];
};

export const activitiesIndexPath = '/oz-bandung/activities';
export const activityPath = (entry: ActivityEntry) => `${activitiesIndexPath}/${entry.id}`;

/** The masthead label on these pages (see NewsLayout). */
export const activitiesSection = { name: 'On Ground', accent: 'Activity', href: activitiesIndexPath };

/**
 * The activity categories, in the order the filter shows them. Values match the CMS's list (oz-cms
 * src/activityCategories.ts); add or rename a category in both places.
 */
export const activityCategories = [
	{ value: 'live-music', label: 'Live Music' },
	{ value: 'festival', label: 'Festival' },
	{ value: 'broadcast', label: 'Off-Air Broadcast' },
	{ value: 'community', label: 'Community & Meet-up' },
	{ value: 'workshop', label: 'Workshop & Talk' },
	{ value: 'competition', label: 'Competition' },
	{ value: 'social', label: 'Social & Charity' },
] as const;

export const activityCategoryLabel = (value: string) =>
	activityCategories.find((category) => category.value === value)?.label ?? 'On Ground';

// ---------- Dates ----------

// Events happen in Bandung, so dates print in its time zone (WIB, UTC+7, no daylight saving) whatever the server's is.
const timeZone = 'Asia/Jakarta';
const wibOffset = 7 * 3600_000;
const day = 86400_000;

/** Midnight WIB means "a date without a time": the CMS stores date-only events that way. */
const isMidnight = (date: Date) => (date.getTime() + wibOffset) % day === 0;
const endOfDay = (date: Date) => new Date(Math.floor((date.getTime() + wibOffset) / day) * day + day - wibOffset);
const sameDay = (a: Date, b: Date) => Math.floor((a.getTime() + wibOffset) / day) === Math.floor((b.getTime() + wibOffset) / day);

/** When the event is over: its end time, the end of its last day when that has no time, or the end of its start day. */
export const activityEnds = ({ startDate, endDate }: ActivityData) => {
	if (!startDate) return undefined;
	const last = endDate ?? startDate;
	return endDate && !isMidnight(endDate) ? endDate : endOfDay(last);
};

/** Undated events count as upcoming ("date to be announced"). */
export const isUpcoming = (data: ActivityData, now = new Date()) => {
	const ends = activityEnds(data);
	return !ends || ends > now;
};

/**
 * Scheduled until the event ends, then Past. The CMS shows the same status, worked out by the same rule
 * (oz-cms src/activityStatus.ts); keep the two in step.
 */
export const activityStatus = (data: ActivityData, now = new Date()) => (isUpcoming(data, now) ? 'Scheduled' : 'Past');

const part = (date: Date, options: Intl.DateTimeFormatOptions) => date.toLocaleString('en-GB', { ...options, timeZone });
const time = (date: Date) => part(date, { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '.');

/** "Saturday, 29 August 2026, 19.00 WIB", "23–25 December 2026", "30 December 2026 – 1 January 2027", or "Date to be announced". */
export const formatActivityDate = ({ startDate, endDate }: ActivityData) => {
	if (!startDate) return 'Date to be announced';
	const timed = !isMidnight(startDate);
	const full = (date: Date) => part(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
	if (!endDate || sameDay(startDate, endDate)) {
		if (!timed) return full(startDate);
		const until = endDate && !isMidnight(endDate) ? `–${time(endDate)}` : '';
		return `${full(startDate)}, ${time(startDate)}${until} WIB`;
	}
	const startYear = part(startDate, { year: 'numeric' });
	const startMonth = part(startDate, { month: 'long' });
	const endText = part(endDate, { day: 'numeric', month: 'long', year: 'numeric' });
	const range = startYear === part(endDate, { year: 'numeric' }) && startMonth === part(endDate, { month: 'long' })
		? `${part(startDate, { day: 'numeric' })}–${endText}`
		: `${part(startDate, { day: 'numeric', month: 'long', ...(startYear === part(endDate, { year: 'numeric' }) ? {} : { year: 'numeric' }) })} – ${endText}`;
	return timed ? `${range}, from ${time(startDate)} WIB` : range;
};

/** For cards: "29 Aug 2026", "23–25 Dec 2026", or "Date TBA". */
export const formatActivityShortDate = ({ startDate, endDate }: ActivityData) => {
	if (!startDate) return 'Date TBA';
	const short = (date: Date) => part(date, { day: 'numeric', month: 'short', year: 'numeric' });
	if (!endDate || sameDay(startDate, endDate)) return short(startDate);
	const sameMonth = part(startDate, { month: 'short', year: 'numeric' }) === part(endDate, { month: 'short', year: 'numeric' });
	return sameMonth ? `${part(startDate, { day: 'numeric' })}–${short(endDate)}` : `${part(startDate, { day: 'numeric', month: 'short' })} – ${short(endDate)}`;
};

/** The line on a card's photo: date, then venue when there is one. */
export const activityWhen = (data: ActivityData) => [formatActivityShortDate(data), data.venue].filter(Boolean).join(' · ');

/** The tile on the Upcoming card, like a page torn off a desk calendar. */
export const calendarTile = ({ startDate }: ActivityData) =>
	startDate
		? {
				month: part(startDate, { month: 'short' }),
				day: part(startDate, { day: 'numeric' }),
				weekday: part(startDate, { weekday: 'short' }),
				time: isMidnight(startDate) ? '' : `${time(startDate)} WIB`,
			}
		: undefined;

/** Upcoming events (featured first, then the soonest, undated last) and past events (the most recent first). */
export const splitActivities = (entries: ActivityEntry[], now = new Date()) => {
	const upcoming = entries
		.filter(({ data }) => isUpcoming(data, now))
		.sort((a, b) => Number(b.data.featured) - Number(a.data.featured)
			|| (a.data.startDate?.getTime() ?? Infinity) - (b.data.startDate?.getTime() ?? Infinity)
			|| a.data.title.localeCompare(b.data.title));
	const past = entries
		.filter(({ data }) => !isUpcoming(data, now))
		.sort((a, b) => (b.data.startDate?.getTime() ?? 0) - (a.data.startDate?.getTime() ?? 0));
	return { upcoming, past };
};

// ---------- Calendar links ----------

const compactUtc = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const compactDay = (date: Date) => part(date, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('');

/** Start and end in calendar format: whole days for date-only events (end exclusive), UTC times otherwise. */
const calendarSpan = (data: ActivityData) => {
	const { startDate, endDate } = data;
	if (!startDate) return undefined;
	if (isMidnight(startDate)) {
		const last = endDate ?? startDate;
		return { allDay: true, start: compactDay(startDate), end: compactDay(new Date(endOfDay(last).getTime() + 1)) };
	}
	// Two hours when no end is given, so the calendar shows a block rather than a point.
	const end = endDate ?? new Date(startDate.getTime() + 2 * 3600_000);
	return { allDay: false, start: compactUtc(startDate), end: compactUtc(end) };
};

export const googleCalendarUrl = (entry: ActivityEntry, pageUrl: string) => {
	const span = calendarSpan(entry.data);
	if (!span) return '';
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: entry.data.title,
		dates: `${span.start}/${span.end}`,
		details: [entry.data.summary, pageUrl].filter(Boolean).join('\n\n'),
		ctz: timeZone,
	});
	if (entry.data.venue) params.set('location', entry.data.venue);
	return `https://calendar.google.com/calendar/render?${params}`;
};

const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (match) => `\\${match}`);

/** An .ics file for Apple Calendar, Outlook and the rest. */
export const activityIcs = (entry: ActivityEntry, pageUrl: string, host: string) => {
	const span = calendarSpan(entry.data);
	if (!span) return '';
	const when = span.allDay ? [`DTSTART;VALUE=DATE:${span.start}`, `DTEND;VALUE=DATE:${span.end}`] : [`DTSTART:${span.start}`, `DTEND:${span.end}`];
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//OZ Radio Bandung//On Ground Activity//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${entry.id}@${host}`,
		`DTSTAMP:${compactUtc(new Date())}`,
		...when,
		`SUMMARY:${icsText(entry.data.title)}`,
		entry.data.summary && `DESCRIPTION:${icsText(`${entry.data.summary}\n\n${pageUrl}`)}`,
		entry.data.venue && `LOCATION:${icsText(entry.data.venue)}`,
		`URL:${pageUrl}`,
		'STATUS:CONFIRMED',
		'END:VEVENT',
		'END:VCALENDAR',
	].filter(Boolean);
	return `${lines.join('\r\n')}\r\n`;
};

// ---------- Recap video ----------

/** The 11-character id in any YouTube link (watch, youtu.be, shorts, live, embed). */
export const youtubeId = (url: string) =>
	url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/)?.[1] ?? '';
