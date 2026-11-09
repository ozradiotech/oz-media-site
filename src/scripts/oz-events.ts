// Sends our own analytics events (radio listening, live chat) to /api/track, which checks and stores them
// (src/pages/api/track.ts). See src/lib/radio-events.ts and src/lib/chat-events.ts for the events.
//
// No cookies. A random id per page load (`tab`) groups a visit's events; a lasting listener id, to count returning
// visitors, is only kept and sent for visitors who accepted analytics cookies.
import { consentStorageKey, listenerIdStorageKey } from '../lib/analytics-config';
import type { ChatEvent } from '../lib/chat-events';
import type { RadioEvent } from '../lib/radio-events';
import type { SiteEvent } from '../lib/site-events';

export type OzEvent = RadioEvent | ChatEvent | SiteEvent;

const endpoint = '/api/track';

export const randomId = () => crypto.randomUUID();

/** This page load's id. It also goes with chat messages, so the dashboard can count messages per visit. */
export const tabId = randomId();

const visitorId = () => {
	try {
		if (localStorage.getItem(consentStorageKey) !== 'granted') {
			// Declined (or never asked): drop any id kept from an earlier "accept".
			localStorage.removeItem(listenerIdStorageKey);
			return undefined;
		}
		let id = localStorage.getItem(listenerIdStorageKey);
		if (!id) {
			id = randomId();
			localStorage.setItem(listenerIdStorageKey, id);
		}
		return id;
	} catch {
		return undefined;
	}
};

/** `closing`: the page is going away, when only sendBeacon is sure to arrive. Otherwise a keep-alive fetch. */
export const sendEvents = (events: OzEvent[], closing = false) => {
	if (!events.length) return;
	const body = JSON.stringify({ tab: tabId, vid: visitorId(), events });
	if (import.meta.env.DEV) console.debug('[events]', ...events.map((event) => event.type), events);
	if (closing && navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }))) return;
	void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
};
