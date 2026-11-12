import type { APIRoute } from 'astro';
import { createYoutubeApi, exchangeCode, revokeToken, youtubeScopes } from '../../../lib/youtube/api';
import { decryptSecret, encryptSecret, hashKey, safeEqual } from '../../../lib/youtube/crypto';
import { paths } from '../../../lib/youtube/paths';
import { firebaseStore, getEncryptionKey, isYoutubeConfigured, oauthConfig, oauthCookie, requiredChannelId, youtubeRuntime } from '../../../lib/youtube/runtime';
import type { StoredAuth } from '../../../lib/youtube/types';
import { safeReturnTo } from '../../../lib/admin-token';

export const prerender = false;

// Step 2: Google sends the admin back here with a one-time code. The code is exchanged on the server; the refresh
// token is encrypted and stored, and neither it nor the client secret ever reaches a browser.
// Back to where the connection was started: the CMS admin's YouTube page, or /analytics on this site.
const backTo = (returnTo: string | null, result: string) => new Response(null, {
	status: 303,
	headers: {
		Location: returnTo
			? `${returnTo}${returnTo.includes('?') ? '&' : '?'}youtube=${encodeURIComponent(result)}`
			: `/analytics?youtube=${encodeURIComponent(result)}#livestream-title`,
	},
});

export const GET: APIRoute = async ({ url, cookies }) => {
	let returnTo: string | null = null;
	const back = (result: string) => backTo(returnTo, result);
	if (!isYoutubeConfigured) return back('not_configured');
	const state = url.searchParams.get('state') ?? '';
	const cookieState = cookies.get(oauthCookie)?.value ?? '';
	cookies.delete(oauthCookie, { path: '/api/youtube' });

	// CSRF: the state must match this browser's cookie and an unexpired, unused record.
	if (!state || !cookieState || !safeEqual(state, cookieState)) return back('state_mismatch');
	const recordPath = `${paths.oauthStates}/${hashKey(state)}`;
	const record = await firebaseStore.get<{ uid: string; email: string | null; returnTo?: string | null; expiresAt: number }>(recordPath).catch(() => null);
	await firebaseStore.remove(recordPath).catch(() => undefined);
	returnTo = safeReturnTo(record?.returnTo);
	if (!record || record.expiresAt < Date.now()) return back('state_expired');

	const googleError = url.searchParams.get('error');
	if (googleError) return back(googleError === 'access_denied' ? 'cancelled' : 'google_error');
	const code = url.searchParams.get('code');
	if (!code) return back('no_code');

	try {
		const config = oauthConfig();
		const tokens = await exchangeCode(config, code);
		const granted = (tokens.scope ?? '').split(' ');
		if (!youtubeScopes.every((scope) => granted.includes(scope))) {
			await revokeToken(tokens.access_token);
			return back('scope_missing');
		}
		if (!tokens.refresh_token) return back('no_refresh_token');

		const api = createYoutubeApi({ accessToken: async () => tokens.access_token });
		const channel = await api.myChannel();
		if (!channel) {
			await revokeToken(tokens.refresh_token);
			return back('no_channel');
		}
		if (requiredChannelId && channel.id !== requiredChannelId) {
			await revokeToken(tokens.refresh_token);
			return back('wrong_channel');
		}

		const key = getEncryptionKey();
		const previous = await firebaseStore.get<StoredAuth>(paths.auth).catch(() => null);
		const auth: StoredAuth = {
			refreshToken: encryptSecret(tokens.refresh_token, key),
			channelId: channel.id,
			channelTitle: channel.title,
			scope: tokens.scope ?? '',
			connectedAt: Date.now(),
			connectedBy: record.email ?? record.uid,
			status: 'ok',
		};
		await firebaseStore.put(paths.auth, auth);
		// The old grant is no longer used: let Google drop it.
		if (previous?.refreshToken) {
			try {
				await revokeToken(decryptSecret(previous.refreshToken, key));
			} catch {
				// Unreadable (key changed): nothing to revoke from here.
			}
		}
		await youtubeRuntime()?.sync.reconnect();
		return back('connected');
	} catch (error) {
		console.error('[youtube] Connecting the channel failed:', error);
		return back('failed');
	}
};
