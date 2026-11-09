// Server only. Our own analytics events (radio listening now, chat later) are appended to one file per month,
// data/events/YYYY-MM.jsonl, one JSON object per line. Like data/listeners.jsonl, the folder is git-ignored and left
// alone by scripts/deploy.sh.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const eventsDirectory = join(process.cwd(), 'data', 'events');

/** Every stored event has the time the server received it (ISO, UTC) and its type; the rest depends on the type. */
export type StoredEvent = { at: string; type: string } & Record<string, string | number | boolean | null | undefined>;

const monthOf = (time: number) => new Date(time).toISOString().slice(0, 7);
const fileFor = (month: string) => join(eventsDirectory, `${month}.jsonl`);

export const appendEvents = async (events: StoredEvent[]) => {
	if (!events.length) return;
	const byMonth = new Map<string, string[]>();
	for (const event of events) {
		const month = monthOf(Date.parse(event.at));
		byMonth.set(month, [...(byMonth.get(month) ?? []), JSON.stringify(event)]);
	}
	await mkdir(eventsDirectory, { recursive: true });
	// One write per file, so a batch's lines stay together.
	await Promise.all([...byMonth].map(([month, lines]) => appendFile(fileFor(month), `${lines.join('\n')}\n`, 'utf8')));
};

/** Events received in [start, end), oldest first. Lines that don't parse (a half-written line, say) are skipped. */
export const readEvents = async (start: number, end: number, types?: Set<string>): Promise<StoredEvent[]> => {
	// Without a start, begin at the first month this feature could have data for.
	const first = Number.isFinite(start) ? start : Date.parse('2026-11-01T00:00:00Z');
	const last = Number.isFinite(end) ? Math.min(end, Date.now() + 86_400_000) : Date.now();
	const months: string[] = [];
	for (let cursor = new Date(first); cursor.getTime() <= last; cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1)) {
		const month = monthOf(cursor.getTime());
		if (!months.includes(month)) months.push(month);
	}
	if (!months.includes(monthOf(last))) months.push(monthOf(last));

	const events: StoredEvent[] = [];
	for (const month of months) {
		let raw: string;
		try {
			raw = await readFile(fileFor(month), 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
			throw error;
		}
		for (const line of raw.split('\n')) {
			if (!line.trim()) continue;
			let event: StoredEvent;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}
			const time = Date.parse(event.at);
			if (time >= start && time < end && (!types || types.has(event.type))) events.push(event);
		}
	}
	return events.sort((a, b) => a.at.localeCompare(b.at));
};
