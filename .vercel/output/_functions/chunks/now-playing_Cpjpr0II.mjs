import { t as __exportAll } from "./rolldown-runtime_D7D4PA-g.mjs";
//#region src/pages/api/now-playing.ts
var now_playing_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
var GET = async () => {
	try {
		const response = await fetch("https://streaming.ozradio.id:8443/status-json.xsl", { signal: AbortSignal.timeout(5e3) });
		if (!response.ok) throw new Error("Icecast status request failed.");
		const status = await response.json();
		const source = (Array.isArray(status.icestats?.source) ? status.icestats.source : [status.icestats?.source]).find((item) => item?.listenurl?.endsWith("/ozbandung"));
		return Response.json({
			title: source?.title?.trim() ?? "",
			listeners: source?.listeners ?? null,
			peakListeners: source?.listener_peak ?? null
		}, { headers: { "Cache-Control": "no-store" } });
	} catch {
		return Response.json({
			title: "",
			listeners: null,
			peakListeners: null
		}, {
			status: 502,
			headers: { "Cache-Control": "no-store" }
		});
	}
};
//#endregion
//#region \0virtual:astro:page:src/pages/api/now-playing@_@ts
var page = () => now_playing_exports;
//#endregion
export { page };
