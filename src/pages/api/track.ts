import type { APIRoute } from 'astro';
import { appendEvents, type StoredEvent } from '../../lib/event-store';
import { chatDisconnectCauses, chatRoomNames, chatSignInStatuses } from '../../lib/chat-events';
import { endReasons, interruptionKinds, playSources, streamTypes } from '../../lib/radio-events';
import { isBot, parseUserAgent } from '../../lib/user-agent';

// Receives our own analytics events (radio listening and live chat; see src/scripts/oz-events.ts) and stores them
// (src/lib/event-store.ts).
// Public and unauthenticated, so everything is checked against the allowed values and anything else is dropped.
// The IP address is only used, in memory, to rate-limit; it is never stored. Neither is the User-Agent header, only
// the device type, OS and browser read from it.

export const prerender = false;

const maxEvents = 20;
const maxBody = 8_000;
const rateWindow = 10 * 60_000;
const rateLimit = 300;
const hits = new Map<string, { count: number; since: number }>();

const isLimited = (key: string) => {
	const now = Date.now();
	const entry = hits.get(key);
	if (!entry || now - entry.since > rateWindow) {
		hits.set(key, { count: 1, since: now });
		// Forget old addresses now and then, so the map can't grow without end.
		if (hits.size > 5_000) for (const [address, value] of hits) if (now - value.since > rateWindow) hits.delete(address);
		return false;
	}
	entry.count += 1;
	return entry.count > rateLimit;
};

const id = (value: unknown) => (typeof value === 'string' && /^[\w-]{8,64}$/.test(value) ? value : undefined);
const oneOf = <T extends string>(values: readonly T[], value: unknown) => (values as readonly unknown[]).includes(value) ? value as T : undefined;
// Durations are capped at a day: one session can't sensibly be longer.
const duration = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 86_400_000) : undefined);
const errorCode = (value: unknown) => (typeof value === 'string' && /^[\w-]{1,40}$/.test(value) ? value : undefined);

type CleanEvent = { type: string } & Record<string, string | number | undefined>;

const cleanChat = (event: Record<string, unknown>): CleanEvent | null => {
	const room = oneOf(chatRoomNames, event.room);
	if (!room) return null;
	switch (event.type) {
		case 'chat_view':
			return typeof event.signedIn === 'boolean' ? { type: 'chat_view', room, signedIn: event.signedIn ? 1 : 0 } : null;
		case 'chat_sign_in': {
			const status = oneOf(chatSignInStatuses, event.status);
			if (!status) return null;
			return { type: 'chat_sign_in', room, status, newAccount: event.newAccount === true ? 1 : undefined, code: errorCode(event.code) };
		}
		case 'chat_first_message': {
			const waitMs = duration(event.waitMs);
			return waitMs === undefined ? null : { type: 'chat_first_message', room, waitMs };
		}
		case 'chat_send_error':
			return event.reason === 'network' ? { type: 'chat_send_error', room, reason: 'network' } : null;
		case 'chat_connection':
			if (event.state === 'connected') return { type: 'chat_connection', room, state: 'connected' };
			if (event.state !== 'disconnected') return null;
			return { type: 'chat_connection', room, state: 'disconnected', cause: oneOf(chatDisconnectCauses, event.cause) ?? 'network' };
		default:
			return null;
	}
};

/** The stored form of one incoming event, or null when it isn't valid. */
const clean = (input: unknown): CleanEvent | null => {
	if (!input || typeof input !== 'object') return null;
	const event = input as Record<string, unknown>;
	if (typeof event.type === 'string' && event.type.startsWith('chat_')) return cleanChat(event);
	const stream = oneOf(streamTypes, event.stream);
	if (!stream) return null;
	switch (event.type) {
		case 'play_click': {
			const source = oneOf(playSources, event.source);
			return source ? { type: 'play_click', stream, source } : null;
		}
		case 'stream_start': {
			const sid = id(event.sid);
			const source = oneOf(playSources, event.source);
			return sid && source ? { type: 'stream_start', sid, stream, source, waitMs: duration(event.waitMs) } : null;
		}
		case 'heartbeat':
		case 'stream_end': {
			const sid = id(event.sid);
			const listenedMs = duration(event.listenedMs);
			if (!sid || listenedMs === undefined) return null;
			if (event.type === 'heartbeat') return { type: 'heartbeat', sid, stream, listenedMs };
			const reason = oneOf(endReasons, event.reason);
			return reason ? { type: 'stream_end', sid, stream, listenedMs, reason } : null;
		}
		case 'interruption': {
			const sid = id(event.sid);
			const kind = oneOf(interruptionKinds, event.kind);
			return sid && kind ? { type: 'interruption', sid, stream, kind } : null;
		}
		case 'stream_error': {
			const code = errorCode(event.code);
			return code ? { type: 'stream_error', sid: id(event.sid), stream, code } : null;
		}
		default:
			return null;
	}
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const userAgent = request.headers.get('User-Agent') ?? '';
	// Bots and over-eager clients get a quiet "accepted", so there's nothing to probe.
	if (isBot(userAgent) || isLimited(clientAddress ?? 'unknown')) return new Response(null, { status: 202 });

	const text = await request.text().catch(() => '');
	if (!text || text.length > maxBody) return new Response('Invalid events.', { status: 400 });
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(text);
	} catch {
		return new Response('Invalid events.', { status: 400 });
	}
	const tab = id(body?.tab);
	if (!tab || !Array.isArray(body.events)) return new Response('Invalid events.', { status: 400 });

	const at = new Date().toISOString();
	const client = parseUserAgent(userAgent);
	const vid = id(body.vid);
	const events = body.events.slice(0, maxEvents)
		.map(clean)
		.filter((event): event is CleanEvent => event !== null)
		.map((event): StoredEvent => ({ ...event, at, tab, vid, ...client }));

	// Vercel's filesystem is read-only, so accept the events there without storing them.
	if (process.env.VERCEL || !events.length) return new Response(null, { status: 202 });
	try {
		await appendEvents(events);
	} catch (error) {
		console.error('Analytics events could not be saved:', error);
		return new Response('Events could not be saved.', { status: 500 });
	}
	return new Response(null, { status: 204 });
};
