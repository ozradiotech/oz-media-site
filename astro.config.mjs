// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import { loadEnv } from 'vite';

// The site's own address, from SITE_URL in .env (each server builds with its own): canonical links, share URLs, the
// sitemap and robots.txt all use it. ozradio.id when unset.
const { SITE_URL } = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');

// Vercel sets VERCEL=1 during its builds; everywhere else (local, self-hosted) uses Node.
// https://astro.build/config
export default defineConfig({
	site: SITE_URL || 'https://ozradio.id',
	// The CMS lives at /admin only; catch the station-prefixed guesses.
	redirects: {
		'/oz-bandung/admin': '/admin',
		'/oz-bali/admin': '/admin',
	},
	output: 'server',
	vite: {
		// Development only. These are imported on demand (sign-in, chat, the player, the dashboard charts), so Vite would
		// only find them once a page asks for one, re-bundle, and leave open pages pointing at a bundle that no longer
		// exists ("504 Outdated Optimize Dep", e.g. Google sign-in failing to load). Bundling them up front avoids that.
		optimizeDeps: {
			include: ['firebase/app', 'firebase/app-check', 'firebase/auth', 'firebase/database', 'chart.js/auto', 'video.js/core.es.js', 'web-vitals'],
		},
	},
	adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),
	// Self-hosted fonts, loaded per page with <Font /> (see src/styles/typography.css).
	fonts: [
		{
			// Primary: headings, logos and display text.
			provider: fontProviders.local(),
			name: 'Tango Sans',
			cssVariable: '--font-tango',
			fallbacks: ['Arial', 'sans-serif'],
			options: {
				variants: [
					{ src: ['./src/assets/fonts/TangoSans.woff2'], weight: 400, style: 'normal' },
					{ src: ['./src/assets/fonts/TangoSans_Italic.woff2'], weight: 400, style: 'italic' },
					{ src: ['./src/assets/fonts/TangoSans_Bold.woff2'], weight: 700, style: 'normal' },
					{ src: ['./src/assets/fonts/TangoSans_BoldItalic.woff2'], weight: 700, style: 'italic' },
				],
			},
		},
		{
			// Secondary: body text and UI. Downloaded from Google at build time and served from this site.
			provider: fontProviders.google(),
			name: 'Plus Jakarta Sans',
			cssVariable: '--font-jakarta',
			weights: ['200 800'],
			styles: ['normal', 'italic'],
			fallbacks: ['Arial', 'sans-serif'],
		},
		{
			// Night Shift style only: frequency readouts, labels and navigation (see src/styles/themes.css).
			provider: fontProviders.google(),
			name: 'Space Mono',
			cssVariable: '--font-mono',
			weights: [400, 700],
			styles: ['normal'],
			fallbacks: ['ui-monospace', 'monospace'],
		},
	],
	env: {
		schema: {
			// Live chat (see src/lib/chat-server.ts). Read at runtime and never sent to the browser.
			FIREBASE_SERVICE_ACCOUNT: envField.string({ context: 'server', access: 'secret', optional: true }),
			CRON_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
			// Key for the hashed chatter ids in the analytics (see src/lib/chat-analytics.ts). Optional.
			ANALYTICS_SALT: envField.string({ context: 'server', access: 'secret', optional: true }),
			// The GA4 property the /analytics Website panel reads (see src/lib/ga4.ts). Optional.
			GA_PROPERTY_ID: envField.string({ context: 'server', access: 'public', optional: true }),
			// The Payload CMS the content comes from (see src/live.config.ts), and the website user's API key, which
			// the CMS needs for the social media numbers. Published content reads without it.
			CMS_URL: envField.string({ context: 'server', access: 'public', default: 'http://localhost:3000' }),
			CMS_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
			// Shared with the CMS (oz-cms CMS_SITE_SECRET): verifies the tokens its admin pages use to work this site's
			// admin routes (src/lib/admin-token.ts). At least 32 characters; without it those CMS pages can't connect.
			CMS_SITE_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
			// Experimental: YouTube live chat sync and livestream viewer counts (docs/youtube-unified-chat.md). Off unless
			// the OAuth client and the encryption key are set; YOUTUBE_SYNC=off turns it off with them set.
			YOUTUBE_SYNC: envField.enum({ context: 'server', access: 'public', values: ['on', 'off'], default: 'on' }),
			YOUTUBE_CLIENT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
			YOUTUBE_CLIENT_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
			YOUTUBE_REDIRECT_URI: envField.string({ context: 'server', access: 'public', optional: true }),
			YOUTUBE_TOKEN_ENCRYPTION_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
			YOUTUBE_CHANNEL_ID: envField.string({ context: 'server', access: 'public', optional: true }),
			YOUTUBE_BROADCAST_CHECK_INTERVAL: envField.number({ context: 'server', access: 'public', default: 120, int: true, gt: 14 }),
			YOUTUBE_VIEWER_COUNT_REFRESH_INTERVAL: envField.number({ context: 'server', access: 'public', default: 60, int: true, gt: 14 }),
			YOUTUBE_CHAT_POLL_MIN_INTERVAL: envField.number({ context: 'server', access: 'public', default: 10, int: true, gt: 1 }),
			YOUTUBE_DAILY_QUOTA: envField.number({ context: 'server', access: 'public', default: 10000, int: true, gt: 0 }),
			YOUTUBE_OUTBOUND_PER_MINUTE: envField.number({ context: 'server', access: 'public', default: 20, int: true, gt: 0 }),
			WEBSITE_VIEWER_HEARTBEAT_INTERVAL: envField.number({ context: 'server', access: 'public', default: 20, int: true, gt: 4 }),
			WEBSITE_VIEWER_SESSION_TTL: envField.number({ context: 'server', access: 'public', default: 60, int: true, gt: 9 }),
			LIVESTREAM_SNAPSHOT_INTERVAL: envField.number({ context: 'server', access: 'public', default: 300, int: true, gt: 29 }),
		},
	},
});
