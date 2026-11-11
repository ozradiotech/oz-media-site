// Live chat analytics events sent by the browser (src/scripts/oz-chat.ts) to /api/track. Shared by both sides, so they
// agree on what is valid. What only the server can know (messages posted or refused, reports, moderation) is logged
// by the chat routes themselves; see src/lib/chat-analytics.ts.

/** The chat rooms; OZ Bandung's page uses 'bandung'. */
export const chatRoomNames = ['bandung', 'bali'] as const;

/**
 * Chat roles, set per Google account in the CMS (Chat roles; oz-cms src/collections/ChatStaff.ts). Every role can
 * moderate; the role is the badge on the person's messages.
 */
export const chatRoles = { dev: 'DEV', operator: 'OPERATOR', host: 'HOST', mod: 'MOD' } as const;
export type ChatRole = keyof typeof chatRoles;
export const isChatRole = (value: unknown): value is ChatRole => typeof value === 'string' && value in chatRoles;

export const chatSignInStatuses = ['attempt', 'success', 'cancelled', 'failed'] as const;
export type ChatSignInStatus = (typeof chatSignInStatuses)[number];

/** Why the database connection went: the chat sat unseen (idle), the network dropped, or the visitor left the page. */
export const chatDisconnectCauses = ['idle', 'network', 'leave'] as const;
export type ChatDisconnectCause = (typeof chatDisconnectCauses)[number];

export type ChatEvent =
	/** The chat was shown, once per page view. A view is not a person: one visitor can make many. */
	| { type: 'chat_view'; room: string; signedIn: boolean }
	| { type: 'chat_sign_in'; room: string; status: ChatSignInStatus; newAccount?: boolean; code?: string }
	/** Time from the chat being shown to this page view's first message. */
	| { type: 'chat_first_message'; room: string; waitMs: number }
	/** A message that never reached the server (the server logs the ones it refuses). */
	| { type: 'chat_send_error'; room: string; reason: 'network' }
	| { type: 'chat_connection'; room: string; state: 'connected' }
	| { type: 'chat_connection'; room: string; state: 'disconnected'; cause: ChatDisconnectCause };
