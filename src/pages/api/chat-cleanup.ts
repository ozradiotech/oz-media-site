import type { APIRoute } from 'astro';
import { CRON_SECRET } from 'astro:env/server';
import { chatErrorResponse, chatRooms, db, isChatServerConfigured } from '../../lib/chat-server';
import { pruneYoutube, type KeyRange } from '../../lib/youtube/cleanup';
import { firebaseStore } from '../../lib/youtube/runtime';

export const prerender = false;

const messageLifetime = 24 * 60 * 60 * 1000;
const batchSize = 500;
const maxBatches = 20;

type UserRecord = { last?: number; mutedUntil?: number };

/** Removes up to batchSize children of `path` at or before `cutoff` on `field`. Returns their keys. */
const removeOlderThan = async (path: string, field: string, cutoff: number, keep?: (value: UserRecord) => boolean) => {
	const old = await db<Record<string, UserRecord> | null>('GET', path, undefined, {
		orderBy: JSON.stringify(field),
		endAt: String(cutoff),
		limitToFirst: String(batchSize),
	});
	const keys = Object.entries(old ?? {}).filter(([, value]) => !keep?.(value)).map(([key]) => key);
	if (keys.length) await db('PATCH', path, Object.fromEntries(keys.map((key) => [key, null])));
	return { keys, more: Object.keys(old ?? {}).length === batchSize };
};

/** Children of `path` by key, up to `endKey`: the YouTube sync's records are keyed by time (src/lib/youtube/cleanup.ts). */
const keyRange: KeyRange = (path, endKey, limit) =>
	db('GET', path, undefined, { orderBy: '"$key"', endAt: JSON.stringify(endKey), limitToFirst: String(limit) });

// Run daily. Self-hosted (ozmedianet.com): an aaPanel cron job calls it with `Authorization: Bearer $CRON_SECRET`
// (see README.md). On Vercel, Vercel Cron does the same (vercel.json).
export const GET: APIRoute = async ({ request }) => {
	if (!CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${CRON_SECRET}`) {
		return new Response('Unauthorized.', { status: 401 });
	}
	if (!isChatServerConfigured) return new Response('Chat is not configured.', { status: 503 });

	try {
		const now = Date.now();
		const cutoff = now - messageLifetime;
		const removed: Record<string, number> = {};

		for (const room of chatRooms) {
			removed[room] = 0;
			for (let batch = 0; batch < maxBatches; batch++) {
				const { keys, more } = await removeOlderThan(`chat/rooms/${room}/messages`, 'ts', cutoff);
				// Reports on removed messages are no longer needed.
				if (keys.length) await db('PATCH', `chat/private/reports/${room}`, Object.fromEntries(keys.map((key) => [key, null])));
				removed[room] += keys.length;
				if (!more) break;
			}
		}

		// Rate-limit records of people who haven't chatted for a day, unless they are still muted.
		let users = 0;
		for (let batch = 0; batch < maxBatches; batch++) {
			const { keys, more } = await removeOlderThan('chat/private/users', 'last', cutoff, (user) => (user.mutedUntil ?? 0) > now);
			users += keys.length;
			if (!more) break;
		}

		// The YouTube sync's own records (sent and imported markers, the outgoing queue), whether or not it is set up.
		const youtube = await pruneYoutube(firebaseStore, keyRange, now, { lifetimeMs: messageLifetime, batchSize, maxBatches });

		return Response.json({ removed, users, youtube });
	} catch (error) {
		return chatErrorResponse(error);
	}
};
