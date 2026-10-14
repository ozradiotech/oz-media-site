// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';

// Vercel sets VERCEL=1 during its builds; everywhere else (local, self-hosted) uses Node.
// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),
});
