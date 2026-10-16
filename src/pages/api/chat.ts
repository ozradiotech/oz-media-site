import type { APIRoute } from 'astro';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { cleanText, duplicateKey, emojiCount, filterText, hasLink } from '../../lib/chat-filter';
import {
	ChatError,
	chatErrorResponse,
	chatRooms,
	db,
	getBlocklist,
	isChatServerConfigured,
	isDatabaseKey,
	isModerator,
	readJsonBody,
	serverTimestamp,
	verifyChatRequest,
	type ChatMessage,
} from '../../lib/chat-server';

export const prerender = false;

const maxLength = 200;
const maxEmoji = 12;
const minIntervalSeconds = 3;
const duplicateWindow = 60_000;
// Three strikes (too fast, repeated, links, severe words) within a minute mutes the sender for five minutes.
const strikeWindow = 60_000;
const strikeLimit = 3;
const autoMuteMinutes = 5;
// A message reported by this many different listeners is hidden until a moderator reviews it.
const reportThreshold = 3;

type UserRecord = {
	last?: number;
	lastText?: string;
	strikes?: number;
	strikesSince?: number;
	mutedUntil?: number;
};

const minutesLeft = (until: number) => Math.max(1, Math.ceil((until - Date.now()) / 60_000));

const send = async (user: DecodedIdToken, room: string, input: unknown) => {
	const now = Date.now();
	const [ban, record, meta, blocklist] = await Promise.all([
		db('GET', `chat/private/bans/${user.uid}`),
		db<UserRecord | null>('GET', `chat/private/users/${user.uid}`),
		db<{ slowMode?: number } | null>('GET', `chat/rooms/${room}/meta`),
		getBlocklist(),
	]);
	if (ban) throw new ChatError(403, 'You have been banned from the chat.');
	const state = record ?? {};
	if (state.mutedUntil && state.mutedUntil > now) {
		throw new ChatError(403, `You are muted for ${minutesLeft(state.mutedUntil)} more minute(s).`);
	}

	const moderator = isModerator(user);
	// Records a strike and returns the error to throw.
	const strike = async (status: number, message: string) => {
		const recent = state.strikesSince && now - state.strikesSince < strikeWindow;
		const strikes = (recent ? state.strikes ?? 0 : 0) + 1;
		const muted = strikes >= strikeLimit;
		await db('PATCH', `chat/private/users/${user.uid}`, muted
			? { strikes: 0, strikesSince: null, mutedUntil: now + autoMuteMinutes * 60_000 }
			: { strikes, strikesSince: recent ? state.strikesSince : now });
		return new ChatError(status, muted ? `${message} You have been muted for ${autoMuteMinutes} minutes.` : message);
	};

	const intervalSeconds = moderator ? 0 : Math.max(minIntervalSeconds, meta?.slowMode ?? 0);
	if (state.last && now - state.last < intervalSeconds * 1000) {
		throw await strike(429, `Slow down: wait ${intervalSeconds} seconds between messages.`);
	}

	const text = cleanText(typeof input === 'string' ? input : '');
	if (!text) throw new ChatError(400, 'Type a message first.');
	if ([...text].length > maxLength) throw new ChatError(400, `Messages can be up to ${maxLength} characters.`);
	if (emojiCount(text) > maxEmoji) throw new ChatError(400, 'That is a lot of emoji. Try fewer.');
	if (!moderator && hasLink(text)) throw await strike(400, 'Links are not allowed in the chat.');

	const filtered = filterText(text, blocklist);
	if (!filtered.ok) throw await strike(400, 'That message breaks the chat rules.');
	const safeText = filtered.text;

	const key = duplicateKey(safeText);
	if (!moderator && state.last && state.lastText === key && now - state.last < duplicateWindow) {
		throw await strike(429, 'You just sent that.');
	}

	const message: Omit<ChatMessage, 'ts'> & { ts: typeof serverTimestamp } = {
		u: user.uid,
		n: cleanText(user.name ?? '').slice(0, 40) || 'Listener',
		t: safeText,
		ts: serverTimestamp,
	};
	if (typeof user.picture === 'string' && user.picture.startsWith('https://')) message.p = user.picture;
	if (moderator) message.m = true;

	const [{ name: id }] = await Promise.all([
		db<{ name: string }>('POST', `chat/rooms/${room}/messages`, message),
		db('PATCH', `chat/private/users/${user.uid}`, { last: now, lastText: key }),
	]);
	return Response.json({ id }, { status: 201 });
};

const report = async (user: DecodedIdToken, room: string, id: unknown) => {
	if (!isDatabaseKey(id)) throw new ChatError(400, 'Invalid message.');
	const [ban, message] = await Promise.all([
		db('GET', `chat/private/bans/${user.uid}`),
		db<ChatMessage | null>('GET', `chat/rooms/${room}/messages/${id}`),
	]);
	if (ban) throw new ChatError(403, 'You have been banned from the chat.');
	if (!message) return Response.json({ hidden: true });
	if (message.u === user.uid) throw new ChatError(400, 'You cannot report your own message.');

	await db('PUT', `chat/private/reports/${room}/${id}/${user.uid}`, true);
	const reports = await db<Record<string, unknown> | null>('GET', `chat/private/reports/${room}/${id}`, undefined, { shallow: 'true' });
	const count = Object.keys(reports ?? {}).length;
	if (count < reportThreshold || message.m) return Response.json({ hidden: false });

	// Kept under chat/private/flagged so a moderator can review it in the Firebase console.
	await db('PUT', `chat/private/flagged/${room}/${id}`, { ...message, room, reports: count, flaggedAt: serverTimestamp });
	await db('DELETE', `chat/rooms/${room}/messages/${id}`);
	return Response.json({ hidden: true });
};

export const POST: APIRoute = async ({ request }) => {
	if (!isChatServerConfigured) return Response.json({ error: 'Chat is not available right now.' }, { status: 503 });
	try {
		const user = await verifyChatRequest(request);
		const body = await readJsonBody(request);
		const room = typeof body.room === 'string' && chatRooms.has(body.room) ? body.room : '';
		if (!room) throw new ChatError(400, 'Unknown chat room.');
		if (body.action === 'report') return await report(user, room, body.id);
		return await send(user, room, body.text);
	} catch (error) {
		return chatErrorResponse(error);
	}
};
