// Server only. The private analytics routes (/api/analytics/*) answer only Google accounts with the analytics role,
// granted with `node --env-file=.env scripts/chat-admin.mjs analytics <email>`.
import { ChatError, isChatServerConfigured, verifyIdToken } from './chat-server';

export const requireAnalyticsUser = async (request: Request) => {
	if (!isChatServerConfigured) throw new ChatError(503, 'Analytics sign-in is not set up on this server.');
	const user = await verifyIdToken(request, 'Please sign in to see the analytics.');
	if (user.analytics !== true) throw new ChatError(403, 'This Google account does not have access to the analytics.');
	return user;
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
