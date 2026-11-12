// Access tokens for the connected channel. The refresh token is read from the database and decrypted only here, and
// each access token is reused until shortly before it expires, so the token endpoint is called about once an hour.
import { refreshAccessToken, YoutubeApiError, type FetchLike, type OAuthConfig } from './api.ts';
import { decryptSecret } from './crypto.ts';
import { paths } from './paths.ts';
import type { Clock, StoredAuth, Store } from './types.ts';

export type Credentials = {
	accessToken(force?: boolean): Promise<string>;
	/** Forget the cached token and auth record, e.g. after a disconnect. */
	reset(): void;
};

export const createCredentials = (options: {
	store: Store;
	oauth: OAuthConfig;
	encryptionKey: Buffer;
	clock: Clock;
	fetch?: FetchLike;
}): Credentials => {
	let cached: { token: string; expiresAt: number; refreshToken: string } | undefined;
	let inFlight: Promise<string> | undefined;

	const refresh = async () => {
		const auth = await options.store.get<StoredAuth>(paths.auth);
		if (!auth?.refreshToken || auth.status === 'revoked') {
			throw new YoutubeApiError('auth_revoked', 401, 'not_connected', 'The YouTube channel is not connected.');
		}
		const refreshToken = decryptSecret(auth.refreshToken, options.encryptionKey);
		try {
			const response = await refreshAccessToken(options.oauth, refreshToken, options.fetch);
			cached = { token: response.access_token, expiresAt: options.clock.now() + response.expires_in * 1000, refreshToken };
			return cached.token;
		} catch (error) {
			if (error instanceof YoutubeApiError && error.kind === 'auth_revoked') {
				// Revoked in the Google account, or expired: an admin has to connect again.
				await options.store.patch(paths.auth, { status: 'revoked' }).catch(() => undefined);
			}
			throw error;
		}
	};

	return {
		async accessToken(force = false) {
			if (!force && cached && cached.expiresAt - 60_000 > options.clock.now()) return cached.token;
			inFlight ??= refresh().finally(() => {
				inFlight = undefined;
			});
			return inFlight;
		},
		reset() {
			cached = undefined;
		},
	};
};
