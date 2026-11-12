// Server only. Who is calling an admin route, and what their CMS role lets them do. Two ways in:
//   - Firebase Google sign-in on this site (`Authorization: Bearer <ID token>`): roles come from the CMS user with the
//     same verified email (oz-cms GET /api/users/staff-roles).
//   - The CMS admin pages (`Authorization: OZAdmin <token>`): a token the CMS signed for its signed-in user
//     (src/lib/admin-token.ts), carrying their roles.
// CMS roles decide everything here (developer: all; digital: look). Chat roles only give chat badges.
import { CMS_SITE_SECRET } from 'astro:env/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { verifyAdminToken } from './admin-token';
import { ChatError, isChatServerConfigured, verifyIdToken } from './chat-server';
import { cmsFetch } from './cms';
import { accessFromRoles, allows, type LivestreamAccess } from './youtube/roles.ts';

export type { LivestreamAccess };

export type AdminIdentity = {
	via: 'firebase' | 'cms';
	/** For records such as "connected by": the Firebase uid, or cms:<email>. */
	id: string;
	email: string | null;
	roles: string[];
	/** The Firebase `analytics` claim (scripts/chat-admin.mjs), for accounts without a CMS role. */
	analyticsClaim: boolean;
};

/** The CMS roles for an email. Cached for 30 seconds by cmsFetch. A failed lookup means no roles. */
export const cmsRolesFor = async (email: string): Promise<string[]> => {
	try {
		const { roles } = await cmsFetch<{ roles?: unknown }>(`users/staff-roles?email=${encodeURIComponent(email.toLowerCase())}`);
		return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
	} catch (error) {
		console.error('[admin] CMS roles lookup failed:', error);
		return [];
	}
};

export const identityFromFirebase = async (user: DecodedIdToken): Promise<AdminIdentity> => {
	const email = user.email && user.email_verified ? user.email.toLowerCase() : null;
	return { via: 'firebase', id: user.uid, email, roles: email ? await cmsRolesFor(email) : [], analyticsClaim: user.analytics === true };
};

/** The caller, or a 401. */
export const adminIdentity = async (request: Request, signInMessage = 'Please sign in.'): Promise<AdminIdentity> => {
	const cmsToken = /^OZAdmin (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
	if (cmsToken) {
		const payload = verifyAdminToken(cmsToken, CMS_SITE_SECRET, 'admin');
		if (!payload) throw new ChatError(401, 'The CMS session has expired. Reload the page in the CMS.');
		return { via: 'cms', id: `cms:${payload.email}`, email: payload.email, roles: payload.roles, analyticsClaim: false };
	}
	if (!isChatServerConfigured) throw new ChatError(503, 'Sign-in is not set up on this server.');
	return identityFromFirebase(await verifyIdToken(request, signInMessage));
};

/** For the YouTube integration and live chat administration: Developer manages, Digital looks. */
export const requireLivestreamAccess = async (request: Request, needed: LivestreamAccess) => {
	const identity = await adminIdentity(request);
	const access = accessFromRoles(identity.roles);
	if (!access) throw new ChatError(403, 'This account has no Developer or Digital role in the CMS.');
	if (!allows(access, needed)) throw new ChatError(403, 'Only CMS developers can change this.');
	return { identity, access };
};

/** The private analytics: CMS Developer or Digital, or the older `analytics` claim. */
export const canSeeAnalytics = (identity: AdminIdentity) => identity.analyticsClaim || accessFromRoles(identity.roles) !== null;
