import type { APIRoute } from 'astro';

type IcecastSource = {
	listenurl?: string;
	title?: string;
};

type IcecastStatus = {
	icestats?: {
		source?: IcecastSource | IcecastSource[];
	};
};

export const GET: APIRoute = async () => {
	try {
		const response = await fetch('https://streaming.ozradio.id:8443/status-json.xsl', {
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) throw new Error('Icecast status request failed.');

		const status = (await response.json()) as IcecastStatus;
		const sources = Array.isArray(status.icestats?.source)
			? status.icestats.source
			: [status.icestats?.source];
		const source = sources.find((item) => item?.listenurl?.endsWith('/ozbandung'));

		return Response.json(
			{ title: source?.title?.trim() ?? '' },
			{ headers: { 'Cache-Control': 'no-store' } },
		);
	} catch {
		return Response.json(
			{ title: '' },
			{ status: 502, headers: { 'Cache-Control': 'no-store' } },
		);
	}
};