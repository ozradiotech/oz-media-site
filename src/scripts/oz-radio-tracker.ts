// Radio listening analytics, sent to our own server (/api/track; see src/lib/radio-events.ts for the events and
// src/lib/radio-stats.ts for what the dashboard makes of them). OZ Bandung's station script drives it from the
// player's events.
//
// No names, no cookies and no IP addresses are stored. A random id per page load groups a visit's events; a lasting
// listener id, to count returning listeners, is only kept and sent for visitors who accepted analytics cookies.
import { consentStorageKey, listenerIdStorageKey as visitorKey } from '../lib/analytics-config';
import { heartbeatInterval, type EndReason, type InterruptionKind, type PlaySource, type RadioEvent, type StreamType } from '../lib/radio-events';

const endpoint = '/api/track';
const randomId = () => crypto.randomUUID();
const tab = randomId();

const visitorId = () => {
	try {
		if (localStorage.getItem(consentStorageKey) !== 'granted') {
			// Declined (or never asked): drop any id kept from an earlier "accept".
			localStorage.removeItem(visitorKey);
			return undefined;
		}
		let id = localStorage.getItem(visitorKey);
		if (!id) {
			id = randomId();
			localStorage.setItem(visitorKey, id);
		}
		return id;
	} catch {
		return undefined;
	}
};

// While the page is closing only sendBeacon is sure to arrive; otherwise a keep-alive fetch.
const send = (events: RadioEvent[], closing = false) => {
	const body = JSON.stringify({ tab, vid: visitorId(), events });
	if (import.meta.env.DEV) console.debug('[radio]', ...events.map((event) => event.type), events);
	if (closing && navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }))) return;
	void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
};

type Session = {
	sid: string;
	stream: StreamType;
	/** Sound heard before the current stretch, and when the current stretch started (null while stalled). */
	listenedMs: number;
	playingSince: number | null;
	timer: number;
};

let session: Session | null = null;
const lastClick: Partial<Record<StreamType, number>> = {};

const listened = (current: Session) => current.listenedMs + (current.playingSince === null ? 0 : performance.now() - current.playingSince);

export const radioTracker = {
	/** A play button was pressed (or a stream picked in the tune-in dialog). */
	click(stream: StreamType, source: PlaySource) {
		lastClick[stream] = performance.now();
		send([{ type: 'play_click', stream, source }]);
	},

	isListening(stream?: StreamType) {
		return Boolean(session && (!stream || session.stream === stream));
	},

	/** Sound started: a new listening session. Ends any other one still open, as a switch. */
	start(stream: StreamType, source: PlaySource) {
		if (session) this.end('switch');
		const clickedAt = lastClick[stream];
		delete lastClick[stream];
		const sid = randomId();
		const current: Session = { sid, stream, listenedMs: 0, playingSince: performance.now(), timer: 0 };
		current.timer = window.setInterval(() => {
			if (session === current) send([{ type: 'heartbeat', sid, stream, listenedMs: listened(current) }]);
		}, heartbeatInterval);
		session = current;
		// How long the listener waited between pressing play and hearing sound.
		const waitMs = clickedAt === undefined ? undefined : performance.now() - clickedAt;
		send([{ type: 'stream_start', sid, stream, source, waitMs }]);
	},

	/** The stream stalled (buffering) or dropped and is being re-opened; listening time pauses until it plays again. */
	interrupted(kind: InterruptionKind) {
		if (!session) return;
		if (session.playingSince !== null) {
			session.listenedMs = listened(session);
			session.playingSince = null;
			send([{ type: 'interruption', sid: session.sid, stream: session.stream, kind }]);
		}
	},

	/** Sound is back after an interruption. */
	resumed() {
		if (session && session.playingSince === null) session.playingSince = performance.now();
	},

	end(reason: EndReason, closing = false) {
		if (!session) return;
		const current = session;
		session = null;
		window.clearInterval(current.timer);
		send([{ type: 'stream_end', sid: current.sid, stream: current.stream, listenedMs: listened(current), reason }], closing);
	},

	error(stream: StreamType, code: string) {
		send([{ type: 'stream_error', sid: session?.sid, stream, code }]);
	},
};

// Closing the tab or leaving the site ends the session. (Moving between OZ Bandung and OZ News doesn't fire this:
// the player keeps playing there.)
addEventListener('pagehide', () => radioTracker.end('page_close', true));
