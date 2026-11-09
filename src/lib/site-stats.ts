// Server only. Summarises the site performance events (src/lib/site-events.ts) for /analytics. Like Google's own
// reports, a vital is judged at the 75th percentile: the value three in four page views were at or better than.
import type { StoredEvent } from './event-store';
import { vitalNames, vitalThresholds, type VitalName } from './site-events';

export const siteEventTypeSet = new Set(['web_vital', 'js_error']);

const jakartaDay = (time: number) => new Date(time + 7 * 3_600_000).toISOString().slice(0, 10);

export const percentile = (values: number[], share = 0.75) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
};

const rate = (name: VitalName, value: number) => {
	const limits = vitalThresholds[name];
	if (!limits) return null;
	return value <= limits.good ? 'good' : value > limits.poor ? 'poor' : 'needs-improvement';
};

type Vital = { at: string; page: string; name: VitalName; value: number; device: string; tab: string };

type VitalRow = { views: number } & Record<VitalName, number | null>;
type MetricSummary = { p75: number | null; rating: string | null; samples: number; ratings: Record<string, number> };

const p75By = (vitals: Vital[], key: (vital: Vital) => string): Record<string, VitalRow> => {
	const groups: Record<string, Partial<Record<VitalName, number[]>>> = {};
	for (const vital of vitals) ((groups[key(vital)] ??= {})[vital.name] ??= []).push(vital.value);
	return Object.fromEntries(Object.entries(groups).map(([group, byName]) => {
		const row = { views: new Set(vitals.filter((vital) => key(vital) === group).map((vital) => vital.tab)).size } as VitalRow;
		for (const name of vitalNames) row[name] = percentile(byName[name] ?? []);
		return [group, row];
	}));
};

export const summariseSite = (events: StoredEvent[], start: number, end: number, now = Date.now()) => {
	const vitals: Vital[] = events
		.filter((event) => event.type === 'web_vital' && (vitalNames as readonly unknown[]).includes(event.name) && typeof event.value === 'number')
		.map((event) => ({ at: event.at, page: String(event.page ?? 'Other'), name: event.name as VitalName, value: event.value as number, device: String(event.device ?? 'desktop'), tab: String(event.tab ?? '') }));
	const errors = events.filter((event) => event.type === 'js_error');

	// A page view passes when its LCP and CLS are good, and its INP too if there was any interaction.
	const byTab = new Map<string, Partial<Record<VitalName, number>>>();
	for (const vital of vitals) (byTab.get(vital.tab) ?? byTab.set(vital.tab, {}).get(vital.tab)!)[vital.name] = vital.value;
	const judged = [...byTab.values()].filter((view) => view.LCP !== undefined && view.CLS !== undefined);
	const passing = judged.filter((view) => rate('LCP', view.LCP!) === 'good' && rate('CLS', view.CLS!) === 'good' && (view.INP === undefined || rate('INP', view.INP) === 'good'));

	const metrics = {} as Record<VitalName, MetricSummary>;
	for (const name of vitalNames) {
		const values = vitals.filter((vital) => vital.name === name).map((vital) => vital.value);
		const ratings: Record<string, number> = { good: 0, 'needs-improvement': 0, poor: 0 };
		for (const value of values) {
			const rating = rate(name, value);
			if (rating) ratings[rating] += 1;
		}
		const p75 = percentile(values);
		metrics[name] = { p75, rating: p75 === null ? null : rate(name, p75), samples: values.length, ratings };
	}

	const firstDay = Number.isFinite(start) ? start : Math.min(...events.map((event) => Date.parse(event.at)), now);
	const lastDay = Math.min(Number.isFinite(end) ? end - 1 : now, now);
	const days: string[] = [];
	for (let time = firstDay; jakartaDay(time) <= jakartaDay(lastDay) && days.length < 400; time += 86_400_000) days.push(jakartaDay(time));
	const daily = p75By(vitals, (vital) => jakartaDay(Date.parse(vital.at)));

	// Errors grouped by message and place, most frequent first.
	const errorGroups = new Map<string, { message: string; source: string; page: string; count: number; lastSeen: string }>();
	for (const error of errors) {
		const message = String(error.message ?? '');
		const source = error.source ? `${error.source}${error.line ? `:${error.line}` : ''}` : '';
		const key = `${message}|${source}`;
		const group = errorGroups.get(key) ?? { message, source, page: String(error.page ?? ''), count: 0, lastSeen: error.at };
		group.count += 1;
		if (error.at > group.lastSeen) group.lastSeen = error.at;
		errorGroups.set(key, group);
	}

	return {
		totals: {
			pageViews: byTab.size,
			passingShare: judged.length ? passing.length / judged.length : null,
			judgedViews: judged.length,
			errors: errors.length,
			pageViewsWithErrors: new Set(errors.map((error) => String(error.tab ?? ''))).size,
		},
		metrics,
		pages: p75By(vitals, (vital) => vital.page),
		devices: p75By(vitals, (vital) => vital.device),
		daily: days.map((day) => ({ day, ...Object.fromEntries(vitalNames.map((name) => [name, daily[day]?.[name] ?? null])) })),
		errors: [...errorGroups.values()].sort((a, b) => b.count - a.count).slice(0, 50),
	};
};

export type SiteSummary = ReturnType<typeof summariseSite>;
