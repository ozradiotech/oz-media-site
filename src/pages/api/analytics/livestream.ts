import type { APIRoute } from 'astro';
import { LIVESTREAM_SNAPSHOT_INTERVAL } from 'astro:env/server';
import { dateRange, requireAnalyticsUser } from '../../../lib/analytics-access';
import { ChatError, chatErrorResponse } from '../../../lib/chat-server';
import { cmsRequest } from '../../../lib/cms';
import { csvFileName, toCsv } from '../../../lib/csv';
import { publicLiveState } from '../../../lib/youtube/runtime';
import type { BroadcastDoc } from '../../../lib/youtube/snapshots';

// Livestream analytics for /analytics: the live counts (from Firebase) and the stored history (CMS Postgres).
//   GET /api/analytics/livestream?from=2026-11-01&to=2026-11-30     live state + broadcasts that started in the range
//   GET /api/analytics/livestream?broadcast=<YouTube broadcast id>   one broadcast and its snapshots, oldest first
//   …&format=csv                                                     the snapshots (or the broadcast list) as CSV
// For accounts with the analytics role, and CMS Developers and Digital.

export const prerender = false;

type Snapshot = {
	recordedAt: string;
	youtubeConcurrentViewers: number | null;
	websiteActiveViewers: number | null;
	combinedEstimatedViewers: number | null;
	dataAvailability: string;
};

type Broadcast = BroadcastDoc & { videoId?: string | null; title?: string | null };

const average = (sum?: number | null, samples?: number | null) => (samples ? Math.round(((sum ?? 0) / samples) * 10) / 10 : null);

/** What the dashboard shows per broadcast. Averages only over snapshots where the count was available. */
const summarise = (broadcast: Broadcast) => ({
	broadcastId: broadcast.broadcastId,
	videoId: broadcast.videoId ?? null,
	title: broadcast.title ?? '',
	startedAt: broadcast.startedAt ?? null,
	endedAt: broadcast.endedAt ?? null,
	peakYoutubeViewers: broadcast.peakYoutubeViewers ?? null,
	peakWebsiteViewers: broadcast.peakWebsiteViewers ?? null,
	averageYoutubeViewers: average(broadcast.youtubeViewerSum, broadcast.youtubeSamples),
	averageWebsiteViewers: average(broadcast.websiteViewerSum, broadcast.websiteSamples),
	youtubeSamples: broadcast.youtubeSamples ?? 0,
	websiteSamples: broadcast.websiteSamples ?? 0,
});

const csv = (name: string, headers: string[], rows: (string | number | null)[][]) => new Response(toCsv(headers, rows), {
	headers: {
		'Content-Type': 'text/csv; charset=utf-8',
		'Content-Disposition': `attachment; filename="${csvFileName(name)}"`,
		'Cache-Control': 'no-store',
	},
});

export const GET: APIRoute = async ({ request, url }) => {
	try {
		await requireAnalyticsUser(request);
		const wantsCsv = url.searchParams.get('format') === 'csv';
		const broadcastId = url.searchParams.get('broadcast');

		if (broadcastId) {
			if (!/^[\w-]{1,64}$/.test(broadcastId)) throw new ChatError(400, 'Invalid broadcast.');
			const { docs } = await cmsRequest<{ docs: Broadcast[] }>('GET', `livestream-broadcasts?where[broadcastId][equals]=${broadcastId}&limit=1&depth=0`);
			const broadcast = docs[0];
			if (!broadcast) throw new ChatError(404, 'No history for that broadcast.');
			const { docs: snapshots } = await cmsRequest<{ docs: Snapshot[] }>('GET', `livestream-snapshots?where[broadcast][equals]=${broadcast.id}&sort=recordedAt&limit=5000&depth=0`);
			if (wantsCsv) {
				return csv(`livestream-${broadcastId}`, ['Recorded at (UTC)', 'YouTube concurrent viewers (official)', 'Website active viewers (estimate)', 'Combined (estimate)', 'Data available'],
					snapshots.map((row) => [row.recordedAt, row.youtubeConcurrentViewers, row.websiteActiveViewers, row.combinedEstimatedViewers, row.dataAvailability]));
			}
			return Response.json({
				broadcast: summarise(broadcast),
				snapshots: snapshots.map(({ recordedAt, youtubeConcurrentViewers, websiteActiveViewers, combinedEstimatedViewers, dataAvailability }) =>
					({ recordedAt, youtubeConcurrentViewers, websiteActiveViewers, combinedEstimatedViewers, dataAvailability })),
			}, { headers: { 'Cache-Control': 'no-store' } });
		}

		const { start, end } = dateRange(url);
		const where = [
			Number.isFinite(start) ? `where[startedAt][greater_than_equal]=${new Date(start).toISOString()}` : '',
			Number.isFinite(end) ? `where[startedAt][less_than]=${new Date(end).toISOString()}` : '',
		].filter(Boolean).join('&');
		const [live, { docs }] = await Promise.all([
			publicLiveState(),
			cmsRequest<{ docs: Broadcast[] }>('GET', `livestream-broadcasts?${where}${where ? '&' : ''}sort=-startedAt&limit=200&depth=0`),
		]);
		const broadcasts = docs.map(summarise);
		if (wantsCsv) {
			return csv('livestream-broadcasts', ['Broadcast', 'Title', 'Started (UTC)', 'Ended (UTC)', 'Peak YouTube viewers (official)', 'Average YouTube viewers', 'Peak website viewers (estimate)', 'Average website viewers'],
				broadcasts.map((row) => [row.broadcastId, row.title, row.startedAt, row.endedAt, row.peakYoutubeViewers, row.averageYoutubeViewers, row.peakWebsiteViewers, row.averageWebsiteViewers]));
		}
		return Response.json({
			live: live ?? { state: 'offline' },
			snapshotIntervalSeconds: LIVESTREAM_SNAPSHOT_INTERVAL,
			broadcasts,
		}, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		return chatErrorResponse(error);
	}
};
