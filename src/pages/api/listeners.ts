import type { APIRoute } from 'astro';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ageRanges } from '../../lib/listener';

const genders = new Set(['Female', 'Male']);
const ages = new Set<string>(ageRanges);

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

	const { name, age, gender, location, broadcast, uid, email } = input as Record<string, unknown>;
	const trimmedName = typeof name === 'string' ? name.trim() : '';
	const trimmedAge = typeof age === 'string' ? age.trim() : '';
	const trimmedGender = typeof gender === 'string' ? gender.trim() : '';
	const trimmedLocation = typeof location === 'string' ? location.trim() : '';
	// The stream playing when the form was sent, if any: tuning in no longer waits for the form.
	const normalizedBroadcast = typeof broadcast === 'string' ? broadcast.trim().toLowerCase() : null;
	// The Google account the listener signed in with. Sent by the browser, so treat it as unverified.
	const googleUid = typeof uid === 'string' ? uid.trim() : '';
	const googleEmail = typeof email === 'string' ? email.trim() : '';

	if (
		!trimmedName || trimmedName.length > 80 ||
		!ages.has(trimmedAge) ||
		!genders.has(trimmedGender) ||
		!trimmedLocation || trimmedLocation.length > 100 ||
		(normalizedBroadcast !== null && normalizedBroadcast !== 'audio' && normalizedBroadcast !== 'video') ||
		!googleUid || googleUid.length > 128 ||
		googleEmail.length > 254
	) {
		return new Response('Invalid listener details.', { status: 400 });
	}

	const record = {
		name: trimmedName,
		age: trimmedAge,
		gender: trimmedGender,
		location: trimmedLocation,
		broadcast: normalizedBroadcast,
		googleUid,
		googleEmail,
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
