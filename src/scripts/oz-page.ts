// Page setup that works with and without Astro's client router. OZ Bandung and its OZ News pages use the router
// (src/components/StationRouter.astro) so the station player keeps playing between them, and there a bundled script
// runs only once per visit, not once per page. Setup therefore runs on every page view instead, and its signal aborts
// as the visitor leaves the page, so listeners, observers and timers tied to that page can go with it.
export const onEveryPage = (setUp: (signal: AbortSignal) => void) => {
	if (!document.querySelector('meta[name="astro-view-transitions-enabled"]')) {
		setUp(new AbortController().signal);
		return;
	}
	document.addEventListener('astro:page-load', () => {
		const page = new AbortController();
		document.addEventListener('astro:before-swap', () => page.abort(), { once: true });
		setUp(page.signal);
	});
};

/** Runs `cleanup` once the page's signal aborts. */
export const onLeave = (signal: AbortSignal, cleanup: () => void) => {
	signal.addEventListener('abort', cleanup, { once: true });
};
