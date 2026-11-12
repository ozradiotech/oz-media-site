// Server only. Who may see and run the YouTube integration: decided by the person's role in the CMS (oz-cms Users),
// matched on the verified Google email they sign in to the site with. Developer: everything. Digital: look only.
// Chat roles are for chat badges and moderation, and play no part here.
import type { DecodedIdToken } from 'firebase-admin/auth';
import { ChatError, isChatServerConfigured, verifyIdToken } from '../chat-server';
import { cmsFetch } from '../cms';
import { accessFromRoles, allows, type LivestreamAccess } from './roles.ts';

export type { LivestreamAccess };

/** The CMS roles for an email (oz-cms `GET /api/users/staff-roles`, website key only). Cached for 30 seconds. */
const cmsRoles = async (email: string) => {
	const { roles } = await cmsFetch<{ roles?: unknown }>(`users/staff-roles?email=${encodeURIComponent(email.toLowerCase())}`);
	return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
};

export const livestreamAccessFor = async (user: DecodedIdToken): Promise<LivestreamAccess | null> => {
	if (!user.email || !user.email_verified) return null;
	const roles: string[] = await cmsRoles(user.email).catch((error) => {
		console.error('[youtube] CMS roles lookup failed:', error);
		return [] as string[];
	});
	return accessFromRoles(roles);
};

/** The signed-in user and their access, or a 401/403. */
export const requireLivestreamAccess = async (request: Request, needed: LivestreamAccess) => {
	if (!isChatServerConfigured) throw new ChatError(503, 'Sign-in is not set up on this server.');
	const user = await verifyIdToken(request, 'Please sign in.');
	const access = await livestreamAccessFor(user);
	if (!access) throw new ChatError(403, 'This Google account has no Developer or Digital role in the CMS.');
	if (!allows(access, needed)) throw new ChatError(403, 'Only CMS developers can change the YouTube integration.');
	return { user, access };
};
