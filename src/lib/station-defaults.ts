// OZ Bandung's page settings: the values the CMS starts with (oz-cms src/siteDefaults.ts holds the same ones as its
// fields' defaults), and how what the CMS returns becomes what the page uses. The CMS keeps them in three places:
// Broadcast → Streams, Digital → Socials, Content → OZ Bandung page. These values are only used when the CMS can't be
// reached, or for a field it returns empty. Pure, so it is tested on its own (tests/admin/station-settings.test.ts).

type Card = { heading: string; text: string };

export type StationSettings = {
	audioStreamUrl: string;
	/**
	 * videoId: always plays that video. Otherwise channelId: plays whatever that channel streams (looked up by
	 * /api/youtube-live); empty means the channel connected to the YouTube integration.
	 */
	youtubeLive: { channelId: string; videoId: string };
	youtube: Card & { channelUrl: string; videos: { id: string; title: string }[] };
	instagram: Card & { url: string };
	tiktok: Card & { url: string };
	threadsUrl: string;
	contactEmail: string;
	/** As shown, e.g. +62 851-1139-1031; the wa.me link is made from its digits. */
	whatsappNumber: string;
	/** `{hours}` is replaced with the Ozubathon's hours. */
	tickerPhrases: string[];
	/** Ozubathon, the anniversary marathon (night style only): start drives the countdown; dateLabel is what's printed. */
	ozubathon: { start: string; hours: number; dateLabel: string };
	/** Plays on a loop in the video player while nothing is live; null keeps the "not live" picture. */
	offlineVideo: { url: string; mimeType: string } | null;
};

export const defaultStationSettings: StationSettings = {
	audioStreamUrl: 'https://streaming.ozradio.id:8443/ozbandung',
	youtubeLive: { channelId: 'UCdc4ztl0di-Fv58CI5TK73w', videoId: '' },
	youtube: {
		channelUrl: 'https://www.youtube.com/@OZMEDIANET',
		heading: 'Watch podcasts.',
		text: 'Live sets, studio sessions and more from OZ Radio Bandung.',
		videos: [
			{ id: 'UDmfDJTzg4w', title: 'Featured video' },
			{ id: 'dn73m2_u71E', title: 'Studio session' },
			{ id: 'ZStRwkoiTQY', title: 'Live set' },
		],
	},
	instagram: { url: 'https://www.instagram.com/ozradiobandung', heading: 'Stay in the loop.', text: 'Behind the scenes and everything.' },
	tiktok: { url: 'https://www.tiktok.com/@ozradio', heading: 'Catch the moments.', text: 'Short-form updates and behind the scenes from OZ Radio Bandung.' },
	threadsUrl: 'https://www.threads.net/@ozradiobandung',
	contactEmail: 'ozmedianet.id@gmail.com',
	whatsappNumber: '+62 851-1139-1031',
	tickerPhrases: ['55 LOUD AND LIVE', 'OZUBATHON', '{hours} HOURS NONSTOP', 'OZ RADIO BANDUNG ANNIVERSARY'],
	ozubathon: { start: '2026-12-23T19:00:00+07:00', hours: 55, dateLabel: '23 DECEMBER 2026' },
	offlineVideo: null,
};

type Text = string | null | undefined;
type CmsCard = { heading?: Text; text?: Text };

/** The three globals as the CMS REST API returns them (fields optional, nulls for empty). Null: unreachable. */
export type CmsStationSettings = {
	streams: { audioStreamUrl?: Text; liveChannelId?: Text; liveVideoId?: Text } | null;
	socials: {
		youtube?: (CmsCard & { channelUrl?: Text; videos?: { videoId?: Text; title?: Text }[] | null }) | null;
		instagram?: (CmsCard & { url?: Text }) | null;
		tiktok?: (CmsCard & { url?: Text }) | null;
		threads?: { url?: Text } | null;
	} | null;
	page: {
		ticker?: { phrase?: Text }[] | null;
		ozubathon?: { start?: Text; hours?: number | null; dateLabel?: Text } | null;
		contact?: { email?: Text; whatsappNumber?: Text } | null;
		/** The upload, read with depth 1 so it comes with its URL (an id alone is ignored). */
		offlineVideo?: { url?: Text; mimeType?: Text } | number | string | null;
	} | null;
};

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
const card = (cms: CmsCard | null | undefined, fallback: Card): Card => ({ heading: text(cms?.heading, fallback.heading), text: text(cms?.text, fallback.text) });

