import { defineMiddleware } from 'astro:middleware';
import { youtubeRuntime } from './lib/youtube/runtime';

// Starts the YouTube sync worker (src/lib/youtube/runtime.ts) with the first request this server handles. Not while
// prerendering pages at build time, and not on Vercel, whose functions don't live long enough to run it.
let started = false;

export const onRequest = defineMiddleware((context, next) => {
	if (!started && !context.isPrerendered && !process.env.VERCEL) {
		started = true;
		try {
			youtubeRuntime();
		} catch (error) {
			console.error('[youtube] The sync worker could not start; the website chat is unaffected.', error);
		}
	}
	return next();
});
