import type { APIRoute } from 'astro';
import { requireAnalyticsUser } from '../../../lib/analytics-access';
import { ChatError, chatErrorResponse } from '../../../lib/chat-server';
import { csvFileName, toCsv } from '../../../lib/csv';
import { isGaConfigured, runReport, type GaReportRequest, type GaRow } from '../../../lib/ga4';

// Website traffic, audience and campaigns from Google Analytics 4 (src/lib/ga4.ts), for the Website panel on
// /analytics. Analytics role only.
//   GET /api/analytics/web?from=2026-11-01&to=2026-11-30        JSON: every report below
//   …&format=csv&table=<report>                                  one report as a spreadsheet
// GA4 only counts visitors who accepted analytics cookies. GA4 has no "exit page" report outside its own
// Explorations, so exits aren't here.

export const prerender = false;

// Channels and campaigns GA fills in itself; left out of the campaign report so only real UTM campaigns remain.
const notCampaigns = ['(not set)', '(direct)', '(organic)', '(referral)', '(none)'];

export const reports = {
	totals: { dimensions: [], metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagedSessions', 'engagementRate', 'averageSessionDuration', 'sessionsPerUser'] },
	daily: { dimensions: ['date'], metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagedSessions'], orderBy: { dimension: 'date' }, limit: 400 },
	channels: { dimensions: ['sessionDefaultChannelGroup'], metrics: ['sessions', 'activeUsers', 'engagedSessions'], orderBy: { metric: 'sessions' }, limit: 20 },
	sources: { dimensions: ['sessionSource', 'sessionMedium'], metrics: ['sessions', 'activeUsers', 'engagedSessions'], orderBy: { metric: 'sessions' }, limit: 25 },
	pages: { dimensions: ['pagePath'], metrics: ['screenPageViews', 'activeUsers', 'userEngagementDuration'], orderBy: { metric: 'screenPageViews' }, limit: 25 },
	landingPages: { dimensions: ['landingPage'], metrics: ['sessions', 'engagedSessions', 'activeUsers'], orderBy: { metric: 'sessions' }, limit: 25, exclude: ['(not set)'] },
	devices: { dimensions: ['deviceCategory'], metrics: ['activeUsers', 'sessions'], orderBy: { metric: 'activeUsers' } },
	browsers: { dimensions: ['browser'], metrics: ['activeUsers', 'sessions'], orderBy: { metric: 'activeUsers' }, limit: 10 },
	operatingSystems: { dimensions: ['operatingSystem'], metrics: ['activeUsers', 'sessions'], orderBy: { metric: 'activeUsers' }, limit: 10 },
	cities: { dimensions: ['city', 'country'], metrics: ['activeUsers', 'sessions'], orderBy: { metric: 'activeUsers' }, limit: 25 },
	newVsReturning: { dimensions: ['newVsReturning'], metrics: ['activeUsers', 'sessions', 'engagedSessions'], orderBy: { metric: 'activeUsers' }, exclude: ['(not set)', ''] },
	campaigns: { dimensions: ['sessionCampaignName', 'sessionSource', 'sessionMedium', 'sessionManualAdContent'], metrics: ['sessions', 'activeUsers', 'engagedSessions'], orderBy: { metric: 'sessions' }, limit: 50, exclude: notCampaigns },
	events: { dimensions: ['eventName'], metrics: ['eventCount', 'totalUsers'], orderBy: { metric: 'eventCount' }, limit: 40 },
} satisfies Record<string, GaReportRequest>;

type ReportName = keyof typeof reports;

// GA's numbers change slowly and its free quota is limited, so each date range is fetched at most every 10 minutes.
const cacheLife = 10 * 60_000;
const cache = new Map<string, { at: number; data: Record<ReportName, GaRow[]> }>();

const isDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

const fetchAll = async (startDate: string, endDate: string) => {
	const key = `${startDate}|${endDate}`;
	const cached = cache.get(key);
	if (cached && Date.now() - cached.at < cacheLife) return cached.data;
	const names = Object.keys(reports) as ReportName[];
	const results = await Promise.all(names.map((name) => runReport(reports[name], startDate, endDate)));
	const data = Object.fromEntries(names.map((name, index) => [name, results[index]])) as Record<ReportName, GaRow[]>;
	cache.set(key, { at: Date.now(), data });
	if (cache.size > 50) cache.delete(cache.keys().next().value!);
	return data;
};

export const GET: APIRoute = async ({ request, url }) => {
	try {
		await requireAnalyticsUser(request);
		if (!isGaConfigured) throw new ChatError(503, 'Google Analytics is not connected yet: set GA_PROPERTY_ID in .env.');
		const from = url.searchParams.get('from');
		const to = url.searchParams.get('to');
		const data = await fetchAll(isDate(from) ? from : '90daysAgo', isDate(to) ? to : 'today');

		if (url.searchParams.get('format') !== 'csv') {
			return Response.json({ reports: data, cachedFor: cacheLife / 60_000 }, { headers: { 'Cache-Control': 'no-store' } });
		}
		const table = url.searchParams.get('table') as ReportName | null;
		if (!table || !(table in reports)) throw new ChatError(400, 'Unknown report.');
		const columns = [...reports[table].dimensions, ...reports[table].metrics];
		return new Response(toCsv(columns, data[table].map((row) => columns.map((column) => row[column]))), {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${csvFileName(`ga4-${table}`)}"`,
				'Cache-Control': 'no-store',
			},
		});
	} catch (error) {
		return chatErrorResponse(error);
	}
};
