// Site performance events: Core Web Vitals, page load time and JavaScript errors, sent by the browser
// (src/scripts/oz-site-monitor.ts) to /api/track. Shared by both sides, so they agree on what is valid.

/** The Core Web Vitals and their companions, measured by Google's web-vitals library, plus LOAD: the whole page load. */
export const vitalNames = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'LOAD'] as const;
export type VitalName = (typeof vitalNames)[number];

export const vitalRatings = ['good', 'needs-improvement', 'poor'] as const;
export type VitalRating = (typeof vitalRatings)[number];

/** Google's thresholds (https://web.dev/articles/vitals): up to `good` is good, above `poor` is poor. LOAD has none. */
export const vitalThresholds: Partial<Record<VitalName, { good: number; poor: number }>> = {
	LCP: { good: 2500, poor: 4000 },
	INP: { good: 200, poor: 500 },
	CLS: { good: 0.1, poor: 0.25 },
	FCP: { good: 1800, poor: 3000 },
	TTFB: { good: 800, poor: 1800 },
};

/** Pages are reported by kind, not address, so query strings and article slugs never leave the browser. */
export const pageGroups = ['Home', 'OZ Bandung', 'OZ News', 'News article', 'OZ Bali', 'Privacy policy', 'Other'] as const;
export type PageGroup = (typeof pageGroups)[number];

export const pageGroup = (path: string): PageGroup => {
	const clean = path.replace(/\/+$/, '') || '/';
	if (clean === '/') return 'Home';
	if (clean === '/oz-bandung') return 'OZ Bandung';
	if (clean === '/oz-bandung/news') return 'OZ News';
	if (clean.startsWith('/oz-bandung/news/')) return 'News article';
	if (clean === '/oz-bali') return 'OZ Bali';
	if (clean === '/privacy-policy') return 'Privacy policy';
	return 'Other';
};

export type SiteEvent =
	| { type: 'web_vital'; page: PageGroup; name: VitalName; value: number; rating?: VitalRating }
	/** `message` is cut short and `source` is the script's path only, without the site address or query. */
	| { type: 'js_error'; page: PageGroup; message: string; source?: string; line?: number };
