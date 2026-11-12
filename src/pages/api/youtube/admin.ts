import type { APIRoute } from 'astro';
import { YOUTUBE_DAILY_QUOTA } from 'astro:env/server';
import { ChatError, chatErrorResponse, readJsonBody } from '../../../lib/chat-server';
import { requireLivestreamAccess } from '../../../lib/admin-access';
import { revokeToken } from '../../../lib/youtube/api';
import { decryptSecret } from '../../../lib/youtube/crypto';
import { readSettings } from '../../../lib/youtube/outbox';
import { paths, youtubeRoom } from '../../../lib/youtube/paths';
import { firebaseStore, getEncryptionKey, isYoutubeConfigured, requiredChannelId, youtubeRuntime } from '../../../lib/youtube/runtime';
import type { PublicLiveState, StoredAuth, SyncState } from '../../../lib/youtube/types';

export const prerender = false;

// The YouTube integration's status and switches, for the Livestream panel on /analytics.
//   GET   status. CMS Developer or Digital.
//   POST  { action: 'settings', toYoutube?, fromYoutube? } | { action: 'disconnect' } | { action: 'recheck' }. Developer.
// Tokens and the client secret never appear in a response.

export const GET: APIRoute = async ({ request }) => {
	try {
		const { access } = await requireLivestreamAccess(request, 'view');
		if (!isYoutubeConfigured) return Response.json({ configured: false, access }, { headers: { 'Cache-Control': 'no-store' } });
		youtubeRuntime();
		const [auth, settings, state, live, queue, lease] = await Promise.all([
			firebaseStore.get<StoredAuth>(paths.auth),
			readSettings(firebaseStore),
			firebaseStore.get<SyncState>(paths.state),
			firebaseStore.get<PublicLiveState>(paths.publicLive(youtubeRoom)),
			firebaseStore.get<Record<string, number>>(paths.queue),
			firebaseStore.get<{ until: number }>(paths.lease),
		]);
		return Response.json({
			configured: true,
			access,
			requiredChannelId,
			connection: auth
				? { connected: auth.status === 'ok', status: auth.status, channelId: auth.channelId, channelTitle: auth.channelTitle, connectedAt: auth.connectedAt, connectedBy: access === 'manage' ? auth.connectedBy : undefined }
				: { connected: false, status: 'none' },
			settings,
			sync: {
				active: live?.sync ?? false,
				state: state?.state ?? 'OFFLINE',
				broadcastId: state?.broadcastId ?? null,
				videoId: state?.videoId ?? null,
				liveChatId: state?.liveChatId ?? null,
				title: state?.title ?? null,
				startedAt: state?.startedAt ?? null,
				readerMode: state?.readerMode ?? null,
				updatedAt: state?.updatedAt ?? null,
				lastError: state?.lastError ?? null,
				quota: state?.quota ? { ...state.quota, limit: YOUTUBE_DAILY_QUOTA } : null,
				saver: state?.saver ?? null,
				counts: state?.counts ?? null,
				workerRunning: Boolean(lease && lease.until > Date.now()),
			},
			queue: { pending: Object.keys(queue ?? {}).length, failed: state?.counts?.failed ?? 0 },
			viewers: {
				youtube: live?.youtubeViewers ?? null,
				youtubeAt: live?.youtubeViewersAt ?? null,
				website: live?.websiteViewers ?? null,
				websiteAt: live?.websiteViewersAt ?? null,
			},
		}, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		return chatErrorResponse(error);
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		await requireLivestreamAccess(request, 'manage');
		if (!isYoutubeConfigured) throw new ChatError(503, 'The YouTube integration is not configured on this server.');
		const body = await readJsonBody(request);
		const runtime = youtubeRuntime();

		if (body.action === 'settings') {
			const update: Record<string, boolean> = {};
			for (const name of ['toYoutube', 'fromYoutube', 'autoSaver', 'saver'] as const) {
				if (name in body) {
					if (typeof body[name] !== 'boolean') throw new ChatError(400, `${name} must be true or false.`);
					update[name] = body[name] as boolean;
				}
			}
			if (!Object.keys(update).length) throw new ChatError(400, 'Nothing to change.');
			await firebaseStore.patch(paths.settings, update);
			await runtime?.sync.reconnect();
			return Response.json({ ok: true, settings: await readSettings(firebaseStore) });
		}

		if (body.action === 'disconnect') {
			const auth = await firebaseStore.get<StoredAuth>(paths.auth);
			await firebaseStore.remove(paths.auth);
			if (auth?.refreshToken) {
				try {
					await revokeToken(decryptSecret(auth.refreshToken, getEncryptionKey()));
				} catch {
					// Already invalid, or encrypted with an older key: removing it here is what matters.
				}
			}
			await runtime?.sync.reconnect();
			return Response.json({ ok: true });
		}

		if (body.action === 'recheck') {
			await runtime?.sync.reconnect();
			return Response.json({ ok: true });
		}

		throw new ChatError(400, 'Unknown action.');
	} catch (error) {
		return chatErrorResponse(error);
	}
};
