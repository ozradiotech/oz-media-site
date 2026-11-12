// Encryption for the YouTube refresh token at rest (AES-256-GCM), plus the small hashing helpers the sync uses.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** YOUTUBE_TOKEN_ENCRYPTION_KEY: 32 bytes as 64 hex characters or base64. Throws on anything else. */
export const parseEncryptionKey = (value: string): Buffer => {
	const trimmed = value.trim();
	const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
	if (key.length !== 32) throw new Error('YOUTUBE_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters, or base64).');
	return key;
};

/** `v1.<iv>.<tag>.<ciphertext>`, base64url. */
export const encryptSecret = (plain: string, key: Buffer) => {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return ['v1', iv, cipher.getAuthTag(), ciphertext].map((part) => typeof part === 'string' ? part : part.toString('base64url')).join('.');
};

export const decryptSecret = (sealed: string, key: Buffer) => {
	const [version, iv, tag, ciphertext] = sealed.split('.');
	if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unknown encrypted token format.');
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
	decipher.setAuthTag(Buffer.from(tag, 'base64url'));
	return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
};

/** A database-safe key for an id that may hold characters the database refuses (YouTube ids have dots). */
export const hashKey = (value: string, length = 22) => createHash('sha256').update(value).digest('base64url').slice(0, length);

export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

export const safeEqual = (a: string, b: string) => {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
};
