import { t as __exportAll } from "./rolldown-runtime_D7D4PA-g.mjs";
import { randomBytes } from "node:crypto";
//#region src/pages/api/cms-auth.ts
var cms_auth_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
var callbackPath = "/api/cms-callback";
var stateCookieName = "oz_cms_oauth_state";
function getOAuthConfig() {
	const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
	const baseUrlValue = process.env.CMS_OAUTH_BASE_URL?.trim();
	if (!clientId || !process.env.GITHUB_OAUTH_CLIENT_SECRET || !baseUrlValue) return null;
	try {
		const baseUrl = new URL(baseUrlValue);
		if (baseUrl.protocol !== "https:" || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password || baseUrl.origin !== baseUrlValue) return null;
		return {
			clientId,
			baseUrl: baseUrl.origin
		};
	} catch {
		return null;
	}
}
var GET = ({ request }) => {
	if (new URL(request.url).searchParams.get("provider") !== "github") return new Response("Unsupported OAuth provider.", { status: 400 });
	const config = getOAuthConfig();
	if (!config) return new Response("CMS OAuth is not configured. Check the Vercel environment variables.", { status: 503 });
	const state = randomBytes(32).toString("hex");
	const redirectUri = `${config.baseUrl}${callbackPath}`;
	const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
	authorizeUrl.searchParams.set("client_id", config.clientId);
	authorizeUrl.searchParams.set("redirect_uri", redirectUri);
	authorizeUrl.searchParams.set("scope", "repo,user");
	authorizeUrl.searchParams.set("state", state);
	return new Response(null, {
		status: 302,
		headers: {
			Location: authorizeUrl.toString(),
			"Cache-Control": "no-store",
			"Set-Cookie": `${stateCookieName}=${state}; Path=${callbackPath}; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
		}
	});
};
//#endregion
//#region \0virtual:astro:page:src/pages/api/cms-auth@_@ts
var page = () => cms_auth_exports;
//#endregion
export { page };
