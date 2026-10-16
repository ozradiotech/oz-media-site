import type { APIRoute } from 'astro';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const genders = new Set(['Female', 'Male']);

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
	const trimmedName = typeof name === 'string' ? name.trim() : '';
	const parsedAge = typeof age === 'number' ? age : typeof age === 'string' ? Number(age) : NaN;
	const trimmedGender = typeof gender === 'string' ? gender.trim() : '';
	const trimmedLocation = typeof location === 'string' ? location.trim() : '';
	const normalizedBroadcast = typeof broadcast === 'string' ? broadcast.trim().toLowerCase() : '';

	if (
		!trimmedName || trimmedName.length > 80 ||
		!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120 ||
		!genders.has(trimmedGender) ||
		!trimmedLocation || trimmedLocation.length > 100 ||
		(normalizedBroadcast !== 'audio' && normalizedBroadcast !== 'video')
	) {
		return new Response('Invalid listener details.', { status: 400 });
	}

	const record = {
		name: trimmedName,
		age: parsedAge,
		gender: trimmedGender,
		location: trimmedLocation,
		broadcast: normalizedBroadcast,
		createdAt: new Date().toISOString(),
	};
	// Vercel's filesystem is read-only, so accept the details there without storing them.
	if (process.env.VERCEL) return new Response(null, { status: 202 });

	const dataDirectory = join(process.cwd(), 'data');

	try {
		await mkdir(dataDirectory, { recursive: true });
		await appendFile(join(dataDirectory, 'listeners.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
	} catch {
		return new Response('Listener details could not be saved.', { status: 500 });
	}

	return new Response(null, { status: 201 });
};