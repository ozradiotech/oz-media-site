import type { APIContext, APIRoute } from 'astro';
import { CMS_SITE_SECRET } from 'astro:env/server';
import { requireLivestreamAccess } from '../../../lib/admin-access';
import { safeReturnTo, verifyAdminToken } from '../../../lib/admin-token';
import { chatErrorResponse, ChatError } from '../../../lib/chat-server';
import { authorizationUrl } from '../../../lib/youtube/api';
import { hashKey, randomToken } from '../../../lib/youtube/crypto';
import { paths } from '../../../lib/youtube/paths';
import { accessFromRoles } from '../../../lib/youtube/roles';
import { firebaseStore, isYoutubeConfigured, oauthConfig, oauthCookie, oauthStateLifetime } from '../../../lib/youtube/runtime';

export const prerender = false;

// Step 1 of connecting the OZ channel (CMS developers only). Google then sends the browser to /api/youtube/callback.
// The state is kept twice, in the database (single use, ten minutes) and in an httpOnly cookie on this browser, and the
// callback needs both to match: a link someone else started can't complete here.
//   POST          from /analytics on this site (Google sign-in): answers with Google's consent page address.
//   GET ?token=   from the CMS admin's YouTube page: a CMS-signed token for this one redirect. Goes to Google directly;
//                 the callback sends the browser back to the CMS page.
const begin = async (cookies: APIContext['cookies'], who: { id: string; email: string | null }, returnTo: string | null) => {
	const state = randomToken();
	await firebaseStore.put(`${paths.oauthStates}/${hashKey(state)}`, {
		uid: who.id,
		email: who.email,
		returnTo,
		expiresAt: Date.now() + oauthStateLifetime,
	});
	cookies.set(oauthCookie, state, {
		httpOnly: true,
		secure: import.meta.env.PROD,
		sameSite: 'lax',
		path: '/api/youtube',
		maxAge: oauthStateLifetime / 1000,
	});
	return authorizationUrl(oauthConfig(), state);
};

export const POST: APIRoute = async ({ request, cookies }) => {
	try {
		if (!isYoutubeConfigured) throw new ChatError(503, 'The YouTube integration is not configured on this server.');
		const { identity } = await requireLivestreamAccess(request, 'manage');
		return Response.json({ url: await begin(cookies, identity, null) });
	} catch (error) {
		return chatErrorResponse(error);
	}
};

export const GET: APIRoute = async ({ url, cookies }) => {
	const payload = verifyAdminToken(url.searchParams.get('token') ?? '', CMS_SITE_SECRET, 'connect');
	const returnTo = safeReturnTo(payload?.returnTo);
	const fail = (reason: string) => new Response(null, {
		status: 303,
		headers: { Location: returnTo ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}youtube=${reason}` : `/analytics?youtube=${reason}` },
	});
	if (!payload) return fail('link_expired');
	if (accessFromRoles(payload.roles) !== 'manage') return fail('not_allowed');
	if (!isYoutubeConfigured) return fail('not_configured');
	try {
		return new Response(null, { status: 303, headers: { Location: await begin(cookies, { id: `cms:${payload.email}`, email: payload.email }, returnTo) } });
	} catch (error) {
		console.error('[youtube] Starting the connection failed:', error);
		return fail('failed');
	}
};
