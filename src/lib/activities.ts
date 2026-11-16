import { getLiveCollection, type LiveDataEntry } from 'astro:content';
import type { ActivityData } from '../live.config';

// On ground activity lives under OZ Bandung, like OZ News: /oz-bandung/activities lists every event, upcoming and
// past, and /oz-bandung/activities/<slug> shows one with its photo carousel.
export type ActivityEntry = LiveDataEntry<ActivityData>;

/** Published activities in the order set in the CMS. A CMS outage leaves the list empty rather than breaking the page. */
export const getActivities = async () => {
	const { entries, error } = await getLiveCollection('activities');
	if (error) console.error('[activities]', error);
	return (entries ?? []) as ActivityEntry[];
};

export const activitiesIndexPath = '/oz-bandung/activities';
export const activityPath = (entry: ActivityEntry) => `${activitiesIndexPath}/${entry.id}`;

/** The masthead label on these pages (see NewsLayout). */
export const activitiesSection = { name: 'On Ground', accent: 'Activity', href: activitiesIndexPath };
