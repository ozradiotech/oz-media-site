// Server only. Chat analytics the server is the only one to know: messages posted or refused (and why), reports and
// moderation. Appended to the same event store as the radio listening (src/lib/event-store.ts) and summarised by
// src/lib/chat-stats.ts. Browser-side chat events (views, sign-ins, connections) come in through /api/track.
//
// Chatters are stored as a keyed hash of their account id (`cid`), never the id, name or email: enough to count unique
// and returning chatters, not to tell who they are. The key is ANALYTICS_SALT, or the service-account key when unset;
// changing it starts the counts afresh.
import { createHmac } from 'node:crypto';
import { ANALYTICS_SALT, FIREBASE_SERVICE_ACCOUNT } from 'astro:env/server';
import { appendEvents } from './event-store';

const salt = ANALYTICS_SALT || FIREBASE_SERVICE_ACCOUNT || 'oz-radio';

export const chatterId = (uid: string) => createHmac('sha256', salt).update(uid).digest('base64url').slice(0, 22);

/** Why a message was refused, as stored. */
export type RefusalReason =
	| 'signed_out'
	| 'banned'
	| 'muted'
	| 'too_fast'
	| 'empty'
	| 'too_long'
	| 'emoji'
	| 'link'
	| 'blocked_words'
	| 'duplicate'
	| 'error';

export type ChatLogEvent =
	| { type: 'chat_message'; room: string; cid: string; tab?: string; moderator?: boolean }
	| { type: 'chat_refused'; room: string; cid?: string; tab?: string; reason: RefusalReason }
	| { type: 'chat_report'; room: string; cid: string; hidden: boolean }
	| { type: 'chat_moderation'; room: string; action: 'delete' | 'timeout' | 'ban' | 'slowmode' | 'auto_mute' | 'auto_hide' };

/** Records a chat event. Never throws: analytics must not break the chat. */
export const logChatEvent = async (event: ChatLogEvent) => {
	// Vercel's filesystem is read-only; nothing to store there.
	if (process.env.VERCEL) return;
	try {
		const stored = Object.fromEntries(Object.entries({ at: new Date().toISOString(), ...event }).map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value]));
		await appendEvents([stored as { at: string; type: string }]);
	} catch (error) {
		console.error('Chat analytics could not be saved:', error);
	}
};
