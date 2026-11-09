// Server only. Turns a browser's User-Agent header into the three things the analytics need. Only these are stored,
// never the header itself. Good enough for "mobile vs desktop" and the big browsers; anything unusual is "Other".

export type Device = 'mobile' | 'tablet' | 'desktop';
export type ClientInfo = { device: Device; os: string; browser: string };

const bot = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp|curl|wget|python|node-fetch/i;

/** Crawlers, link previews and scripts, which shouldn't count as listeners. */
export const isBot = (userAgent: string) => !userAgent || bot.test(userAgent);

export const parseUserAgent = (userAgent: string): ClientInfo => {
	const ua = userAgent;
	// Recent iPads ask for desktop sites and report macOS, so they count as desktop.
	const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua);
	const mobile = !tablet && /Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua);

	const os = /Windows/i.test(ua) ? 'Windows'
		: /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
		: /Android/i.test(ua) ? 'Android'
		: /CrOS/i.test(ua) ? 'ChromeOS'
		: /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
		: /Linux/i.test(ua) ? 'Linux'
		: 'Other';

	// Order matters: Edge, Opera and Samsung Internet all also say "Chrome", and Chrome says "Safari".
	const browser = /Edg\//i.test(ua) ? 'Edge'
		: /OPR\/|Opera/i.test(ua) ? 'Opera'
		: /SamsungBrowser/i.test(ua) ? 'Samsung Internet'
		: /Instagram/i.test(ua) ? 'Instagram app'
		: /FBAN|FBAV/i.test(ua) ? 'Facebook app'
		: /musical_ly|TikTok|BytedanceWebview/i.test(ua) ? 'TikTok app'
		: /Firefox|FxiOS/i.test(ua) ? 'Firefox'
		: /Chrome|CriOS/i.test(ua) ? 'Chrome'
		: /Safari/i.test(ua) ? 'Safari'
		: 'Other';

	return { device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', os, browser };
};
