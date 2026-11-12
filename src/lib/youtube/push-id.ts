// Keys for imported YouTube messages. The chat reads its room ordered by key (database.rules.json only allows that),
// and the website's own messages get Firebase push ids, which start with the time. So a YouTube message gets a key of
// the same shape, built from when it was published plus a hash of its YouTube id: it sorts in among the website's
// messages by time, and the same YouTube message always gets the same key, so writing it twice is harmless.
import { createHash } from 'node:crypto';

// Firebase's push id alphabet, in ASCII order, so keys sort by time.
const alphabet = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

export const timeKey = (time: number, seed: string) => {
	let remaining = Math.max(0, Math.floor(time));
	let head = '';
	for (let index = 0; index < 8; index++) {
		head = alphabet[remaining % 64] + head;
		remaining = Math.floor(remaining / 64);
	}
	const bytes = createHash('sha256').update(seed).digest();
	let tail = '';
	for (let index = 0; index < 12; index++) tail += alphabet[bytes[index] % 64];
	return head + tail;
};
