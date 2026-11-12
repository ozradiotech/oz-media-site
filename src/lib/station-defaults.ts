// OZ Bandung's page settings: the built-in values, and how the CMS's "Station settings" (oz-cms
// src/globals/StationSettings.ts) override them. Pure, so it is tested on its own (tests/admin/station-settings.test.ts).
// Anything left empty in the CMS, or a CMS that can't be reached, falls back to these.

export type StationSettings = {
	audioStreamUrl: string;
	/** channelId: plays whatever the channel streams (looked up by /api/youtube-live). videoId: always that broadcast. */
	youtubeLive: { channelId: string; videoId: string };
	youtubeChannelUrl: string;
	youtubeVideos: { id: string; title: string }[];
	instagramUrl: string;
	tiktokUrl: string;
	threadsUrl: string;
	contactEmail: string;
	/** As shown, e.g. +62 851-1139-1031; the wa.me link is made from its digits. */
	whatsappNumber: string;
	/** `{hours}` is replaced with the Ozubathon's hours. */
	tickerPhrases: string[];
	/** Ozubathon, the anniversary marathon (night style only): start drives the countdown; dateLabel is what's printed. */
	ozubathon: { start: string; hours: number; dateLabel: string };
};

export const defaultStationSettings: StationSettings = {
	audioStreamUrl: 'https://streaming.ozradio.id:8443/ozbandung',
	youtubeLive: { channelId: 'UCdc4ztl0di-Fv58CI5TK73w', videoId: '' },
	youtubeChannelUrl: 'https://www.youtube.com/@OZMEDIANET',
	youtubeVideos: [
		{ id: 'UDmfDJTzg4w', title: 'Featured video' },
		{ id: 'dn73m2_u71E', title: 'Studio session' },
		{ id: 'ZStRwkoiTQY', title: 'Live set' },
	],
	instagramUrl: 'https://www.instagram.com/ozradiobandung',
	tiktokUrl: 'https://www.tiktok.com/@ozradio',
	threadsUrl: 'https://www.threads.net/@ozradiobandung',
	contactEmail: 'ozmedianet.id@gmail.com',
	whatsappNumber: '+62 851-1139-1031',
	tickerPhrases: ['55 LOUD AND LIVE', 'OZUBATHON', '{hours} HOURS NONSTOP', 'OZ RADIO BANDUNG ANNIVERSARY'],
	ozubathon: { start: '2026-12-23T19:00:00+07:00', hours: 55, dateLabel: '23 DECEMBER 2026' },
};

/** The global as the CMS REST API returns it (every field optional, nulls for empty). */
export type CmsStationSettings = {
	audioStreamUrl?: string | null;
	youtube?: {
		liveChannelId?: string | null;
		liveVideoId?: string | null;
		channelUrl?: string | null;
		videos?: { videoId?: string | null; title?: string | null }[] | null;
	} | null;
	social?: { instagramUrl?: string | null; tiktokUrl?: string | null; threadsUrl?: string | null } | null;
	contact?: { email?: string | null; whatsappNumber?: string | null } | null;
	ticker?: { phrase?: string | null }[] | null;
	ozubathon?: { start?: string | null; hours?: number | null; dateLabel?: string | null } | null;
};

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);

export const mergeStationSettings = (cms: CmsStationSettings | null | undefined, defaults = defaultStationSettings): StationSettings => {
	if (!cms) return defaults;
	const videos = (cms.youtube?.videos ?? [])
		.map((video) => ({ id: text(video?.videoId, ''), title: text(video?.title, 'YouTube video') }))
		.filter((video) => /^[\w-]{11}$/.test(video.id));
	const phrases = (cms.ticker ?? []).map((item) => text(item?.phrase, '')).filter(Boolean);
	const hours = cms.ozubathon?.hours;
	const start = cms.ozubathon?.start && Number.isFinite(Date.parse(cms.ozubathon.start)) ? cms.ozubathon.start : defaults.ozubathon.start;
	// A pinned video wins over the channel; the channel is only replaced when one is given.
	const videoId = text(cms.youtube?.liveVideoId, '');
	return {
		audioStreamUrl: text(cms.audioStreamUrl, defaults.audioStreamUrl),
		youtubeLive: {
			channelId: /^UC[\w-]{22}$/.test(text(cms.youtube?.liveChannelId, '')) ? text(cms.youtube?.liveChannelId, '') : defaults.youtubeLive.channelId,
			videoId: /^[\w-]{11}$/.test(videoId) ? videoId : '',
		},
		youtubeChannelUrl: text(cms.youtube?.channelUrl, defaults.youtubeChannelUrl),
		youtubeVideos: videos.length ? videos : defaults.youtubeVideos,
		instagramUrl: text(cms.social?.instagramUrl, defaults.instagramUrl),
		tiktokUrl: text(cms.social?.tiktokUrl, defaults.tiktokUrl),
		threadsUrl: text(cms.social?.threadsUrl, defaults.threadsUrl),
		contactEmail: text(cms.contact?.email, defaults.contactEmail),
		whatsappNumber: text(cms.contact?.whatsappNumber, defaults.whatsappNumber),
		tickerPhrases: phrases.length ? phrases : defaults.tickerPhrases,
		ozubathon: {
			start,
			hours: typeof hours === 'number' && hours > 0 ? hours : defaults.ozubathon.hours,
			dateLabel: text(cms.ozubathon?.dateLabel, defaults.ozubathon.dateLabel),
		},
	};
};

/** https://wa.me/<digits> for a number written any way. */
export const whatsappLink = (number: string) => `https://wa.me/${number.replace(/\D/g, '')}`;
