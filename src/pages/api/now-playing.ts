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

// `?mount=ozbali` reads that Icecast mount, so a page can ask for whichever stream it plays.
// Without one (or with an invalid name) it falls back to OZ Bandung.
const defaultMount = 'ozbandung';

export const GET: APIRoute = async ({ url }) => {
	const requestedMount = url.searchParams.get('mount') ?? '';
	const mount = `/${/^[\w-]{1,64}$/.test(requestedMount) ? requestedMount : defaultMount}`;
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