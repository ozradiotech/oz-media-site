import type { APIRoute } from 'astro';
import { activityIcs, activityPath, getActivities } from '../../../lib/activities';

// "Add to calendar" on an activity page: an .ics file that Apple Calendar, Outlook and others open as an event.
export const prerender = false;

export const GET: APIRoute = async ({ params, site, url }) => {
	const entry = (await getActivities()).find((other) => other.id === params.slug);
	const pageUrl = entry ? new URL(activityPath(entry), site ?? url).href : '';
	const body = entry ? activityIcs(entry, pageUrl, (site ?? url).hostname) : '';
	if (!body) return new Response('No date for this activity yet', { status: 404 });
	return new Response(body, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': `attachment; filename="${entry!.id}.ics"`,
		},
	});
};
