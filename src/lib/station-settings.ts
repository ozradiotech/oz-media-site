// Server only. OZ Bandung's page settings from the CMS (Station settings), over the built-in defaults
// (src/lib/station-defaults.ts). Cached for 30 seconds like the rest of the CMS content; if the CMS can't be reached
// the page uses the defaults rather than failing.
import { cmsFetch } from './cms';
import { mergeStationSettings, type CmsStationSettings } from './station-defaults';

export const getStationSettings = async () => {
	const cms = await cmsFetch<CmsStationSettings>('globals/station-settings?depth=0').catch((error) => {
		console.error('[station settings]', error);
		return null;
	});
	return mergeStationSettings(cms);
};
