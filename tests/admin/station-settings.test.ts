// How the CMS's settings (Broadcast → Streams, Digital → Socials, Content → OZ Bandung page) become the page's.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { defaultStationSettings, mergeStationSettings, profileHandle, whatsappLink } from '../../src/lib/station-defaults.ts';

describe('station settings', () => {
	test('CMS unreachable: the built-in values, including the built-in livestream channel', () => {
		assert.deepEqual(mergeStationSettings(null), defaultStationSettings);
		assert.deepEqual(mergeStationSettings({ streams: null, socials: null, page: null }), defaultStationSettings);
	});

	test('filled-in fields win; empty ones keep the built-in values', () => {
		const merged = mergeStationSettings({
			streams: { audioStreamUrl: 'https://stream.example/live', liveChannelId: 'UC4hRJf9Uzz1WsctDwMiViNw', liveVideoId: 'X_n-uiONfpw' },
			socials: {
				youtube: { channelUrl: '', heading: 'Nonton.', text: null, videos: [{ videoId: 'abcdefghijk', title: 'New' }] },
				instagram: { url: null },
				tiktok: { url: 'https://www.tiktok.com/@new', heading: '  ' },
				threads: null,
			},
			page: {
				ticker: [{ phrase: '{hours} JAM' }, { phrase: '' }],
				ozubathon: { start: '2027-01-01T12:00:00.000Z', hours: 24, dateLabel: null },
				contact: { email: 'hello@ozradio.test', whatsappNumber: null },
			},
		});
		assert.equal(merged.audioStreamUrl, 'https://stream.example/live');
		assert.deepEqual(merged.youtubeLive, { channelId: 'UC4hRJf9Uzz1WsctDwMiViNw', videoId: 'X_n-uiONfpw' });
		assert.equal(merged.youtube.channelUrl, defaultStationSettings.youtube.channelUrl);
		assert.equal(merged.youtube.heading, 'Nonton.');
		assert.equal(merged.youtube.text, defaultStationSettings.youtube.text);
		assert.deepEqual(merged.youtube.videos, [{ id: 'abcdefghijk', title: 'New' }]);
		assert.equal(merged.instagram.url, defaultStationSettings.instagram.url);
		assert.equal(merged.tiktok.url, 'https://www.tiktok.com/@new');
		assert.equal(merged.tiktok.heading, defaultStationSettings.tiktok.heading);
		assert.equal(merged.threadsUrl, defaultStationSettings.threadsUrl);
		assert.equal(merged.contactEmail, 'hello@ozradio.test');
		assert.equal(merged.whatsappNumber, defaultStationSettings.whatsappNumber);
		assert.deepEqual(merged.tickerPhrases, ['{hours} JAM']);
		assert.deepEqual(merged.ozubathon, { start: '2027-01-01T12:00:00.000Z', hours: 24, dateLabel: defaultStationSettings.ozubathon.dateLabel });
	});

	test('a cleared livestream channel means "the connected channel", not the built-in one', () => {
		assert.equal(mergeStationSettings({ streams: { liveChannelId: null }, socials: null, page: null }).youtubeLive.channelId, '');
		assert.equal(mergeStationSettings({ streams: { liveChannelId: '' }, socials: null, page: null }).youtubeLive.channelId, '');
	});

	test('malformed ids are ignored rather than breaking the player', () => {
		const merged = mergeStationSettings({
			streams: { liveChannelId: 'not-a-channel', liveVideoId: 'short' },
			socials: { youtube: { videos: [{ videoId: 'bad', title: 'x' }] } },
			page: null,
		});
		assert.deepEqual(merged.youtubeLive, { channelId: '', videoId: '' });
		assert.deepEqual(merged.youtube.videos, defaultStationSettings.youtube.videos);
	});

	test('links: WhatsApp from the digits, profile handles from the URL', () => {
		assert.equal(whatsappLink('+62 851-1139-1031'), 'https://wa.me/6285111391031');
		assert.equal(profileHandle('https://www.tiktok.com/@ozradio'), 'ozradio');
		assert.equal(profileHandle('https://www.tiktok.com/@ozradio/'), 'ozradio');
	});
});
