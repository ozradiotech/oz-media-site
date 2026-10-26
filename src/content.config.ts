import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const cardFields = {
	summary: z.string().default(''),
	image: z.string(),
	imageAlt: z.string().default(''),
};

const programs = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/programs' }),
	schema: z.object({
		title: z.string(),
		order: z.number().int().default(0),
		...cardFields,
	}),
});

const announcers = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/announcers' }),
	schema: z.object({
		name: z.string(),
		order: z.number().int().default(0),
		...cardFields,
	}),
});

const activities = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/activities' }),
	schema: z.object({
		title: z.string(),
		category: z.string(),
		artStyle: z.enum(['listen', 'meet', 'create']).default('listen'),
		artLabel: z.string().default(''),
		status: z.string().default(''),
		order: z.number().int().default(0),
		...cardFields,
	}),
});

const news = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
	schema: z.object({
		title: z.string(),
		category: z.string().default('OZ NEWS'),
		publishedAt: z.coerce.date().optional(),
		...cardFields,
	}),
});

// One file per month of social media numbers, copied from each platform's own insights.
const count = z.number().int().min(0).default(0);
const analytics = defineCollection({
	loader: glob({ pattern: '**/*.json', base: './src/content/analytics' }),
	schema: z.object({
		month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
		// Marks sample numbers so the page can flag them; untick once real figures are in.
		placeholder: z.boolean().default(false),
		youtube: z.object({
			views: count,
			watchTimeHours: count,
			subscribers: count,
			subscribersGained: count,
			subscribersLost: count,
			impressions: count,
			impressionsCtr: z.number().min(0).max(100).default(0),
			averageViewDurationSeconds: count,
			likes: count,
			comments: count,
			shares: count,
			trafficSources: z.object({ search: count, suggested: count, browse: count, external: count, other: count }),
		}),
		instagram: z.object({
			reach: count,
			views: count,
			followers: count,
			followersGained: count,
			profileVisits: count,
			accountsEngaged: count,
			interactions: count,
			likes: count,
			comments: count,
			shares: count,
			saves: count,
			websiteTaps: count,
			contentViews: z.object({ reels: count, posts: count, stories: count }),
		}),
		tiktok: z.object({
			videoViews: count,
			profileViews: count,
			reach: count,
			followers: count,
			followersGained: count,
			likes: count,
			comments: count,
			shares: count,
			saves: count,
			averageWatchTimeSeconds: count,
			trafficSources: z.object({ forYou: count, following: count, profile: count, search: count, other: count }),
		}),
	}),
});

export const collections = { programs, announcers, activities, news, analytics };
