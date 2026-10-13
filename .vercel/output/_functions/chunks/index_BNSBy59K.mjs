import { t as __exportAll } from "./rolldown-runtime_D7D4PA-g.mjs";
import { g as addAttribute, h as renderHead, p as renderTemplate } from "./server_CxAySB2c.mjs";
import { t as createComponent } from "./compiler_BQ9KRhSE.mjs";
//#region src/pages/index.astro
var pages_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => ""
});
var $$Index = createComponent(($$result, $$props, $$slots) => {
	const locations = [{
		name: "Bandung",
		href: "/oz-bandung/",
		logo: "/images/logo-oz-bandung.png"
	}, {
		name: "Bali",
		href: "/oz-bali/",
		logo: "/images/logo-oz-bali.png"
	}];
	return renderTemplate`<html lang="en" data-astro-cid-lcdefpme><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="theme-color" content="#FFFFF3"><meta name="description" content="Location select for OZ Radio"><title>OZ Radio — Choose your frequency</title>${renderHead($$result)}</head><body data-astro-cid-lcdefpme><main class="landing" data-astro-cid-lcdefpme><header class="topbar" data-astro-cid-lcdefpme><a class="wordmark" href="/" aria-label="OZ Radio home" data-astro-cid-lcdefpme><img src="/images/logo-oz-media.png" alt="OZ Media" data-astro-cid-lcdefpme></a><nav class="topbar-nav" aria-label="Locations" data-astro-cid-lcdefpme>${locations.map((location) => renderTemplate`<a class="topbar-nav-link"${addAttribute(location.href, "href")} data-astro-cid-lcdefpme>${location.name}</a>`)}</nav></header><section class="chooser" aria-labelledby="page-title" data-astro-cid-lcdefpme><h1 id="page-title" data-astro-cid-lcdefpme><img src="/images/logo-oz-media.png" alt="OZ Media" data-astro-cid-lcdefpme></h1><p class="intro" data-astro-cid-lcdefpme>Lorem ipsum dolor sit amet consectetur adipisicing elit. Optio, cum ullam? Quam at delectus maiores neque veritatis error quibusdam. Reprehenderit reiciendis aperiam odio eveniet iste, vel a quas nemo similique?</p><nav class="locations" aria-label="Choose a location" data-astro-cid-lcdefpme>${locations.map((location) => renderTemplate`<div class="location-item" data-astro-cid-lcdefpme><a class="location-link"${addAttribute(location.href, "href")}${addAttribute(`OZ Radio ${location.name}`, "aria-label")} data-astro-cid-lcdefpme><img class="location-logo"${addAttribute(location.logo, "src")} alt="" data-astro-cid-lcdefpme></a></div>`)}</nav></section></main></body></html>`;
}, "D:/Work/oz-proto/src/pages/index.astro", void 0);
var $$file = "D:/Work/oz-proto/src/pages/index.astro";
//#endregion
//#region \0virtual:astro:page:src/pages/index@_@astro
var page = () => pages_exports;
//#endregion
export { page };
