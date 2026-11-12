import type { APIRoute } from 'astro';
import { chatErrorResponse, ChatError } from '../../../lib/chat-server';
import { requireLivestreamAccess } from '../../../lib/youtube/access';
import { authorizationUrl } from '../../../lib/youtube/api';
import { hashKey, randomToken } from '../../../lib/youtube/crypto';
import { paths } from '../../../lib/youtube/paths';
import { firebaseStore, isYoutubeConfigured, oauthConfig, oauthCookie, oauthStateLifetime } from '../../../lib/youtube/runtime';

export const prerender = false;

// Step 1 of connecting the OZ channel (CMS developers only). Answers with Google's consent page address; the browser
// goes there and Google sends it back to /api/youtube/callback. The state is kept twice, in the database (single use,
// ten minutes) and in an httpOnly cookie on this browser, and the callback needs both to match: a link someone else
// started can't complete here.
export const POST: APIRoute = async ({ request, cookies }) => {
	try {
		if (!isYoutubeConfigured) throw new ChatError(503, 'The YouTube integration is not configured on this server.');
		const { user } = await requireLivestreamAccess(request, 'manage');
		const state = randomToken();
		await firebaseStore.put(`${paths.oauthStates}/${hashKey(state)}`, {
			uid: user.uid,
			email: user.email ?? null,
			expiresAt: Date.now() + oauthStateLifetime,
		});
		cookies.set(oauthCookie, state, {
			httpOnly: true,
			secure: import.meta.env.PROD,
			sameSite: 'lax',
			path: '/api/youtube',
			maxAge: oauthStateLifetime / 1000,
		});
		return Response.json({ url: authorizationUrl(oauthConfig(), state) });
	} catch (error) {
		return chatErrorResponse(error);
	}
};
