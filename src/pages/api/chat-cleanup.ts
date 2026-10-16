import type { APIRoute } from 'astro';
import { CRON_SECRET } from 'astro:env/server';
import { chatErrorResponse, chatRooms, db, isChatServerConfigured } from '../../lib/chat-server';

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

// Run daily by Vercel Cron (vercel.json), which sends `Authorization: Bearer $CRON_SECRET`.
// When self-hosting, call it the same way from a system cron job.
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

		return Response.json({ removed, users });
	} catch (error) {
		return chatErrorResponse(error);
	}
};