export const mergeStationSettings = (cms: Partial<CmsStationSettings> | null | undefined, defaults = defaultStationSettings): StationSettings => {
	const streams = cms?.streams;
	const socials = cms?.socials;
	const page = cms?.page;
	const videos = (socials?.youtube?.videos ?? [])
		.map((video) => ({ id: text(video?.videoId, ''), title: text(video?.title, 'YouTube video') }))
		.filter((video) => /^[\w-]{11}$/.test(video.id));
	const phrases = (page?.ticker ?? []).map((item) => text(item?.phrase, '')).filter(Boolean);
	const hours = page?.ozubathon?.hours;
	const start = text(page?.ozubathon?.start, '');
	const channelId = text(streams?.liveChannelId, '');
	const videoId = text(streams?.liveVideoId, '');
	return {
		audioStreamUrl: text(streams?.audioStreamUrl, defaults.audioStreamUrl),
		youtubeLive: {
			// Reachable CMS with the channel cleared: follow the connected channel. Unreachable: the built-in one.
			channelId: /^UC[\w-]{22}$/.test(channelId) ? channelId : streams ? '' : defaults.youtubeLive.channelId,
			videoId: /^[\w-]{11}$/.test(videoId) ? videoId : '',
		},
		youtube: {
			...card(socials?.youtube, defaults.youtube),
			channelUrl: text(socials?.youtube?.channelUrl, defaults.youtube.channelUrl),
			videos: videos.length ? videos : defaults.youtube.videos,
		},
		instagram: { ...card(socials?.instagram, defaults.instagram), url: text(socials?.instagram?.url, defaults.instagram.url) },
		tiktok: { ...card(socials?.tiktok, defaults.tiktok), url: text(socials?.tiktok?.url, defaults.tiktok.url) },
		threadsUrl: text(socials?.threads?.url, defaults.threadsUrl),
		contactEmail: text(page?.contact?.email, defaults.contactEmail),
		whatsappNumber: text(page?.contact?.whatsappNumber, defaults.whatsappNumber),
		tickerPhrases: phrases.length ? phrases : defaults.tickerPhrases,
		ozubathon: {
			start: start && Number.isFinite(Date.parse(start)) ? start : defaults.ozubathon.start,
			hours: typeof hours === 'number' && hours > 0 ? hours : defaults.ozubathon.hours,
			dateLabel: text(page?.ozubathon?.dateLabel, defaults.ozubathon.dateLabel),
		},
		offlineVideo: offlineVideo(page?.offlineVideo),
	};
};

const videoTypes = new Set(['video/mp4', 'video/webm']);

/** The offline loop, if one is set and it is a video the browser can play from an http(s) address. */
const offlineVideo = (value: unknown): StationSettings['offlineVideo'] => {
	if (!value || typeof value !== 'object') return null;
	const { url, mimeType } = value as { url?: unknown; mimeType?: unknown };
	if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
	return { url, mimeType: typeof mimeType === 'string' && videoTypes.has(mimeType) ? mimeType : 'video/mp4' };
};

/** https://wa.me/<digits> for a number written any way. */
export const whatsappLink = (number: string) => `https://wa.me/${number.replace(/\D/g, '')}`;

/** The handle in a profile link: https://www.tiktok.com/@ozradio → ozradio. */
export const profileHandle = (url: string) => url.replace(/\/+$/, '').split('/').pop()?.replace(/^@/, '') ?? '';
