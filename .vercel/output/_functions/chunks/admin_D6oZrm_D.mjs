import { t as __exportAll } from "./rolldown-runtime_D7D4PA-g.mjs";
import { h as renderHead, p as renderTemplate } from "./server_CxAySB2c.mjs";
import { t as createComponent } from "./compiler_BQ9KRhSE.mjs";
//#region src/pages/admin.astro
var admin_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Admin,
	file: () => $$file,
	url: () => $$url
});
var $$Admin = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="/admin/config.yml" type="text/yaml" rel="cms-config-url"><title>OZ Radio Bandung CMS</title>${renderHead($$result)}</head><body><script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js"><\/script></body></html>`;
}, "D:/Work/oz-proto/src/pages/admin.astro", void 0);
var $$file = "D:/Work/oz-proto/src/pages/admin.astro";
var $$url = "/admin";
//#endregion
//#region \0virtual:astro:page:src/pages/admin@_@astro
var page = () => admin_exports;
//#endregion
export { page };
