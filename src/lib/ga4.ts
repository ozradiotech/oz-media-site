// Server only. Reads reports from Google Analytics 4 (the GA4 Data API) for the Website panel on /analytics.
//
// Setup, once: GA_PROPERTY_ID in .env (GA4 → Admin → Property details), the "Google Analytics Data API" enabled for
// the oz-media-site Google Cloud project, and the service account in FIREBASE_SERVICE_ACCOUNT added as a Viewer in
// GA4 → Admin → Property access management. The server signs in as that service account with read-only access to
// Analytics only; no other key is needed.
import { createSign } from 'node:crypto';
import { FIREBASE_SERVICE_ACCOUNT, GA_PROPERTY_ID } from 'astro:env/server';
import { ChatError, parseServiceAccount } from './chat-server';

export const gaPropertyId = GA_PROPERTY_ID?.trim() ?? '';
export const isGaConfigured = Boolean(/^\d+$/.test(gaPropertyId) && FIREBASE_SERVICE_ACCOUNT);

const scope = 'https://www.googleapis.com/auth/analytics.readonly';
let token: { value: string; expiresAt: number } | undefined;

// A signed request (JWT) for a one-hour token, as Google's own client libraries do.
const accessToken = async () => {
	if (token && token.expiresAt - 60_000 > Date.now()) return token.value;
	const account = parseServiceAccount(FIREBASE_SERVICE_ACCOUNT ?? '');
	const email = String(account.client_email ?? '');
	const key = String(account.private_key ?? '');
	const tokenUri = String(account.token_uri ?? 'https://oauth2.googleapis.com/token');
	const now = Math.floor(Date.now() / 1000);
	const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: email, scope, aud: tokenUri, iat: now, exp: now + 3600 })}`;
	const assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url')}`;
	const response = await fetch(tokenUri, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
	});
	const result = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
	if (!response.ok || !result.access_token) throw new ChatError(502, `Google sign-in for the analytics failed: ${result.error_description ?? response.status}`);
	token = { value: result.access_token, expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000 };
	return token.value;
};

export type GaReportRequest = {
	dimensions: string[];
	metrics: string[];
	orderBy?: { metric?: string; dimension?: string; desc?: boolean };
	limit?: number;
	/** Rows whose first dimension is one of these are left out (e.g. "(not set)"). */
	exclude?: string[];
};

export type GaRow = Record<string, string | number>;

/** Explains Google's usual setup errors in plain words. */
const explain = (status: number, message: string) => {
	if (/has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
		return 'The Google Analytics Data API is not enabled. In the Google Cloud console for project oz-media-site, enable "Google Analytics Data API".';
	}
	if (status === 403 || /permission/i.test(message)) {
		return 'The server is not allowed to read this GA4 property. In GA4 → Admin → Property access management, add the service account as a Viewer.';
	}
	return `Google Analytics answered: ${message}`;
};

export const runReport = async (request: GaReportRequest, startDate: string, endDate: string): Promise<GaRow[]> => {
	const body: Record<string, unknown> = {
		dateRanges: [{ startDate, endDate }],
		dimensions: request.dimensions.map((name) => ({ name })),
		metrics: request.metrics.map((name) => ({ name })),
		limit: request.limit ?? 1000,
	};
	if (request.orderBy?.metric) body.orderBys = [{ metric: { metricName: request.orderBy.metric }, desc: request.orderBy.desc ?? true }];
	if (request.orderBy?.dimension) body.orderBys = [{ dimension: { dimensionName: request.orderBy.dimension }, desc: request.orderBy.desc ?? false }];
	if (request.exclude?.length) {
		body.dimensionFilter = { notExpression: { filter: { fieldName: request.dimensions[0], inListFilter: { values: request.exclude } } } };
	}

	const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${gaPropertyId}:runReport`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const result = await response.json().catch(() => ({})) as {
		rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
		error?: { message?: string };
	};
	if (!response.ok) throw new ChatError(502, explain(response.status, result.error?.message ?? String(response.status)));
	return (result.rows ?? []).map((row) => {
		const out: GaRow = {};
		request.dimensions.forEach((name, index) => { out[name] = row.dimensionValues?.[index]?.value ?? ''; });
		request.metrics.forEach((name, index) => { out[name] = Number(row.metricValues?.[index]?.value ?? 0); });
		return out;
	});
};
