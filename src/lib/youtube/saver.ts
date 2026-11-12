// The quota saver: how hard the sync economises, from the day's quota use and the two switches on the CMS's
// Broadcast → YouTube page (settings `autoSaver` and `saver`). Pure, so it is tested on its own.
//
//   0  normal   bundles website messages that arrive together; free broadcast detection
//   1  saving   bundles over a longer wait, the YouTube viewer count every 3 minutes, full API checks less often
//   2  strict   as 1, and only moderators' website messages go to YouTube (the rest stay on the website)

export type SaverLevel = 0 | 1 | 2;
export type SaverReason = 'off' | 'manual' | 'auto';

/** Automatic levels by the share of the day's quota already used. */
export const autoThresholds = { saving: 0.5, strict: 0.8 } as const;

export const saverLevel = (input: { used: number; limit: number; auto: boolean; manual: boolean }): { level: SaverLevel; reason: SaverReason } => {
	const share = input.limit > 0 ? input.used / input.limit : 1;
	const auto: SaverLevel = !input.auto ? 0 : share >= autoThresholds.strict ? 2 : share >= autoThresholds.saving ? 1 : 0;
	const manual: SaverLevel = input.manual ? 1 : 0;
	const level = Math.max(auto, manual) as SaverLevel;
	return { level, reason: level === 0 ? 'off' : auto >= manual ? 'auto' : 'manual' };
};

export type SaverTuning = {
	/** How long the oldest waiting website message waits for others to join its bundle. */
	bundleWindowMs: number;
	/** How often a live broadcast is checked (its viewer count and whether it ended): this many times the base. */
	followFactor: number;
	/** While offline, how often the API is asked as well as the free page (it also sees unlisted broadcasts). */
	fullCheckMs: number;
	/** Only moderators' website messages are posted. */
	moderatorsOnly: boolean;
};

export const saverTuning = (level: SaverLevel): SaverTuning => ({
	bundleWindowMs: level === 0 ? 2_000 : 6_000,
	followFactor: level === 0 ? 1 : 3,
	fullCheckMs: level === 0 ? 15 * 60_000 : 30 * 60_000,
	moderatorsOnly: level === 2,
});
