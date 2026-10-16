// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';

// Vercel sets VERCEL=1 during its builds; everywhere else (local, self-hosted) uses Node.
// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),
	env: {
		schema: {
			// Live chat (see src/lib/chat-server.ts). Read at runtime and never sent to the browser.
			FIREBASE_SERVICE_ACCOUNT: envField.string({ context: 'server', access: 'secret', optional: true }),
			CRON_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
		},
	},
});
