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

export const collections = { programs, announcers, activities, news };
