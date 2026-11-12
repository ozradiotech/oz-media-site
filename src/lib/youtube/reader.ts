// YouTube → website. Each page of chat from YouTube is checked and copied into the room, where the page's existing
// realtime listener shows it. The site's own forwarded messages come back in the same pages and are left out.
import type { Blocklist } from '../chat-filter.ts';
import type { ChatPage } from './api.ts';
import { hashKey } from './crypto.ts';
import { isWebsiteEcho, normalizeYoutubeItem } from './normalize.ts';
import { reconcileEcho, type OutboxContext } from './outbox.ts';
import { paths } from './paths.ts';
import type { Clock, Store } from './types.ts';

export type ReaderContext = {
	store: Store;
	clock: Clock;
	room: string;
	/** The connected channel: messages from it are the only ones that can be our own echo. */
	ownChannelId: string | null;
	blocklist(): Promise<Blocklist>;
	fromYoutube(): boolean;
	outbox: OutboxContext;
	/** Keys already copied in by this process, so most messages need no database check. Bounded by the caller. */
	imported: Set<string>;
	counts: { imported: number };
	/** On the first page after connecting, older messages than this are history and skipped. */
	backlogMs: number;
};

type Restriction = { at: number; blocked: boolean };
const restrictions = new Map<string, Restriction>();

/** Banned on the website, or muted: their YouTube messages don't show here either. Cached for 30 seconds. */
const isRestricted = async (ctx: ReaderContext, uid: string) => {
	const now = ctx.clock.now();
	const hit = restrictions.get(uid);
	if (hit && now - hit.at < 30_000) return hit.blocked;
	const [ban, mutedUntil] = await Promise.all([
		ctx.store.get(`${paths.bans}/${uid}`),
		ctx.store.get<number>(`${paths.users}/${uid}/mutedUntil`),
	]);
	const blocked = Boolean(ban) || (typeof mutedUntil === 'number' && mutedUntil > now);
	restrictions.set(uid, { at: now, blocked });
	return blocked;
};

export const clearRestrictionCache = () => restrictions.clear();

export type PageResult = { imported: number; skippedEcho: number; skipped: number };

export const handlePage = async (ctx: ReaderContext, page: ChatPage, initial: boolean): Promise<PageResult> => {
	const result: PageResult = { imported: 0, skippedEcho: 0, skipped: 0 };
	const now = ctx.clock.now();
	const blocklist = await ctx.blocklist();
	const writes: Record<string, unknown> = {};
	const newKeys: string[] = [];

	for (const item of page.items) {
		const authorChannel = item.authorDetails?.channelId ?? item.snippet?.authorChannelId;
		const text = item.snippet?.textMessageDetails?.messageText ?? item.snippet?.displayMessage ?? '';

		// Our own messages: anything the site posted (by id), or that carries the website prefix (a send whose answer
		// was lost). Messages the channel owner types on YouTube itself have no prefix and are copied like any other.
		if (ctx.ownChannelId && authorChannel === ctx.ownChannelId) {
			const hashed = hashKey(item.id);
			const known = ctx.outbox.sentIds.has(hashed) || Boolean(await ctx.store.get(`${paths.sent}/${hashed}`));
			if (known || isWebsiteEcho(text)) {
				if (!known) await reconcileEcho(ctx.outbox, item.id, text);
				result.skippedEcho++;
				continue;
			}
		}
		if (!ctx.fromYoutube()) {
			result.skipped++;
			continue;
		}

		const normalized = normalizeYoutubeItem(item, blocklist, now);
		if (!normalized || (initial && normalized.publishedAt < now - ctx.backlogMs)) {
			result.skipped++;
			continue;
		}
		const { key, message } = normalized;
		if (ctx.imported.has(key) || writes[`${paths.messages(ctx.room)}/${key}`]) {
			result.skipped++;
			continue;
		}
		// Copied before (and maybe deleted by a moderator since): never again.
		if (await ctx.store.get(`${paths.imported}/${key}`)) {
			ctx.imported.add(key);
			result.skipped++;
			continue;
		}
		if (await isRestricted(ctx, message.u)) {
			result.skipped++;
			continue;
		}
		writes[`${paths.messages(ctx.room)}/${key}`] = message;
		writes[`${paths.imported}/${key}`] = message.ts;
		newKeys.push(key);
		result.imported++;
	}

	if (Object.keys(writes).length) {
		await ctx.store.patch('', writes);
		for (const key of newKeys) ctx.imported.add(key);
		ctx.counts.imported += result.imported;
	}
	return result;
};
