// The Online digital section's videos and posts (src/lib/online-feed.ts).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	buildOnlineContent,
	isStreamReplay,
	parseYoutubeFeed,
	postCards,
	shortDate,
	viewCount,
	type FeedVideo,
} from '../src/lib/online-feed.ts';

const entry = (id: string, title: string, published: string, { short = false, views = 10 } = {}) => `
 <entry>
  <id>yt:video:${id}</id>
  <yt:videoId>${id}</yt:videoId>
  <title>${title}</title>
  <link rel="alternate" href="https://www.youtube.com/${short ? `shorts/${id}` : `watch?v=${id}`}"/>
  <published>${published}</published>
  <media:group>
   <media:title>${title}</media:title>
   <media:community><media:statistics views="${views}"/></media:community>
  </media:group>
 </entry>`;

const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>OZ Media</title>
 <published>2012-05-09T06:12:50+00:00</published>
 ${entry('pm4IXP3eDQg', 'Live streaming of OZ Media', '2026-11-16T06:18:50+00:00', { views: 245 })}
 ${entry('LtD28xaBX6c', 'MIMING BEBEG SPESIAL', '2026-11-11T19:51:39+00:00', { views: 694 })}
 ${entry('JM6UgGcGIw0', 'Cerita si BIG eps.2', '2026-10-28T11:00:16+00:00', { short: true })}
 ${entry('9dtLkWbFkmE', 'SINIAR DI LUAR EPS 22: SEPEDAHAN KE CAFE LEGEND!', '2026-11-02T12:00:20+00:00')}
 ${entry('nNZ-4cuH-QI', 'Departement Lain Lain &amp; Produser &#39;Antik&#39;', '2026-10-30T12:00:17+00:00')}
