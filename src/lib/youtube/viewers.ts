// Website viewers: people whose embedded YouTube player is actually playing the livestream on our page. The page sends
// a heartbeat while it plays (only one tab per browser, see src/scripts/oz-live-viewers.ts) and says when it stops;
// sessions that go quiet expire. Sessions are random ids made fresh for each playback: no account, name or cookie.
// This is our own estimate. It is not YouTube's concurrent viewer count, which measures YouTube's whole audience.
import { paths } from './paths.ts';
import type { Clock, Store } from './types.ts';

export type ViewerConfig = { heartbeatMs: number; ttlMs: number; maxSessionsPerAddress: number };

export const isSessionId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{16,64}$/.test(value);

/** Sessions per (hashed) address, in this process, so one machine can't pose as a crowd. */
export class AddressLimiter {
	private readonly sessions = new Map<string, Map<string, number>>();
	private readonly limit: number;
	constructor(limit: number) {
		this.limit = limit;
	}
	allow(address: string, session: string, now: number, ttlMs: number) {
		const own = this.sessions.get(address) ?? new Map<string, number>();
		for (const [id, until] of own) if (until <= now) own.delete(id);
		if (!own.has(session) && own.size >= this.limit) return false;
		own.set(session, now + ttlMs);
		this.sessions.set(address, own);
		return true;
	}
	release(address: string, session: string) {
		this.sessions.get(address)?.delete(session);
	}
}

/** A heartbeat (`playing`) or a stop. Only counts while the livestream is actually live. */
export const recordHeartbeat = async (
	store: Store,
	clock: Clock,
	config: ViewerConfig,
	limiter: AddressLimiter,
	input: { session: string; playing: boolean; address: string; live: boolean },
) => {
	const path = `${paths.viewers}/${input.session}`;
	if (!input.playing || !input.live) {
		limiter.release(input.address, input.session);
		await store.remove(path);
		return { counted: false };
	}
	const now = clock.now();
	if (!limiter.allow(input.address, input.session, now, config.ttlMs)) return { counted: false };
	await store.put(path, now + config.ttlMs);
	return { counted: true };
};

/** Live sessions now, and removes the expired ones. Null if the registry couldn't be read: unknown, not zero. */
export const countViewers = async (store: Store, clock: Clock): Promise<number | null> => {
	let sessions: Record<string, number> | null;
	try {
		sessions = await store.get<Record<string, number>>(paths.viewers);
	} catch {
		return null;
	}
	const now = clock.now();
	const expired: Record<string, null> = {};
	let count = 0;
	for (const [session, until] of Object.entries(sessions ?? {})) {
		if (typeof until === 'number' && until > now) count++;
		else expired[session] = null;
	}
	if (Object.keys(expired).length) await store.patch(paths.viewers, expired).catch(() => undefined);
	return count;
};
