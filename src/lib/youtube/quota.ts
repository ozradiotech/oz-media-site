// YouTube's quota resets at midnight Pacific time. This keeps a running count of what the sync has spent today, so it
// can stop before running out; the API's own quotaExceeded answer is still what decides.
import { quotaCost, type QuotaCall } from './api.ts';

const pacificDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD in Pacific time. */
export const quotaDay = (time: number) => pacificDay.format(time);

/** The first moment of the next Pacific day (to within a minute). */
export const nextQuotaReset = (time: number) => {
	const today = quotaDay(time);
	let low = time;
	let high = time + 26 * 3_600_000;
	while (high - low > 60_000) {
		const middle = Math.floor((low + high) / 2);
		if (quotaDay(middle) === today) low = middle;
		else high = middle;
	}
	return high;
};

export type QuotaRecord = { day: string; used: number; exhaustedUntil?: number };

export class QuotaTracker {
	record: QuotaRecord;
	private readonly dailyLimit: number;
	constructor(dailyLimit: number, record: QuotaRecord | null, now: number) {
		this.dailyLimit = dailyLimit;
		this.record = record && record.day === quotaDay(now) ? { ...record } : { day: quotaDay(now), used: 0 };
	}

	private roll(now: number) {
		const day = quotaDay(now);
		if (this.record.day !== day) this.record = { day, used: 0 };
		if (this.record.exhaustedUntil && this.record.exhaustedUntil <= now) delete this.record.exhaustedUntil;
	}

	spend(call: QuotaCall, now: number) {
		this.roll(now);
		this.record.used += quotaCost[call];
	}

	/** YouTube said the quota is gone: nothing more until it resets. */
	exhaust(now: number) {
		this.roll(now);
		this.record.exhaustedUntil = nextQuotaReset(now);
	}

	isExhausted(now: number) {
		this.roll(now);
		return Boolean(this.record.exhaustedUntil);
	}

	/** Whether `call` still fits, keeping `reserve` units back for detection and the reader. */
	canSpend(call: QuotaCall, now: number, reserve = 0) {
		this.roll(now);
		return !this.record.exhaustedUntil && this.record.used + quotaCost[call] + reserve <= this.dailyLimit;
	}
}
