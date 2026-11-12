// Turning messages from one side into the other's form.
import { cleanText, filterText, hasLink, type Blocklist } from '../chat-filter.ts';
import type { YoutubeChatItem } from './api.ts';
import { timeKey } from './push-id.ts';
import type { StoredChatMessage } from './types.ts';

/** How website messages start on YouTube. The reader also uses it to recognise their echo. */
export const websitePrefix = '[Website] ';
/** YouTube's limit for a chat message. */
export const youtubeMaxLength = 200;

/** `[Website] Bran: Hello everyone!`, cut to fit. Only the display name and the text: no ids, emails or tokens. */
export const formatForYoutube = (name: string, text: string) => {
	const line = `${websitePrefix}${cleanText(name) || 'Listener'}: ${cleanText(text)}`;
	const characters = [...line];
	return characters.length <= youtubeMaxLength ? line : `${characters.slice(0, youtubeMaxLength - 1).join('')}…`;
};

export const isWebsiteEcho = (text: string) => text.startsWith(websitePrefix);

/** The chat's sender id for a YouTube author. Kept to the characters the database and moderation routes accept. */
export const youtubeUid = (channelId: string) => `yt-${channelId.replace(/[^\w-]/g, '').slice(0, 100)}`;

export type NormalizedYoutubeMessage = { key: string; message: StoredChatMessage; publishedAt: number };

/**
 * A YouTube chat item as a website chat message, or null to leave it out: only text messages, and the website's own
 * chat rules apply (severe words drop it, mild ones are masked; links only from the channel owner or its moderators).
 */
export const normalizeYoutubeItem = (item: YoutubeChatItem, blocklist: Blocklist, now: number): NormalizedYoutubeMessage | null => {
	const snippet = item.snippet;
	const author = item.authorDetails;
	if (!item.id || snippet?.type !== 'textMessageEvent') return null;
	const channelId = author?.channelId ?? snippet.authorChannelId;
	if (!channelId) return null;

	const raw = snippet.textMessageDetails?.messageText ?? snippet.displayMessage ?? '';
	const text = [...cleanText(raw)].slice(0, youtubeMaxLength).join('');
	if (!text) return null;
	const trusted = Boolean(author?.isChatOwner || author?.isChatModerator);
	if (!trusted && hasLink(text)) return null;
	const filtered = filterText(text, blocklist);
	if (!filtered.ok) return null;

	const published = Date.parse(snippet.publishedAt ?? '');
	const publishedAt = Number.isFinite(published) ? published : now;
	const message: StoredChatMessage = {
		u: youtubeUid(channelId),
		n: [...cleanText(author?.displayName ?? '')].slice(0, 40).join('') || 'YouTube viewer',
		t: filtered.text,
		ts: publishedAt,
		s: 'yt',
		c: channelId,
	};
	const photo = author?.profileImageUrl;
	if (typeof photo === 'string' && photo.startsWith('https://')) message.p = photo;
	return { key: timeKey(publishedAt, item.id), message, publishedAt };
};
