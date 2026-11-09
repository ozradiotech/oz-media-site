// Custom events for Google Analytics 4 (src/components/GoogleAnalytics.astro). An event is only sent when the
// visitor has accepted analytics cookies; otherwise, and wherever GA isn't on the page (development, /analytics),
// track() does nothing. In development each event is logged to the console instead, so it can be checked.
//
// Parameters never carry personal details (names, emails, locations): only what was done, and how.
// Event and parameter names follow GA4's style, snake_case; see README → Analytics for the full list.
import { consentStorageKey } from '../lib/analytics-config';

export type TrackParams = Record<string, string | number | boolean | undefined>;

type Gtag = (command: 'event', name: string, params: TrackParams) => void;

export const track = (name: string, params: TrackParams = {}) => {
	if (import.meta.env.DEV) console.debug('[track]', name, params);
	const gtag = (window as Window & { gtag?: Gtag }).gtag;
	if (!gtag) return;
	try {
		if (localStorage.getItem(consentStorageKey) !== 'granted') return;
	} catch {
		return;
	}
	gtag('event', name, params);
};