</feed>`;

const video = (id: string, title: string, publishedAt: string, short = false): FeedVideo => ({ id, title, publishedAt, views: null, short });

describe('YouTube feed', () => {
	test('reads each upload, skipping the channel’s own title and date', () => {
		const videos = parseYoutubeFeed(feedXml);
		assert.deepEqual(videos.map((item) => item.id), ['pm4IXP3eDQg', 'LtD28xaBX6c', 'JM6UgGcGIw0', '9dtLkWbFkmE', 'nNZ-4cuH-QI']);
		assert.deepEqual(videos[0], { id: 'pm4IXP3eDQg', title: 'Live streaming of OZ Media', publishedAt: '2026-11-16T06:18:50+00:00', views: 245, short: false });
		assert.equal(videos[2].short, true);
		assert.equal(videos[4].title, "Departement Lain Lain & Produser 'Antik'");
	});

	test('a broken or empty feed is no videos', () => {
		assert.deepEqual(parseYoutubeFeed(''), []);
		assert.deepEqual(parseYoutubeFeed('<feed><entry><title>No id</title></entry></feed>'), []);
	});

	test('stream recordings are known by the streaming app’s default title', () => {
		assert.equal(isStreamReplay({ title: 'Live streaming of OZ Media' }), true);
		assert.equal(isStreamReplay({ title: 'LIVE STREAMING OF OZ MEDIA' }), true);
		assert.equal(isStreamReplay({ title: 'Noise Transmission - live set' }), false);
	});
});

describe('Online digital content', () => {
	const feed = parseYoutubeFeed(feedXml);

	test('newest videos without Shorts or stream recordings; Shorts join the posts', () => {
		const { videos, posts } = buildOnlineContent({ feed, pinned: [], posts: [] });
		assert.deepEqual(videos.map((item) => item.id), ['LtD28xaBX6c', '9dtLkWbFkmE', 'nNZ-4cuH-QI']);
		assert.deepEqual(posts, [{
			platform: 'youtube',
			url: 'https://www.youtube.com/shorts/JM6UgGcGIw0',
			image: 'https://i.ytimg.com/vi/JM6UgGcGIw0/hqdefault.jpg',
			caption: 'Cerita si BIG eps.2',
			postedAt: '2026-10-28T11:00:16+00:00',
		}]);
	});

	test('pinned videos come first, once, with the feed’s details when it has them', () => {
		const { videos } = buildOnlineContent({
			feed,
			pinned: [{ id: 'UDmfDJTzg4w', title: 'Studio session' }, { id: '9dtLkWbFkmE', title: 'Pinned title' }],
			posts: [],
		});
		assert.deepEqual(videos.map((item) => item.id), ['UDmfDJTzg4w', '9dtLkWbFkmE', 'LtD28xaBX6c', 'nNZ-4cuH-QI']);
		assert.deepEqual(videos[0], { id: 'UDmfDJTzg4w', title: 'Studio session', publishedAt: '', views: null, short: false });
		assert.equal(videos[1].publishedAt, '2026-11-02T12:00:20+00:00');
	});

	test('at most five videos; stream recordings only when there is nothing else', () => {
		const many = Array.from({ length: 8 }, (_, index) => video(`video${index}abcd`.slice(0, 11), `Episode ${index}`, `2026-11-0${index + 1}T00:00:00Z`));
		assert.equal(buildOnlineContent({ feed: many, pinned: [], posts: [] }).videos.length, 5);
		const replays = [video('pm4IXP3eDQg', 'Live streaming of OZ Media', '2026-11-16T06:18:50Z')];
		assert.deepEqual(buildOnlineContent({ feed: replays, pinned: [], posts: [] }).videos.map((item) => item.id), ['pm4IXP3eDQg']);
		assert.deepEqual(buildOnlineContent({ feed: [], pinned: [], posts: [] }), { videos: [], posts: [] });
	});

	test('posts and Shorts mix newest first, twelve at most', () => {
		const post = (day: number) => ({ platform: 'instagram' as const, url: `https://www.instagram.com/p/${day}/`, image: 'x.webp', caption: '', postedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z` });
		const { posts } = buildOnlineContent({ feed, pinned: [], posts: [post(29), post(1), ...Array.from({ length: 12 }, (_, index) => post(index + 2))] });
		assert.equal(posts.length, 12);
		assert.deepEqual(posts.slice(0, 2).map((item) => item.url), ['https://www.instagram.com/p/29/', 'https://www.youtube.com/shorts/JM6UgGcGIw0']);
	});
});

describe('CMS social posts', () => {
	const image = () => 'https://cms.example/api/media/file/cover-400x711.webp';

	test('a post with a link, a cover and a known platform becomes a card', () => {
		assert.deepEqual(postCards([{ url: 'https://www.tiktok.com/@ozradio/video/1', caption: ' Nonton! ', postedAt: '2026-11-01T00:00:00Z', platform: 'tiktok', cover: { url: '/x' } }], image), [
			{ platform: 'tiktok', url: 'https://www.tiktok.com/@ozradio/video/1', image: image(), caption: 'Nonton!', postedAt: '2026-11-01T00:00:00Z' },
		]);
	});

	test('incomplete posts are left out', () => {
		assert.deepEqual(postCards([
			{ url: 'https://www.instagram.com/p/x/', platform: 'instagram', cover: null },
			{ url: 'javascript:alert(1)', platform: 'instagram', cover: { url: '/x' } },
			{ url: 'https://www.instagram.com/p/x/', platform: 'threads', cover: { url: '/x' } },
		], image), []);
	});
});

describe('labels', () => {
	const now = new Date('2026-11-17T00:00:00Z');
	test('dates in Jakarta time, the year only when it isn’t this one', () => {
		assert.equal(shortDate('2026-11-16T20:00:00Z', now), '17 Nov');
		assert.equal(shortDate('2025-12-01T00:00:00Z', now), '1 Dec 2025');
		assert.equal(shortDate('', now), '');
	});

	test('view counts', () => {
		assert.equal(viewCount(null), '');
		assert.equal(viewCount(1), '1 view');
		assert.equal(viewCount(694), '694 views');
		assert.equal(viewCount(12_345), '12.3K views');
	});
});
