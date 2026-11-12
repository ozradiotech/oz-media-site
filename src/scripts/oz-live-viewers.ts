import { getDatabase, onValue, ref } from 'firebase/database';
import { getOzFirebaseApp, isChatConfigured } from './oz-firebase';

// Livestream viewer counts, beside the YouTube player on OZ Bandung, and this visitor's own part in the website count.
//
// - YouTube: YouTube's official concurrent viewer count, fetched centrally by the server (src/lib/youtube/sync.ts)
//   and shared through the database, so no visitor ever asks YouTube for it.
// - Website: people whose embedded player is actually playing here. The page listens to the player through the
//   YouTube IFrame Player API and sends a heartbeat to /api/viewers only while it plays; pausing, ending or leaving
//   stops it. Loading the page or the player doesn't count. Only one tab per browser sends (Web Locks), so several
//   tabs count once. The session id is random and made fresh for each playback.
//
// The two are different measures and are labelled as such; the combined figure is an estimate.

type LiveState = {
	state?: string;
	youtubeViewers?: number | null;
	websiteViewers?: number | null;
};

type YoutubePlayerEvent = { data: number };
type YoutubeNamespace = {
	Player: new (element: HTMLIFrameElement, options: { events: { onStateChange: (event: YoutubePlayerEvent) => void } }) => unknown;
	PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
};

declare global {
	interface Window {
		YT?: YoutubeNamespace;
		onYouTubeIframeAPIReady?: () => void;
	}
}

const room = 'bandung';
const lockName = 'oz-livestream-viewer';
const numberFormat = new Intl.NumberFormat();

let apiRequest: Promise<YoutubeNamespace> | undefined;

/** https://developers.google.com/youtube/iframe_api_reference */
const loadPlayerApi = () => {
	apiRequest ??= new Promise<YoutubeNamespace>((resolve, reject) => {
		if (window.YT?.Player) return resolve(window.YT);
		const previous = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			previous?.();
			if (window.YT) resolve(window.YT);
		};
		const script = document.createElement('script');
		script.src = 'https://www.youtube.com/iframe_api';
		script.async = true;
		script.onerror = () => {
			apiRequest = undefined;
			reject(new Error('The YouTube player API could not be loaded.'));
		};
		document.head.append(script);
	});
	return apiRequest;
};

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
	const timer = window.setTimeout(resolve, ms);
	signal.addEventListener('abort', () => {
		window.clearTimeout(timer);
		resolve();
	}, { once: true });
});

export const mountLiveViewers = ({ player, stats, signal }: { player: HTMLIFrameElement; stats?: HTMLElement | null; signal: AbortSignal }) => {
	// ---------- The counts ----------

	const youtubeCount = stats?.querySelector<HTMLElement>('[data-live-youtube]');
	const websiteCount = stats?.querySelector<HTMLElement>('[data-live-website]');
	const combined = stats?.querySelector<HTMLElement>('[data-live-combined]');
	const combinedCount = stats?.querySelector<HTMLElement>('[data-live-combined-count]');

	const known = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

	// A missing count shows as a dash, never as 0.
	const render = (live: LiveState | null) => {
		if (!stats) return;
		const isLive = live?.state === 'live';
		stats.hidden = !isLive;
		if (!isLive) return;
		if (youtubeCount) {
			youtubeCount.textContent = known(live.youtubeViewers) ? numberFormat.format(live.youtubeViewers) : '—';
			youtubeCount.title = known(live.youtubeViewers) ? '' : 'YouTube is not sharing a count for this broadcast right now';
		}
		if (websiteCount) websiteCount.textContent = known(live.websiteViewers) ? numberFormat.format(live.websiteViewers) : '—';
		const both = known(live.youtubeViewers) && known(live.websiteViewers);
		if (combined) combined.hidden = !both;
		if (combinedCount && both) combinedCount.textContent = numberFormat.format(live.youtubeViewers! + live.websiteViewers!);
	};
	signal.addEventListener('abort', () => {
		if (stats) stats.hidden = true;
	}, { once: true });

	if (isChatConfigured) {
		const unsubscribe = onValue(ref(getDatabase(getOzFirebaseApp()), `chat/rooms/${room}/meta/youtube`), (snapshot) => {
			if (!signal.aborted) render(snapshot.val() as LiveState | null);
		}, () => render(null));
		signal.addEventListener('abort', unsubscribe, { once: true });
	}

	// ---------- This visitor's heartbeat ----------

	let counting: { abort: AbortController; session: string } | undefined;

	const post = (body: { session: string; playing: boolean }) =>
		fetch('/api/viewers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });

	const sendStop = (session: string) => {
		const body = JSON.stringify({ session, playing: false });
		if (!navigator.sendBeacon?.('/api/viewers', new Blob([body], { type: 'application/json' }))) void post({ session, playing: false }).catch(() => undefined);
	};

	const heartbeat = async (stop: AbortSignal) => {
		const session = crypto.randomUUID();
		if (counting) counting.session = session;
		try {
			while (!stop.aborted) {
				let interval = 20_000;
				try {
					const response = await post({ session, playing: true });
					const result = await response.json() as { interval?: number; live?: LiveState | null };
					// 0: the site doesn't count viewers (the integration is off).
					if (result.interval === 0) return;
					if (typeof result.interval === 'number' && result.interval > 0) interval = result.interval;
					if (result.live !== undefined) render(result.live);
				} catch {
					// Try again at the next beat; missed ones just expire.
				}
				await wait(interval, stop);
			}
		} finally {
			sendStop(session);
		}
	};

	const startCounting = () => {
		if (counting || signal.aborted) return;
		const abort = new AbortController();
		counting = { abort, session: '' };
		// One tab per browser: the others wait their turn and take over if the counting tab stops.
		if (navigator.locks) {
			navigator.locks.request(lockName, { signal: abort.signal }, () => heartbeat(abort.signal)).catch(() => undefined);
		} else {
			void heartbeat(abort.signal);
		}
	};

	const stopCounting = () => {
		counting?.abort.abort();
		counting = undefined;
	};

	signal.addEventListener('abort', stopCounting, { once: true });
	window.addEventListener('pagehide', () => {
		if (counting?.session) sendStop(counting.session);
	}, { signal });

	void loadPlayerApi().then((YT) => {
		if (signal.aborted) return;
		new YT.Player(player, {
			events: {
				onStateChange: ({ data }) => {
					if (signal.aborted) return;
					if (data === YT.PlayerState.PLAYING) startCounting();
					else if (data === YT.PlayerState.PAUSED || data === YT.PlayerState.ENDED) stopCounting();
					// Buffering and the like leave things as they are; a stall long enough just lets the session expire.
				},
			},
		});
	}).catch((error) => console.warn(error));
};
