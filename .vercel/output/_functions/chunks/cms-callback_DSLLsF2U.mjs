import { t as __exportAll } from "./rolldown-runtime_D7D4PA-g.mjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
//#region src/pages/api/cms-callback.ts
var cms_callback_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
var callbackPath = "/api/cms-callback";
var stateCookieName = "oz_cms_oauth_state";
function getOAuthConfig() {
	const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
	const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
	const baseUrlValue = process.env.CMS_OAUTH_BASE_URL?.trim();
	if (!clientId || !clientSecret || !baseUrlValue) return null;
	try {
		const baseUrl = new URL(baseUrlValue);
		if (baseUrl.protocol !== "https:" || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password || baseUrl.origin !== baseUrlValue) return null;
		return {
			clientId,
			clientSecret,
			baseUrl: baseUrl.origin
		};
	} catch {
		return null;
	}
}
function readCookie(request, name) {
	const cookie = request.headers.get("cookie");
	if (!cookie) return void 0;
	return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
function clearStateCookie() {
	return `${stateCookieName}=; Path=${callbackPath}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
function errorResponse(message, status, headers) {
	return new Response(message, {
		status,
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
			...headers
		}
	});
}
function callbackPage(token, allowedOrigin) {
	const nonce = randomBytes(18).toString("base64");
	const successMessage = JSON.stringify(`authorization:github:success:${JSON.stringify({ token })}`).replace(/</g, "\\u003c");
	const html = `<!doctype html>
<html lang="en">
	<head><meta charset="utf-8"><title>GitHub authorization</title></head>
	<body>
		<p>Completing Decap CMS authorization…</p>
		<script nonce="${nonce}">
			const allowedOrigin = ${JSON.stringify(allowedOrigin)};
			const successMessage = ${JSON.stringify(successMessage)};
			const receiveAuthorizationRequest = (event) => {
				if (event.source !== window.opener || event.origin !== allowedOrigin) return;
				window.opener.postMessage(successMessage, allowedOrigin);
				window.removeEventListener('message', receiveAuthorizationRequest);
				window.close();
			};
			window.addEventListener('message', receiveAuthorizationRequest);
			if (window.opener) window.opener.postMessage('authorizing:github', allowedOrigin);
		<\/script>
	</body>
</html>`;
	return new Response(html, { headers: {
		"Cache-Control": "no-store",
		"Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'self'`,
		"Content-Type": "text/html; charset=utf-8",
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff"
	} });
}
var GET = async ({ request }) => {
	const config = getOAuthConfig();
	if (!config) return errorResponse("CMS OAuth is not configured. Check the Vercel environment variables.", 503, { "Set-Cookie": clearStateCookie() });
	const url = new URL(request.url);
	const receivedState = url.searchParams.get("state") ?? "";
	const savedState = readCookie(request, stateCookieName) ?? "";
	if (!/^[0-9a-f]{64}$/.test(receivedState) || !/^[0-9a-f]{64}$/.test(savedState)) return errorResponse("The OAuth state is missing or invalid. Close this window and try again.", 400, { "Set-Cookie": clearStateCookie() });
	if (!timingSafeEqual(Buffer.from(receivedState), Buffer.from(savedState))) return errorResponse("The OAuth state did not match. Close this window and try again.", 400, { "Set-Cookie": clearStateCookie() });
	if (url.searchParams.get("error")) return errorResponse("GitHub authorization was cancelled or denied.", 400, { "Set-Cookie": clearStateCookie() });
	const code = url.searchParams.get("code");
	if (!code) return errorResponse("GitHub did not return an authorization code.", 400, { "Set-Cookie": clearStateCookie() });
	let tokenResponse;
	try {
		const response = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				client_id: config.clientId,
				client_secret: config.clientSecret,
				code,
				redirect_uri: `${config.baseUrl}${callbackPath}`
			}),
			signal: AbortSignal.timeout(1e4)
		});
		if (!response.ok) return errorResponse("GitHub could not complete CMS authorization. Try again.", 502, { "Set-Cookie": clearStateCookie() });
		tokenResponse = await response.json();
	} catch {
		return errorResponse("GitHub could not complete CMS authorization. Try again.", 502, { "Set-Cookie": clearStateCookie() });
	}
	if (!tokenResponse || typeof tokenResponse !== "object" || !("access_token" in tokenResponse) || typeof tokenResponse.access_token !== "string" || !tokenResponse.access_token) return errorResponse("GitHub did not return a valid CMS access token.", 502, { "Set-Cookie": clearStateCookie() });
	const response = callbackPage(tokenResponse.access_token, config.baseUrl);
	response.headers.append("Set-Cookie", clearStateCookie());
	return response;
};
//#endregion
//#region \0virtual:astro:page:src/pages/api/cms-callback@_@ts
var page = () => cms_callback_exports;
//#endregion
export { page };
