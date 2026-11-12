import type { APIRoute } from 'astro';
import { chatterId } from '../../lib/chat-analytics';
import { addressLimiter, firebaseStore, isYoutubeConfigured, publicLiveState, viewerConfig } from '../../lib/youtube/runtime';
import { isSessionId, recordHeartbeat } from '../../lib/youtube/viewers';
import { systemClock } from '../../lib/youtube/types';

export const prerender = false;

// Website viewer heartbeats from the livestream player (src/scripts/oz-live-viewers.ts).
//   POST { session, playing: true }   while the embedded player is playing, every `interval` ms
//   POST { session, playing: false }  when it pauses, ends or the page closes (sendBeacon)
// The session is a random id made for that playback; no account or personal detail is sent. The address is only used,
// hashed, to cap sessions per machine, and is never stored.

// Behind the aaPanel proxy: X-Real-IP, or the last X-Forwarded-For hop (the one the proxy added; earlier ones come from
// the client and can be anything).
const clientAddress = (request: Request, fallback: () => string) =>
	request.headers.get('x-real-ip')?.trim() || request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || fallback();

export const POST: APIRoute = async (context) => {
	const { request } = context;
	if (!isYoutubeConfigured) return Response.json({ counted: false, interval: 0 });
	const body: unknown = await request.json().catch(() => null);
	const { session, playing } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
	if (!isSessionId(session) || typeof playing !== 'boolean') return Response.json({ error: 'Invalid heartbeat.' }, { status: 400 });

	let ip = '';
	try {
		ip = clientAddress(request, () => context.clientAddress);
	} catch {
		ip = 'unknown';
	}
	try {
		const live = await publicLiveState();
		const result = await recordHeartbeat(firebaseStore, systemClock, viewerConfig, addressLimiter, {
			session,
			playing,
			address: chatterId(ip),
			live: live?.state === 'live',
		});
		// The current public counts ride along, so the numbers stay fresh even when the page's database connection
		// has gone idle.
		return Response.json({ ...result, interval: viewerConfig.heartbeatMs, live }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		console.error('[viewers] Heartbeat failed:', error);
		return Response.json({ counted: false, interval: viewerConfig.heartbeatMs }, { status: 503 });
	}
};
