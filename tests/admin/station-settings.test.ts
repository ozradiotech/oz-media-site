// How the CMS's Station settings override the page's built-in values.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { defaultStationSettings, mergeStationSettings, whatsappLink } from '../../src/lib/station-defaults.ts';

describe('station settings', () => {
	test('no CMS (down, or not saved yet): the built-in values', () => {
		assert.deepEqual(mergeStationSettings(null), defaultStationSettings);
		assert.deepEqual(mergeStationSettings({}), defaultStationSettings);
	});

	test('filled-in fields win; empty ones keep the defaults', () => {
		const merged = mergeStationSettings({
			audioStreamUrl: 'https://stream.example/live',
			youtube: { liveChannelId: 'UC4hRJf9Uzz1WsctDwMiViNw', liveVideoId: 'X_n-uiONfpw', channelUrl: '', videos: [{ videoId: 'abcdefghijk', title: 'New' }] },
			social: { instagramUrl: null, tiktokUrl: 'https://www.tiktok.com/@new', threadsUrl: '  ' },
			contact: { email: 'hello@ozradio.test', whatsappNumber: null },
			ticker: [{ phrase: '{hours} JAM' }, { phrase: '' }],
			ozubathon: { start: '2027-01-01T12:00:00.000Z', hours: 24, dateLabel: null },
		});
		assert.equal(merged.audioStreamUrl, 'https://stream.example/live');
		assert.deepEqual(merged.youtubeLive, { channelId: 'UC4hRJf9Uzz1WsctDwMiViNw', videoId: 'X_n-uiONfpw' });
		assert.equal(merged.youtubeChannelUrl, defaultStationSettings.youtubeChannelUrl);
		assert.deepEqual(merged.youtubeVideos, [{ id: 'abcdefghijk', title: 'New' }]);
		assert.equal(merged.instagramUrl, defaultStationSettings.instagramUrl);
		assert.equal(merged.tiktokUrl, 'https://www.tiktok.com/@new');
		assert.equal(merged.threadsUrl, defaultStationSettings.threadsUrl);
		assert.equal(merged.contactEmail, 'hello@ozradio.test');
		assert.equal(merged.whatsappNumber, defaultStationSettings.whatsappNumber);
		assert.deepEqual(merged.tickerPhrases, ['{hours} JAM']);
		assert.deepEqual(merged.ozubathon, { start: '2027-01-01T12:00:00.000Z', hours: 24, dateLabel: defaultStationSettings.ozubathon.dateLabel });
	});

	test('malformed ids are ignored rather than breaking the player', () => {
		const merged = mergeStationSettings({ youtube: { liveChannelId: 'not-a-channel', liveVideoId: 'short', videos: [{ videoId: 'bad', title: 'x' }] } });
		assert.deepEqual(merged.youtubeLive, defaultStationSettings.youtubeLive);
		assert.deepEqual(merged.youtubeVideos, defaultStationSettings.youtubeVideos);
	});

	test('WhatsApp links are built from the digits of the number as written', () => {
		assert.equal(whatsappLink('+62 851-1139-1031'), 'https://wa.me/6285111391031');
	});
});
