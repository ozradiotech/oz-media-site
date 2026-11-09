// Measures how fast and how stable each page is for real visitors, with Google's web-vitals library, and reports
// JavaScript errors; both go to our own server through src/scripts/oz-events.ts (see src/lib/site-events.ts).
// Loaded once per full page load by SiteMonitor.astro. Moving between OZ Bandung and OZ News without a reload isn't a
// new page load, so the vitals describe the page the visitor arrived on.
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { pageGroup, type SiteEvent } from '../lib/site-events';
import { sendEvents } from './oz-events';

const page = pageGroup(location.pathname);
let queue: SiteEvent[] = [];

// Vitals are only final when the page is hidden (CLS and INP keep changing until then), so they're sent then, in one
// beacon, which arrives even if the tab is closing.
const flush = () => {
	if (!queue.length) return;
	sendEvents(queue, true);
	queue = [];
};
addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'hidden') flush();
});
addEventListener('pagehide', flush);

const report = (metric: Metric) => {
	queue.push({ type: 'web_vital', page, name: metric.name, value: metric.value, rating: metric.rating });
};
onLCP(report);
onINP(report);
onCLS(report);
onFCP(report);
onTTFB(report);

// The whole load, from navigation start to the end of the load event.
addEventListener('load', () => {
	window.setTimeout(() => {
		const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
		if (navigation && navigation.loadEventEnd > 0) queue.push({ type: 'web_vital', page, name: 'LOAD', value: navigation.loadEventEnd });
	}, 0);
});

// JavaScript errors: a handful per page load, each different one once, without the site address or query strings.
const maxErrors = 5;
const seen = new Set<string>();
const scriptPath = (url: string | undefined) => {
	if (!url) return undefined;
	try {
		const parsed = new URL(url, location.href);
		return parsed.origin === location.origin ? parsed.pathname.slice(0, 120) : parsed.host;
	} catch {
		return undefined;
	}
};
const reportError = (message: string, source?: string, line?: number) => {
	const clean = message.replace(/https?:\/\/\S+/g, '[url]').replace(/\s+/g, ' ').trim().slice(0, 150) || 'Unknown error';
	const key = `${clean}|${source}|${line}`;
	if (seen.size >= maxErrors || seen.has(key)) return;
	seen.add(key);
	sendEvents([{ type: 'js_error', page, message: clean, source, line }]);
};
addEventListener('error', (event) => {
	// Failed images and scripts also fire "error" here, without a message; those aren't JavaScript errors.
	if (!event.message) return;
	reportError(event.message, scriptPath(event.filename), event.lineno || undefined);
});
addEventListener('unhandledrejection', (event) => {
	const reason: unknown = event.reason;
	reportError(`Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});
