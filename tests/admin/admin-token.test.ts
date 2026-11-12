// The tokens the CMS signs for its Station pages (oz-cms src/siteBridge.ts), as the site checks them.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';
import { safeReturnTo, signAdminToken, verifyAdminToken, type AdminTokenPayload } from '../../src/lib/admin-token.ts';

const secret = 'a'.repeat(64);
const now = Date.parse('2026-11-12T12:00:00Z');
const payload: AdminTokenPayload = { email: 'Dev@OZRadio.test', roles: ['developer'], purpose: 'admin', exp: now + 60_000 };

// The CMS builds its tokens without this module; this mirrors oz-cms src/siteBridge.ts byte for byte.
const signLikeCms = (data: object, key: string) => {
	const body = Buffer.from(JSON.stringify(data)).toString('base64url');
	return `v1.${body}.${createHmac('sha256', key).update(`v1.${body}`).digest('base64url')}`;
};

describe('CMS admin tokens', () => {
	test('a token signed by the CMS is accepted, with the email lowercased', () => {
		const verified = verifyAdminToken(signLikeCms(payload, secret), secret, 'admin', now);
		assert.equal(verified?.email, 'dev@ozradio.test');
		assert.deepEqual(verified?.roles, ['developer']);
		assert.equal(signAdminToken(payload, secret), signLikeCms(payload, secret));
	});

	test('expired, tampered, wrongly signed or wrong-purpose tokens are refused', () => {
		const token = signAdminToken(payload, secret);
		assert.equal(verifyAdminToken(token, secret, 'admin', now + 61_000), null, 'expired');
		assert.equal(verifyAdminToken(token, 'b'.repeat(64), 'admin', now), null, 'other secret');
		assert.equal(verifyAdminToken(token, secret, 'connect', now), null, 'other purpose');
		const [version, , signature] = token.split('.');
		const forged = Buffer.from(JSON.stringify({ ...payload, roles: ['developer', 'digital'] })).toString('base64url');
		assert.equal(verifyAdminToken(`${version}.${forged}.${signature}`, secret, 'admin', now), null, 'payload changed');
		assert.equal(verifyAdminToken('garbage', secret, 'admin', now), null);
		assert.equal(verifyAdminToken('', secret, 'admin', now), null);
	});

	test('no secret, or a short one, accepts nothing', () => {
		assert.equal(verifyAdminToken(signAdminToken(payload, 'short'), 'short', 'admin', now), null);
		assert.equal(verifyAdminToken(signAdminToken(payload, secret), undefined, 'admin', now), null);
	});

	test('only admin pages are followed back after connecting', () => {
		assert.equal(safeReturnTo('https://cms.ozmedianet.com/admin/youtube'), 'https://cms.ozmedianet.com/admin/youtube');
		assert.equal(safeReturnTo('http://localhost:3000/admin/youtube'), 'http://localhost:3000/admin/youtube');
		assert.equal(safeReturnTo('javascript:alert(1)'), null);
		assert.equal(safeReturnTo('https://evil.example/phish'), null);
		assert.equal(safeReturnTo(42), null);
	});
});
