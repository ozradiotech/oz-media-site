// Server only. OZ Bandung's page settings from the CMS (Broadcast → Streams, Digital → Socials, Content → OZ Bandung
// page), over the built-in values (src/lib/station-defaults.ts). Cached for 30 seconds like the rest of the CMS content;
// a global that can't be read uses the built-in values rather than breaking the page.
import { cmsFetch } from './cms';
import { mergeStationSettings, type CmsStationSettings } from './station-defaults';

const read = <K extends keyof CmsStationSettings>(slug: string) =>
	cmsFetch<NonNullable<CmsStationSettings[K]>>(`globals/${slug}?depth=0`).catch((error) => {
		console.error(`[settings] ${slug}:`, error);
		return null;
	});

export const getStationSettings = async () => {
	const [streams, socials, page] = await Promise.all([
		read<'streams'>('streams'),
		read<'socials'>('socials'),
		read<'page'>('oz-bandung-page'),
	]);
	return mergeStationSettings({ streams, socials, page });
};
