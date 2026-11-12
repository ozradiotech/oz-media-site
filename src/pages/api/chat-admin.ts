import type { APIRoute } from 'astro';
import { requireLivestreamAccess } from '../../lib/admin-access';
import { ChatError, chatErrorResponse, db, isChatServerConfigured, isDatabaseKey, readJsonBody } from '../../lib/chat-server';

export const prerender = false;

// Live chat administration for the CMS admin's Live chat → Moderation page (and anyone with the same CMS role).
//   GET   the bans. CMS Developer or Digital.
//   POST  { action: 'unban', uid } lifts a ban and any mute. CMS Developer.
// Moderators keep banning, muting and slow mode from the chat itself; this is for undoing and overseeing it.
// The blocklist words now live in the CMS (Chat settings), read by src/lib/chat-server.ts.

type Ban = { name?: string; room?: string; by?: string; at?: number };

export const GET: APIRoute = async ({ request }) => {
	try {
		const { access } = await requireLivestreamAccess(request, 'view');
		if (!isChatServerConfigured) throw new ChatError(503, 'Chat is not available right now.');
		const bans = await db<Record<string, Ban> | null>('GET', 'chat/private/bans');
		return Response.json({
			access,
			bans: Object.entries(bans ?? {})
				.map(([uid, ban]) => ({ uid, name: ban.name ?? '', room: ban.room ?? '', at: ban.at ?? null, youtube: uid.startsWith('yt-') }))
				.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)),
		}, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		return chatErrorResponse(error);
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		await requireLivestreamAccess(request, 'manage');
		if (!isChatServerConfigured) throw new ChatError(503, 'Chat is not available right now.');
		const body = await readJsonBody(request);
		if (body.action !== 'unban') throw new ChatError(400, 'Unknown action.');
		if (!isDatabaseKey(body.uid)) throw new ChatError(400, 'Invalid account.');
		await db('PATCH', '', { [`chat/private/bans/${body.uid}`]: null, [`chat/private/users/${body.uid}/mutedUntil`]: null });
		return Response.json({ ok: true });
	} catch (error) {
		return chatErrorResponse(error);
	}
};
