import type { APIRoute } from 'astro';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const genders = new Set(['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Self-describe']);

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	let input: unknown;
	try {
		input = await request.json();
	} catch {
		return new Response('Invalid JSON body.', { status: 400 });
	}

	if (!input || typeof input !== 'object') {
		return new Response('Invalid listener details.', { status: 400 });
	}

	const { name, age, gender, location, broadcast } = input as Record<string, unknown>;
	if (
		typeof name !== 'string' || !name.trim() || name.trim().length > 80 ||
		typeof age !== 'number' || !Number.isInteger(age) || age < 1 || age > 120 ||
		typeof gender !== 'string' || !genders.has(gender) ||
		typeof location !== 'string' || !location.trim() || location.trim().length > 100 ||
		(broadcast !== 'audio' && broadcast !== 'video')
	) {
		return new Response('Invalid listener details.', { status: 400 });
	}

	const record = {
		name: name.trim(),
		age,
		gender,
		location: location.trim(),
		broadcast,
		createdAt: new Date().toISOString(),
	};
	const dataDirectory = join(process.cwd(), 'data');

	try {
		await mkdir(dataDirectory, { recursive: true });
		await appendFile(join(dataDirectory, 'listeners.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
	} catch {
		return new Response('Listener details could not be saved.', { status: 500 });
	}

	return new Response(null, { status: 201 });
};