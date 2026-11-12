// Server only. The private analytics routes (/api/analytics/*) answer CMS Developer and Digital users, signed in with
// Google here or through the CMS admin's Analytics page (src/lib/admin-access.ts), and Google accounts given the older
// analytics claim with `node --env-file=.env scripts/chat-admin.mjs analytics <email>`.
import { adminIdentity, canSeeAnalytics } from './admin-access';
import { ChatError } from './chat-server';

export const requireAnalyticsUser = async (request: Request) => {
	const identity = await adminIdentity(request, 'Please sign in to see the analytics.');
	if (!canSeeAnalytics(identity)) throw new ChatError(403, 'This account does not have access to the analytics (CMS Developer or Digital).');
	return identity;
};

const isDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
// Dates on the dashboard are the station's (Asia/Jakarta, UTC+7), not the server's.
const jakartaDayStart = (date: string) => Date.parse(`${date}T00:00:00+07:00`);

/** The `from` and `to` query parameters (YYYY-MM-DD, Jakarta dates, both inclusive and optional) as a time range. */
export const dateRange = (url: URL) => {
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	return {
		start: isDate(from) ? jakartaDayStart(from) : -Infinity,
		end: isDate(to) ? jakartaDayStart(to) + 86_400_000 : Infinity,
	};
};
