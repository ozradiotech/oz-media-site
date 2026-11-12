// Where the integration keeps things in the Realtime Database. Everything under chat/private is closed to browsers by
// database.rules.json; chat/rooms/{room}/meta is public, which is how the page gets the live state and viewer counts.

export const youtubeRoot = 'chat/private/youtube';

export const paths = {
	auth: `${youtubeRoot}/auth`,
	settings: `${youtubeRoot}/settings`,
	state: `${youtubeRoot}/state`,
	lease: `${youtubeRoot}/lease`,
	oauthStates: `${youtubeRoot}/oauthStates`,
	outbox: `${youtubeRoot}/outbox`,
	/** Message ids still waiting to go to YouTube: `{ [messageId]: nextAt }`. Small, so it is read whole. */
	queue: `${youtubeRoot}/queue`,
	/** YouTube ids of messages the site posted itself (hashed keys), so the reader skips their echo. */
	sent: `${youtubeRoot}/sent`,
	/** Keys of YouTube messages already copied in, so a re-read never brings back one a moderator deleted. */
	imported: `${youtubeRoot}/imported`,
	/** Website viewers: `{ [sessionId]: { until, ip } }`. */
	viewers: `${youtubeRoot}/viewers`,
	messages: (room: string) => `chat/rooms/${room}/messages`,
	publicLive: (room: string) => `chat/rooms/${room}/meta/youtube`,
	bans: 'chat/private/bans',
	users: 'chat/private/users',
} as const;

/** The room the YouTube livestream belongs to. */
export const youtubeRoom = 'bandung';
