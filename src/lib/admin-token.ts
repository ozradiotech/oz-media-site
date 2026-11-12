// Tokens the CMS (oz-cms src/siteBridge.ts) signs so its admin pages can use this site's admin routes on behalf of a
// signed-in CMS user. HMAC-SHA256 with CMS_SITE_SECRET, which both apps share; the site only verifies. Pure, so it is
// tested on its own (tests/admin/admin-token.test.ts).
//
//   v1.<base64url JSON payload>.<base64url signature>
import { createHmac, timingSafeEqual } from 'node:crypto';

export type AdminTokenPurpose =
	/** Calls to the admin routes, and the analytics page embedded in the CMS. */
	| 'admin'
	/** Starting the YouTube connection from the CMS: one browser redirect. */
	| 'connect';

export type AdminTokenPayload = {
	/** The CMS user's email (their Google account for the site, by convention). */
	email: string;
	/** Their CMS roles: developer, digital, editorial. */
	roles: string[];
	purpose: AdminTokenPurpose;
	/** Expiry, ms since the epoch. */
	exp: number;
	/** 'connect' only: where to send the browser back to afterwards (a CMS admin page). */
	returnTo?: string;
};

const signature = (body: string, secret: string) => createHmac('sha256', secret).update(`v1.${body}`).digest('base64url');

export const signAdminToken = (payload: AdminTokenPayload, secret: string) => {
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `v1.${body}.${signature(body, secret)}`;
};

/** The payload if the token is genuine, unexpired and for `purpose`; otherwise null. */
export const verifyAdminToken = (token: string, secret: string | undefined, purpose: AdminTokenPurpose, now = Date.now()): AdminTokenPayload | null => {
	if (!secret || secret.length < 32) return null;
	const [version, body, sent] = token.split('.');
	if (version !== 'v1' || !body || !sent) return null;
	const expected = Buffer.from(signature(body, secret));
	const given = Buffer.from(sent);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	let payload: AdminTokenPayload;
	try {
		payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	if (payload.purpose !== purpose || typeof payload.exp !== 'number' || payload.exp < now) return null;
	if (typeof payload.email !== 'string' || !Array.isArray(payload.roles)) return null;
	return { ...payload, email: payload.email.toLowerCase(), roles: payload.roles.filter((role) => typeof role === 'string') };
};

/** A return address is only followed if it is an http(s) admin page: never javascript: or the like. */
export const safeReturnTo = (value: unknown) => {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		return (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname.startsWith('/admin') ? url.toString() : null;
	} catch {
		return null;
	}
};
