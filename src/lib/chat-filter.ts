// Text checks for live chat messages. Pure functions, used by the /api/chat route.

export type Blocklist = {
	/** Masked with asterisks; the message still posts. */
	mild: string[];
	/** The message is rejected and the sender gets a strike. */
	severe: string[];
};

// Built-in words. Moderators can add more without a redeploy at chat/private/blocklist in the database.
export const defaultBlocklist: Blocklist = {
	mild: [
		'anjing', 'anjeng', 'anying', 'bangsat', 'bajingan', 'brengsek', 'kampret', 'keparat', 'tai', 'taik',
		'goblok', 'goblog', 'tolol', 'bego', 'idiot', 'dongo', 'kehed', 'belegug', 'sialan',
		'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'wtf',
	],
	severe: [
		'kontol', 'memek', 'ngentot', 'entot', 'ngewe', 'jembut', 'pepek', 'peler', 'lonte', 'pelacur',
		'jancok', 'jancuk', 'bencong',
		'nigger', 'nigga', 'faggot', 'cunt', 'retard', 'kys',
	],
};

const leetspeak: Record<string, string> = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't' };

// Indonesian and English affixes, so "anjingg", "siAnjing" and "goblokmu" are caught but "pantai" is not.
const prefixes = ['', 'si', 'di', 'ng', 'nge', 'ke', 'ka'];
const suffixes = ['', 'lah', 'nya', 'an', 'in', 'kan', 'mu', 'lu', 'lo', 'loe', 'u', 'sia', 'kau', 'dong', 'deh', 's', 'es', 'er', 'ed', 'ing', 'y'];

/** Lowercase, strip accents, undo leetspeak, drop everything but letters and collapse repeated letters. */
export const normalizeWord = (word: string) => word
	.normalize('NFKD')
	.replace(/\p{M}/gu, '')
	.toLowerCase()
	.replace(/[4@3!105$7]/g, (character) => leetspeak[character] ?? character)
	.replace(/[^\p{L}]/gu, '')
	.replace(/(\p{L})\1+/gu, '$1');

const normalizeList = (words: string[]) => new Set(words.map(normalizeWord).filter(Boolean));

const matchesWithAffixes = (word: string, list: Set<string>) => prefixes.some((prefix) => {
	if (!word.startsWith(prefix)) return false;
	return suffixes.some((suffix) => {
		if (!word.endsWith(suffix) || word.length < prefix.length + suffix.length) return false;
		return list.has(word.slice(prefix.length, word.length - suffix.length));
	});
});

/** Collapse whitespace, remove invisible and control characters, and cap runs of a repeated character. */
export const cleanText = (input: string) => input
	.replace(/[\u0000-\u001F\u007F­​-‏‪-‮⁠-⁤﻿]/g, '')
	.replace(/(\p{M}{2})\p{M}+/gu, '$1')
	.replace(/\s+/g, ' ')
	.replace(/(.)\1{5,}/gu, '$1$1$1$1$1')
	.trim();

const linkPattern = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|id|io|co|me|xyz|ly|gg|link|site|info|biz|app|tv|shop|online|top|club|icu|vip|live)\b)/i;
export const hasLink = (text: string) => linkPattern.test(text);

export const emojiCount = (text: string) => text.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;

/** A comparison key for duplicate detection. */
export const duplicateKey = (text: string) => text.split(' ').map(normalizeWord).join(' ');

export type FilterResult = { ok: true; text: string } | { ok: false };

export const filterText = (text: string, blocklist: Blocklist): FilterResult => {
	const mild = normalizeList(blocklist.mild);
	const severe = normalizeList(blocklist.severe);
	const parts = text.split(/(\s+)/);
	const words = parts.filter((_, index) => index % 2 === 0);

	// Long words are distinctive enough to catch inside other words; short ones need an exact stem, or "peler" would catch "pelerai".
	const isSevere = (word: string) => [...severe].some((entry) => entry.length >= 6 ? word.includes(entry) : matchesWithAffixes(word, severe));

	// Spelled-out words ("k o n t o l") are joined before checking.
	let run: string[] = [];
	const checkRun = () => {
		if (run.length >= 3) {
			const joined = normalizeWord(run.join(''));
			if (isSevere(joined)) return false;
		}
		run = [];
		return true;
	};
	for (const word of words) {
		if ([...word].length === 1) run.push(word);
		else if (!checkRun()) return { ok: false };
	}
	if (!checkRun()) return { ok: false };

	const masked: string[] = [];
	for (const [index, part] of parts.entries()) {
		const word = index % 2 === 0 ? normalizeWord(part) : '';
		if (!word) {
			masked.push(part);
			continue;
		}
		if (isSevere(word)) return { ok: false };
		const characters = [...part];
		masked.push(matchesWithAffixes(word, mild) ? characters[0] + '*'.repeat(Math.max(2, characters.length - 1)) : part);
	}
	return { ok: true, text: masked.join('') };
};
