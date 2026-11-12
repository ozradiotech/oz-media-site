import type { APIRoute } from 'astro';
import { YOUTUBE_DAILY_QUOTA } from 'astro:env/server';
import { ChatError, chatErrorResponse, readJsonBody } from '../../../lib/chat-server';
import { requireCapability } from '../../../lib/admin-access';
import { accessLabel, type Capability } from '../../../lib/youtube/roles';
import { revokeToken } from '../../../lib/youtube/api';
import { decryptSecret } from '../../../lib/youtube/crypto';
import { readSettings } from '../../../lib/youtube/outbox';
import { paths, youtubeRoom } from '../../../lib/youtube/paths';
import { firebaseStore, getEncryptionKey, isYoutubeConfigured, requiredChannelId, youtubeRuntime } from '../../../lib/youtube/runtime';
import type { PublicLiveState, StoredAuth, SyncState } from '../../../lib/youtube/types';

export const prerender = false;

// The YouTube integration's status and switches, for the CMS's Broadcast → YouTube and Live chat → YouTube chat sync
// pages and the Livestream panel on /analytics. Who may do what comes from their CMS roles (src/lib/admin-access.ts):
//   GET   status: whoever can see either page
//   POST  { action: 'settings', toYoutube?, fromYoutube? }   manage YouTube chat sync
//         { action: 'settings', autoSaver?, saver? }         manage YouTube (the quota saver)
//         { action: 'disconnect' } | { action: 'recheck' }   manage YouTube
// Tokens and the client secret never appear in a response.

export const GET: APIRoute = async ({ request }) => {
	try {
		const identity = await requireCapability(request, ['youtube', 'chatSync'], 'view');
		// The Livestream panel on /analytics shows the YouTube page's controls, so it goes by that page.
		const access = accessLabel(identity.capabilities.youtube) ?? 'view';
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
		const body = await readJsonBody(request);
		// Which page's permission this needs: the two directions belong to YouTube chat sync, the rest to YouTube.
		const syncSwitch = body.action === 'settings' && ('toYoutube' in body || 'fromYoutube' in body);
		const saverSwitch = body.action === 'settings' && ('autoSaver' in body || 'saver' in body);
		const needs: Capability[] = syncSwitch && saverSwitch ? ['chatSync', 'youtube'] : syncSwitch ? ['chatSync'] : ['youtube'];
		for (const area of needs) await requireCapability(request, [area], 'edit');
		if (!isYoutubeConfigured) throw new ChatError(503, 'The YouTube integration is not configured on this server.');
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
			// A switch is no reason to spend quota on looking for unlisted broadcasts.
			await runtime?.sync.reconnect(false);
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
