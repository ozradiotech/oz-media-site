import type { APIRoute } from 'astro';
import {
	ChatError,
	chatErrorResponse,
	chatRooms,
	db,
	isChatServerConfigured,
	isDatabaseKey,
	isModerator,
	isModeratorUid,
	logModAction,
	readJsonBody,
	serverTimestamp,
	verifyChatRequest,
	type ChatMessage,
} from '../../lib/chat-server';

export const prerender = false;

const slowModeOptions = new Set([0, 5, 10, 30, 60]);
const maxTimeoutMinutes = 24 * 60;

export const POST: APIRoute = async ({ request }) => {
	if (!isChatServerConfigured) return Response.json({ error: 'Chat is not available right now.' }, { status: 503 });
	try {
		const moderator = await verifyChatRequest(request);
		if (!isModerator(moderator)) throw new ChatError(403, 'Only moderators can do that.');
		const body = await readJsonBody(request);
		const room = typeof body.room === 'string' && chatRooms.has(body.room) ? body.room : '';
		if (!room) throw new ChatError(400, 'Unknown chat room.');

		if (body.action === 'slowmode') {
			const seconds = Number(body.seconds);
			if (!slowModeOptions.has(seconds)) throw new ChatError(400, 'Invalid slow mode.');
			await db('PATCH', `chat/rooms/${room}/meta`, { slowMode: seconds });
			await logModAction(moderator, { action: 'slowmode', room, seconds });
			return Response.json({ ok: true });
		}

		// The remaining actions target the author of a message.
		if (!isDatabaseKey(body.id)) throw new ChatError(400, 'Invalid message.');
		const id = body.id;
		const message = await db<ChatMessage | null>('GET', `chat/rooms/${room}/messages/${id}`);
		if (!message) throw new ChatError(404, 'That message is no longer in the chat.');
		const target = { uid: message.u, name: message.n, text: message.t };

		if (body.action === 'delete') {
			await db('DELETE', `chat/rooms/${room}/messages/${id}`);
			await logModAction(moderator, { action: 'delete', room, message: id, target });
			return Response.json({ ok: true });
		}

		if (body.action !== 'timeout' && body.action !== 'ban') throw new ChatError(400, 'Unknown action.');
		if (message.u === moderator.uid || await isModeratorUid(message.u)) throw new ChatError(400, 'Moderators cannot be muted or banned.');

		if (body.action === 'timeout') {
			const minutes = Number(body.minutes);
			if (!Number.isInteger(minutes) || minutes < 1 || minutes > maxTimeoutMinutes) throw new ChatError(400, 'Invalid timeout.');
			await db('PATCH', `chat/private/users/${message.u}`, { mutedUntil: Date.now() + minutes * 60_000 });
			await logModAction(moderator, { action: 'timeout', room, minutes, target });
			return Response.json({ ok: true });
		}

		// A ban also clears the user's messages that are still in the chat.
		await db('PUT', `chat/private/bans/${message.u}`, { name: message.n, room, by: moderator.uid, at: serverTimestamp });
		const theirMessages = await db<Record<string, unknown> | null>('GET', `chat/rooms/${room}/messages`, undefined, {
			orderBy: '"u"',
			equalTo: JSON.stringify(message.u),
		});
		const removals = Object.fromEntries(Object.keys(theirMessages ?? {}).map((key) => [key, null]));
		if (Object.keys(removals).length) await db('PATCH', `chat/rooms/${room}/messages`, removals);
		await logModAction(moderator, { action: 'ban', room, target, removed: Object.keys(removals).length });
		return Response.json({ ok: true });
	} catch (error) {
		return chatErrorResponse(error);
	}
};
