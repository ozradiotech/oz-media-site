// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';

// Vercel sets VERCEL=1 during its builds; everywhere else (local, self-hosted) uses Node.
// https://astro.build/config
export default defineConfig({
	output: 'server',
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
		},
	},
});
