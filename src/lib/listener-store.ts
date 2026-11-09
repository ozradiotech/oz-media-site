// Server only. Listener form records are appended to data/listeners.jsonl, one JSON object per line
// (written by src/pages/api/listeners.ts, read by the analytics dashboard).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const listenerDataDirectory = join(process.cwd(), 'data');
export const listenerDataFile = join(listenerDataDirectory, 'listeners.jsonl');

export type ListenerRecord = {
	createdAt: string;
	name: string;
	age: string;
	gender: string;
	location: string;
	broadcast: string | null;
	googleUid: string | null;
	googleEmail: string | null;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Every stored record, newest first. Lines that aren't valid records (a half-written line, say) are skipped. */
export const readListenerRecords = async (): Promise<ListenerRecord[]> => {
	let raw: string;
	try {
		raw = await readFile(listenerDataFile, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	const records: ListenerRecord[] = [];
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		let value: Record<string, unknown>;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}
		const createdAt = text(value.createdAt);
		if (!createdAt || Number.isNaN(Date.parse(createdAt))) continue;
		records.push({
			createdAt,
			name: text(value.name),
			// The first records stored an exact age as a number; later ones an age range.
			age: typeof value.age === 'number' ? String(value.age) : text(value.age),
			gender: text(value.gender),
			location: text(value.location),
			broadcast: text(value.broadcast) || null,
			googleUid: text(value.googleUid) || null,
			googleEmail: text(value.googleEmail) || null,
		});
	}
	return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
