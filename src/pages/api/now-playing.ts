import type { APIRoute } from 'astro';

type IcecastSource = {
	listenurl?: string;
	title?: string;
	listeners?: number;
	listener_peak?: number;
};

type IcecastStatus = {
	icestats?: {
		source?: IcecastSource | IcecastSource[];
	};
};

// Icecast mount for each station; `?station=bali` picks Bali, anything else falls back to Bandung.
const stationMounts: Record<string, string> = {
	bandung: '/ozbandung',
	bali: '/ozbali',
};

export const GET: APIRoute = async ({ url }) => {
	const mount = stationMounts[url.searchParams.get('station') ?? ''] ?? stationMounts.bandung;
	try {
		const response = await fetch('https://streaming.ozradio.id:8443/status-json.xsl', {
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) throw new Error('Icecast status request failed.');

		const status = (await response.json()) as IcecastStatus;
		const sources = Array.isArray(status.icestats?.source)
			? status.icestats.source
			: [status.icestats?.source];
		const source = sources.find((item) => item?.listenurl?.endsWith(mount));

		return Response.json(
			{
				// False while the station isn't sending to the server, i.e. off air.
				online: Boolean(source),
				title: source?.title?.trim() ?? '',
				listeners: source?.listeners ?? null,
				peakListeners: source?.listener_peak ?? null,
			},
			{ headers: { 'Cache-Control': 'no-store' } },
		);
	} catch {
		return Response.json(
			{ online: false, title: '', listeners: null, peakListeners: null },
			{ status: 502, headers: { 'Cache-Control': 'no-store' } },
		);
	}
};