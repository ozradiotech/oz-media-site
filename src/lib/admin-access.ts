// Server only. Who is calling an admin route, and what their CMS roles let them do. Two ways in:
//   - Firebase Google sign-in on this site (`Authorization: Bearer <ID token>`): what the CMS user with the same verified
//     email may do (oz-cms GET /api/users/staff-roles).
//   - The CMS admin pages (`Authorization: OZAdmin <token>`): a token the CMS signed for its signed-in user
//     (src/lib/admin-token.ts), carrying the same.
// The CMS works out each person's capabilities from their built-in and custom roles (src/lib/youtube/roles.ts). Chat
// roles only give chat badges.
import { CMS_SITE_SECRET } from 'astro:env/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { verifyAdminToken } from './admin-token';
import { ChatError, isChatServerConfigured, verifyIdToken } from './chat-server';
import { cmsFetch } from './cms';
import { allows, capabilitiesFrom, noCapabilities, type Capabilities, type Capability } from './youtube/roles.ts';

export type AdminIdentity = {
	via: 'firebase' | 'cms';
	/** For records such as "connected by": the Firebase uid, or cms:<email>. */
	id: string;
	email: string | null;
	roles: string[];
	capabilities: Capabilities;
	/** The Firebase `analytics` claim (scripts/chat-admin.mjs), for accounts without a CMS role. */
	analyticsClaim: boolean;
};

/** What the CMS user with this email may do. Cached for 30 seconds by cmsFetch. A failed lookup means nothing. */
export const cmsAccessFor = async (email: string): Promise<{ roles: string[]; capabilities: Capabilities }> => {
	try {
		const result = await cmsFetch<{ roles?: unknown; capabilities?: unknown }>(`users/staff-roles?email=${encodeURIComponent(email.toLowerCase())}`);
		const roles = Array.isArray(result.roles) ? result.roles.filter((role): role is string => typeof role === 'string') : [];
		return { roles, capabilities: capabilitiesFrom(result.capabilities, roles) };
	} catch (error) {
		console.error('[admin] CMS roles lookup failed:', error);
		return { roles: [], capabilities: noCapabilities };
	}
};

export const identityFromFirebase = async (user: DecodedIdToken): Promise<AdminIdentity> => {
	const email = user.email && user.email_verified ? user.email.toLowerCase() : null;
	const access = email ? await cmsAccessFor(email) : { roles: [], capabilities: noCapabilities };
	return { via: 'firebase', id: user.uid, email, ...access, analyticsClaim: user.analytics === true };
};

/** The caller, or a 401. */
export const adminIdentity = async (request: Request, signInMessage = 'Please sign in.'): Promise<AdminIdentity> => {
	const cmsToken = /^OZAdmin (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
	if (cmsToken) {
		const payload = verifyAdminToken(cmsToken, CMS_SITE_SECRET, 'admin');
		if (!payload) throw new ChatError(401, 'The CMS session has expired. Reload the page in the CMS.');
		return {
			via: 'cms',
			id: `cms:${payload.email}`,
			email: payload.email,
			roles: payload.roles,
			capabilities: capabilitiesFrom(payload.capabilities, payload.roles),
			analyticsClaim: false,
		};
	}
	if (!isChatServerConfigured) throw new ChatError(503, 'Sign-in is not set up on this server.');
	return identityFromFirebase(await verifyIdToken(request, signInMessage));
};

/**
 * The caller, if their roles allow `needed` on at least one of `areas` (e.g. the YouTube status is for the YouTube and
 * the YouTube chat sync pages alike); otherwise a 403.
 */
export const requireCapability = async (request: Request, areas: Capability[], needed: 'view' | 'edit') => {
	const identity = await adminIdentity(request);
	if (!areas.some((area) => allows(identity.capabilities[area], 'view'))) {
		throw new ChatError(403, 'Your CMS roles don’t include this.');
	}
	if (!areas.some((area) => allows(identity.capabilities[area], needed))) {
		throw new ChatError(403, 'Your CMS roles let you see this, not change it.');
	}
	return identity;
};

/** The private analytics: Analytics in the CMS roles (Developer, Digital, or a custom role), or the older claim. */
export const canSeeAnalytics = (identity: AdminIdentity) => identity.analyticsClaim || allows(identity.capabilities.analytics, 'view');
