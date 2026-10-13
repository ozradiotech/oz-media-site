import { t as __exportAll } from "./rolldown-runtime_D7D4PA-g.mjs";
import { W as RenderUndefinedEntryError, X as UnknownContentCollectionError, et as AstroError } from "./errors-data_CHmM1-YF.mjs";
import { B as generateCspDigest, _ as createRenderInstruction, a as renderUniqueStylesheet, c as renderComponent, g as addAttribute, h as renderHead, i as renderScriptElement, n as templateEnter, p as renderTemplate, r as templateExit, t as spreadAttributes, w as unescapeHTML, x as createHeadAndContent } from "./server_CxAySB2c.mjs";
import { c as isRemotePath, d as removeBase, u as prependForwardSlash } from "./path_DW70cvEd.mjs";
import { t as createComponent } from "./compiler_BQ9KRhSE.mjs";
import { t as createConsoleLogger } from "./console_BS3552R5.mjs";
import { a as level, r as VALID_INPUT_FORMATS } from "./consts_DsksS5xH.mjs";
import * as z from "zod/v4";
import * as devalue from "devalue";
import { escape } from "html-escaper";
//#region node_modules/astro/dist/runtime/server/render/script.js
async function renderScript(result, id) {
	const inlined = result.inlinedScripts.get(id);
	let content = "";
	if (inlined != null) {
		if (inlined) content = `<script type="module">${inlined}<\/script>`;
	} else {
		const resolved = await result.resolve(id);
		content = `<script type="module" src="${result.userAssetsBase ? (result.base === "/" ? "" : result.base) + result.userAssetsBase : ""}${resolved}"><\/script>`;
	}
	return createRenderInstruction({
		type: "script",
		id,
		content
	});
}
//#endregion
//#region node_modules/astro/dist/assets/runtime.js
function createSvgComponent({ meta, attributes, children, styles }) {
	const hasStyles = styles.length > 0;
	const Component = createComponent({
		async factory(result, props) {
			const normalizedProps = normalizeProps(attributes, props);
			if (hasStyles && result.cspDestination) for (const style of styles) {
				const hash = await generateCspDigest(style, result.cspAlgorithm);
				result._metadata.extraStyleHashes.push(hash);
			}
			return renderTemplate`<svg${spreadAttributes(normalizedProps)}>${unescapeHTML(children)}</svg>`;
		},
		propagation: hasStyles ? "self" : "none"
	});
	Object.defineProperty(Component, "toJSON", {
		value: () => meta,
		enumerable: false
	});
	return Object.assign(Component, meta);
}
var ATTRS_TO_DROP = [
	"xmlns",
	"xmlns:xlink",
	"version"
];
var DEFAULT_ATTRS = {};
function dropAttributes(attributes) {
	for (const attr of ATTRS_TO_DROP) delete attributes[attr];
	return attributes;
}
function normalizeProps(attributes, props) {
	return dropAttributes({
		...DEFAULT_ATTRS,
		...attributes,
		...props
	});
}
var CONTENT_IMAGE_FLAG = "astroContentImageFlag";
var DATA_STORE_VIRTUAL_ID = "astro:data-layer-content";
"" + DATA_STORE_VIRTUAL_ID;
var IMAGE_IMPORT_PREFIX = "__ASTRO_IMAGE_";
`${DATA_STORE_VIRTUAL_ID}`;
//#endregion
//#region node_modules/astro/dist/assets/utils/resolveImports.js
function imageSrcToImportId(imageSrc, filePath) {
	imageSrc = removeBase(imageSrc, IMAGE_IMPORT_PREFIX);
	if (isRemotePath(imageSrc)) return;
	const ext = imageSrc.split(".").at(-1)?.toLowerCase();
	if (!ext || !VALID_INPUT_FORMATS.includes(ext)) return;
	const params = new URLSearchParams(CONTENT_IMAGE_FLAG);
	if (filePath) params.set("importer", filePath);
	return `${imageSrc}?${params.toString()}`;
}
//#endregion
//#region node_modules/astro/dist/core/render-scope/scope.js
var SCOPE_KEY = /* @__PURE__ */ Symbol.for("astro:render-scope");
function getInstalledRenderScope() {
	return globalThis[SCOPE_KEY];
}
//#endregion
//#region node_modules/astro/dist/core/render-scope/record.js
function recordContentEntryRender(filePath) {
	if (!filePath) return;
	getInstalledRenderScope()?.getStore()?.contentEntries?.add(filePath);
}
//#endregion
//#region node_modules/astro/dist/content/data-store-source.js
var InMemorySource = class {
	#store;
	constructor(store) {
		this.#store = store;
	}
	hasCollection(collection) {
		return this.#store.hasCollection(collection);
	}
	get(collection, key) {
		return this.#store.get(collection, key);
	}
	entries(collection) {
		return this.#store.entries(collection);
	}
	values(collection) {
		return this.#store.values(collection);
	}
	keys(collection) {
		return this.#store.keys(collection);
	}
	has(collection, key) {
		return this.#store.has(collection, key);
	}
	collections() {
		return this.#store.collections();
	}
};
//#endregion
//#region node_modules/astro/dist/content/data-store.js
var ChunkedCollectionParser = class {
	#entries = /* @__PURE__ */ new Map();
	#remainder = "";
	add(part) {
		const records = (this.#remainder + part).split("\n");
		this.#remainder = records.pop();
		for (const record of records) {
			const parsed = devalue.parse(record);
			if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string") throw new Error("Invalid chunked data store entry");
			this.#entries.set(parsed[0], parsed[1]);
		}
	}
	finish() {
		if (this.#remainder) throw new Error("Invalid chunked data store entry");
		return this.#entries;
	}
};
var ImmutableDataStore = class ImmutableDataStore {
	_collections = /* @__PURE__ */ new Map();
	constructor() {
		this._collections = /* @__PURE__ */ new Map();
	}
	get(collectionName, key) {
		return this._collections.get(collectionName)?.get(String(key));
	}
	entries(collectionName) {
		return [...(this._collections.get(collectionName) ?? /* @__PURE__ */ new Map()).entries()];
	}
	values(collectionName) {
		return [...(this._collections.get(collectionName) ?? /* @__PURE__ */ new Map()).values()];
	}
	keys(collectionName) {
		return [...(this._collections.get(collectionName) ?? /* @__PURE__ */ new Map()).keys()];
	}
	has(collectionName, key) {
		const collection = this._collections.get(collectionName);
		if (collection) return collection.has(String(key));
		return false;
	}
	hasCollection(collectionName) {
		return this._collections.has(collectionName);
	}
	collections() {
		return this._collections;
	}
	/**
	* Rebuilds a collections map from a chunked-store manifest whose part file
	* names have already been swapped for their contents.
	*
	* Each collection maps to a list of parts. A part is either a raw string
	* (when the store is loaded from disk) or an ESM namespace from a virtual
	* chunk import (`{ default: string }`, when emitted at runtime). Each part
	* contains independently serialized entry records. This is the inverse of
	* {@link import('./data-store-writer.js').ChunkedWriter} and stays free of
	* Node built-ins so it can run at runtime.
	*/
	static manifestToMap(manifest) {
		const collections = /* @__PURE__ */ new Map();
		for (const [collectionName, parts] of Object.entries(manifest)) {
			const parser = new ChunkedCollectionParser();
			for (const part of parts) parser.add(typeof part === "string" ? part : part.default);
			collections.set(collectionName, parser.finish());
		}
		return collections;
	}
	/**
	* Attempts to load a DataStore from the virtual module.
	* This only works in Vite.
	*/
	static async fromModule() {
		try {
			const data = await import("./_astro_data-layer-content_BAmUHBLJ.mjs");
			if (data.default instanceof Map) return ImmutableDataStore.fromMap(data.default);
			if (Array.isArray(data.default)) {
				const map2 = devalue.unflatten(data.default);
				return ImmutableDataStore.fromMap(map2);
			}
			const map = ImmutableDataStore.manifestToMap(data.default);
			return ImmutableDataStore.fromMap(map);
		} catch {}
		return new ImmutableDataStore();
	}
	static async fromMap(data) {
		const store = new ImmutableDataStore();
		store._collections = data;
		return store;
	}
};
function dataStoreSingleton() {
	let instance = void 0;
	return {
		get: async () => {
			if (!instance) instance = ImmutableDataStore.fromModule().then((store) => new InMemorySource(store));
			return instance;
		},
		set: (store) => {
			instance = new InMemorySource(store);
		}
	};
}
var globalDataStore = dataStoreSingleton();
//#endregion
//#region node_modules/astro/dist/content/loaders/errors.js
function formatZodError(error) {
	return error.issues.map((issue) => `  **${issue.path.join(".")}**: ${issue.message}`);
}
var LiveCollectionError = class LiveCollectionError extends Error {
	collection;
	message;
	cause;
	constructor(collection, message, cause) {
		super(message);
		this.collection = collection;
		this.message = message;
		this.cause = cause;
		this.name = "LiveCollectionError";
		if (cause?.stack) this.stack = cause.stack;
	}
	static is(error) {
		return error instanceof LiveCollectionError;
	}
};
var LiveEntryNotFoundError = class extends LiveCollectionError {
	constructor(collection, entryFilter) {
		super(collection, `Entry ${collection} \u2192 ${typeof entryFilter === "string" ? entryFilter : JSON.stringify(entryFilter)} was not found.`);
		this.name = "LiveEntryNotFoundError";
	}
	static is(error) {
		return error?.name === "LiveEntryNotFoundError";
	}
};
var LiveCollectionValidationError = class extends LiveCollectionError {
	constructor(collection, entryId, error) {
		super(collection, [
			`**${collection} \u2192 ${entryId}** data does not match the collection schema.
`,
			...formatZodError(error),
			""
		].join("\n"));
		this.name = "LiveCollectionValidationError";
	}
	static is(error) {
		return error?.name === "LiveCollectionValidationError";
	}
};
var LiveCollectionCacheHintError = class extends LiveCollectionError {
	constructor(collection, entryId, error) {
		super(collection, [
			`**${String(collection)}${entryId ? ` \u2192 ${String(entryId)}` : ""}** returned an invalid cache hint.
`,
			...formatZodError(error),
			""
		].join("\n"));
		this.name = "LiveCollectionCacheHintError";
	}
	static is(error) {
		return error?.name === "LiveCollectionCacheHintError";
	}
};
//#endregion
//#region node_modules/astro/dist/content/runtime.js
var cacheHintSchema = z.object({
	tags: z.array(z.string()).optional(),
	lastModified: z.date().optional()
});
async function parseLiveEntry(entry, schema, collection) {
	try {
		const parsed = await z.safeParseAsync(schema, entry.data);
		if (!parsed.success) return { error: new LiveCollectionValidationError(collection, entry.id, parsed.error) };
		if (entry.cacheHint) {
			const cacheHint = cacheHintSchema.safeParse(entry.cacheHint);
			if (!cacheHint.success) return { error: new LiveCollectionCacheHintError(collection, entry.id, cacheHint.error) };
			entry.cacheHint = cacheHint.data;
		}
		return { entry: {
			...entry,
			data: parsed.data
		} };
	} catch (error) {
		return { error: new LiveCollectionError(collection, `Unexpected error parsing entry ${entry.id} in collection ${collection}`, error) };
	}
}
function createGetCollection({ liveCollections, logger }) {
	return async function getCollection(collection, filter) {
		if (collection in liveCollections) throw new AstroError({
			...UnknownContentCollectionError,
			message: `Collection "${collection}" is a live collection. Use getLiveCollection() instead of getCollection().`
		});
		const hasFilter = typeof filter === "function";
		const store = await globalDataStore.get();
		if (await store.hasCollection(collection)) {
			const { default: imageAssetMap } = await import("./content-assets_DXqEyLLP.mjs");
			const result = [];
			for (const rawEntry of await store.values(collection)) {
				const data = resolveEntryData(rawEntry, imageAssetMap);
				let entry = {
					...rawEntry,
					data,
					collection
				};
				if (hasFilter && !filter(entry)) continue;
				result.push(entry);
			}
			return result;
		} else {
			logger.warn("content", `The collection ${JSON.stringify(collection)} does not exist or is empty. Please check your content config file for errors.`);
			return [];
		}
	};
}
function createGetEntry({ liveCollections, logger }) {
	return async function getEntry(collectionOrLookupObject, lookup) {
		let collection, lookupId;
		if (typeof collectionOrLookupObject === "string") {
			collection = collectionOrLookupObject;
			if (!lookup) throw new AstroError({
				...UnknownContentCollectionError,
				message: "`getEntry()` requires an entry identifier as the second argument."
			});
			lookupId = lookup;
		} else {
			collection = collectionOrLookupObject.collection;
			lookupId = "id" in collectionOrLookupObject ? collectionOrLookupObject.id : collectionOrLookupObject.slug;
		}
		if (collection in liveCollections) throw new AstroError({
			...UnknownContentCollectionError,
			message: `Collection "${collection}" is a live collection. Use getLiveEntry() instead of getEntry().`
		});
		if (typeof lookupId === "object") throw new AstroError({
			...UnknownContentCollectionError,
			message: `The entry identifier must be a string. Received object.`
		});
		const store = await globalDataStore.get();
		if (await store.hasCollection(collection)) {
			const entry = await store.get(collection, lookupId);
			if (!entry) {
				logger.warn("content", `Entry ${collection} → ${lookupId} was not found.`);
				return;
			}
			const { default: imageAssetMap } = await import("./content-assets_DXqEyLLP.mjs");
			const data = resolveEntryData(entry, imageAssetMap);
			const result = {
				...entry,
				data,
				collection
			};
			warnForPropertyAccess(logger, result.data, "slug", `[content] Attempted to access deprecated property on "${collection}" entry.
The "slug" property is no longer automatically added to entries. Please use the "id" property instead.`);
			warnForPropertyAccess(logger, result, "render", `[content] Invalid attempt to access "render()" method on "${collection}" entry.
To render an entry, use "render(entry)" from "astro:content".`);
			return result;
		}
	};
}
function warnForPropertyAccess(logger, entry, prop, message) {
	if (!(prop in entry)) {
		let _value = void 0;
		Object.defineProperty(entry, prop, {
			get() {
				if (_value === void 0) logger.error("content", message);
				return _value;
			},
			set(v) {
				_value = v;
			},
			enumerable: false
		});
	}
}
function createGetLiveCollection({ liveCollections }) {
	return async function getLiveCollection(collection, filter) {
		if (!(collection in liveCollections)) return { error: new LiveCollectionError(collection, `Collection "${collection}" is not a live collection. Use getCollection() instead of getLiveCollection() to load regular content collections.`) };
		try {
			const context = {
				filter,
				collection
			};
			const response = await liveCollections[collection].loader?.loadCollection?.(context);
			if (response && "error" in response) return { error: response.error };
			const { schema } = liveCollections[collection];
			let processedEntries = response.entries;
			if (schema) {
				const entryResults = await Promise.all(response.entries.map((entry) => parseLiveEntry(entry, schema, collection)));
				for (const result of entryResults) if (result.error) return { error: result.error };
				processedEntries = entryResults.map((result) => result.entry);
			}
			let cacheHint = response.cacheHint;
			if (cacheHint) {
				const cacheHintResult = cacheHintSchema.safeParse(cacheHint);
				if (!cacheHintResult.success) return { error: new LiveCollectionCacheHintError(collection, void 0, cacheHintResult.error) };
				cacheHint = cacheHintResult.data;
			}
			if (processedEntries.length > 0) {
				const entryTags = /* @__PURE__ */ new Set();
				let latestModified;
				for (const entry of processedEntries) if (entry.cacheHint) {
					if (entry.cacheHint.tags) entry.cacheHint.tags.forEach((tag) => entryTags.add(tag));
					if (entry.cacheHint.lastModified instanceof Date) {
						if (latestModified === void 0 || entry.cacheHint.lastModified > latestModified) latestModified = entry.cacheHint.lastModified;
					}
				}
				if (entryTags.size > 0 || latestModified || cacheHint) {
					const mergedCacheHint = {};
					if (cacheHint?.tags || entryTags.size > 0) mergedCacheHint.tags = [.../* @__PURE__ */ new Set([...cacheHint?.tags || [], ...entryTags])];
					if (cacheHint?.lastModified && latestModified) mergedCacheHint.lastModified = cacheHint.lastModified > latestModified ? cacheHint.lastModified : latestModified;
					else if (cacheHint?.lastModified || latestModified) mergedCacheHint.lastModified = cacheHint?.lastModified ?? latestModified;
					cacheHint = mergedCacheHint;
				}
			}
			return {
				entries: processedEntries,
				cacheHint
			};
		} catch (error) {
			return { error: new LiveCollectionError(collection, `Unexpected error loading collection ${collection}${error instanceof Error ? `: ${error.message}` : ""}`, error) };
		}
	};
}
function createGetLiveEntry({ liveCollections }) {
	return async function getLiveEntry(collection, lookup) {
		if (!(collection in liveCollections)) return { error: new LiveCollectionError(collection, `Collection "${collection}" is not a live collection. Use getCollection() instead of getLiveEntry() to load regular content collections.`) };
		try {
			const lookupObject = {
				filter: typeof lookup === "string" ? { id: lookup } : lookup,
				collection
			};
			let entry = await liveCollections[collection].loader?.loadEntry?.(lookupObject);
			if (entry && "error" in entry) return { error: entry.error };
			if (!entry) return { error: new LiveEntryNotFoundError(collection, lookup) };
			const { schema } = liveCollections[collection];
			if (schema) {
				const result = await parseLiveEntry(entry, schema, collection);
				if (result.error) return { error: result.error };
				entry = result.entry;
			}
			return {
				entry,
				cacheHint: entry.cacheHint
			};
		} catch (error) {
			return { error: new LiveCollectionError(collection, `Unexpected error loading entry ${collection} → ${typeof lookup === "string" ? lookup : JSON.stringify(lookup)}`, error) };
		}
	};
}
var CONTENT_LAYER_IMAGE_REGEX = /__ASTRO_IMAGE_="([^"]+)"/g;
async function updateImageReferencesInBody(html, fileName) {
	const { default: imageAssetMap } = await import("./content-assets_DXqEyLLP.mjs");
	const imageObjects = /* @__PURE__ */ new Map();
	const { getImage } = await import("./_virtual_astro_get-image_DcL2AFIe.mjs");
	for (const [_full, imagePath] of html.matchAll(CONTENT_LAYER_IMAGE_REGEX)) try {
		const decodedImagePath = JSON.parse(imagePath.replace(/&(?:#x22|quot);/g, "\"").replace(/&(?:#x27|apos);/g, "'").replace(/&(?:amp|#x26|#38);/g, "&"));
		let image;
		if (URL.canParse(decodedImagePath.src)) image = await getImage(decodedImagePath);
		else {
			const id = imageSrcToImportId(decodedImagePath.src, fileName);
			const imported = imageAssetMap.get(id);
			if (!id || imageObjects.has(id) || !imported) continue;
			image = await getImage({
				...decodedImagePath,
				src: imported
			});
		}
		imageObjects.set(imagePath, image);
	} catch {
		throw new Error(`Failed to parse image reference: ${imagePath}`);
	}
	return html.replaceAll(CONTENT_LAYER_IMAGE_REGEX, (full, imagePath) => {
		const image = imageObjects.get(imagePath);
		if (!image) return full;
		const { index, ...attributes } = image.attributes;
		return Object.entries({
			...attributes,
			src: image.src,
			...image.srcSet.values.length > 0 ? { srcset: image.srcSet.attribute } : {}
		}).filter(([, value]) => value != null).map(([key, value]) => value === "" ? `${key}=""` : `${key}="${escape(String(value))}"`).join(" ");
	});
}
function resolveImageAtPath(src, fileName, imageAssetMap) {
	const id = imageSrcToImportId(src, fileName);
	if (!id) return;
	const imported = imageAssetMap?.get(id);
	if (!imported) return;
	if (imported.__svgData) {
		const { __svgData: svgData, ...meta } = imported;
		return createSvgComponent({
			meta,
			...svgData
		});
	}
	return imported;
}
function setAtPathCopying(target, path, value) {
	if (path.length === 0) return target;
	const [key, ...rest] = path;
	const copy = Array.isArray(target) ? target.slice() : { ...target };
	copy[key] = rest.length === 0 ? value : setAtPathCopying(copy[key], rest, value);
	return copy;
}
function updateImageReferencesInData(data, fileName, imageAssetMap, imageImports) {
	if (!imageImports?.length) return data;
	let result = data;
	for (const path of imageImports) {
		let src = result;
		for (const key of path) src = src?.[key];
		if (typeof src !== "string") continue;
		const resolved = resolveImageAtPath(src, fileName, imageAssetMap);
		if (resolved !== void 0) result = setAtPathCopying(result, path, resolved);
	}
	return result;
}
function resolveEntryData(entry, imageAssetMap) {
	return updateImageReferencesInData(entry.data, entry.filePath, imageAssetMap, entry.imageImports);
}
function createRenderEntry({ logger }) {
	return async function renderEntry(entry) {
		if (!entry) throw new AstroError(RenderUndefinedEntryError);
		recordContentEntryRender(entry.filePath);
		if (entry.deferredRender) try {
			const { default: contentModules } = await import("./content-modules_I7QRxwaA.mjs");
			const renderEntryImport = contentModules.get(entry.filePath);
			return render$1({
				collection: "",
				id: entry.id,
				renderEntryImport
			});
		} catch (e) {
			logger.error("content", `${e}`);
		}
		const html = entry?.rendered?.metadata?.imagePaths?.length && entry.filePath ? await updateImageReferencesInBody(entry.rendered.html, entry.filePath) : entry?.rendered?.html;
		return {
			Content: createComponent(() => renderTemplate`${unescapeHTML(html)}`),
			headings: entry?.rendered?.metadata?.headings ?? [],
			remarkPluginFrontmatter: entry?.rendered?.metadata?.frontmatter ?? {}
		};
	};
}
async function render$1({ collection, id, renderEntryImport }) {
	const UnexpectedRenderError = new AstroError({
		...UnknownContentCollectionError,
		message: `Unexpected error while rendering ${String(collection)} → ${String(id)}.`
	});
	if (typeof renderEntryImport !== "function") throw UnexpectedRenderError;
	const baseMod = await renderEntryImport();
	if (baseMod == null || typeof baseMod !== "object") throw UnexpectedRenderError;
	const { default: defaultMod } = baseMod;
	if (isPropagatedAssetsModule(defaultMod)) {
		const { collectedStyles, collectedLinks, collectedScripts, getMod } = defaultMod;
		if (typeof getMod !== "function") throw UnexpectedRenderError;
		const propagationMod = await getMod();
		if (propagationMod == null || typeof propagationMod !== "object") throw UnexpectedRenderError;
		return {
			Content: createComponent({
				factory(result, baseProps, slots) {
					let styles = "", links = "", scripts = "";
					if (Array.isArray(collectedStyles)) styles = collectedStyles.map((style) => {
						const content = typeof style === "string" ? style : style.content;
						const viteDevId = typeof style === "object" && style.id ? style.id : void 0;
						return renderUniqueStylesheet(result, {
							type: "inline",
							content,
							viteDevId
						});
					}).join("");
					if (Array.isArray(collectedLinks)) links = collectedLinks.map((link) => {
						return renderUniqueStylesheet(result, {
							type: "external",
							src: isRemotePath(link) ? link : prependForwardSlash(link)
						});
					}).join("");
					if (Array.isArray(collectedScripts)) scripts = collectedScripts.map((script) => renderScriptElement(script)).join("");
					let props = baseProps;
					if (id.endsWith("mdx")) props = {
						components: propagationMod.components ?? {},
						...baseProps
					};
					return createHeadAndContent(unescapeHTML(styles + links + scripts), renderTemplate`${renderComponent(result, "Content", propagationMod.Content, props, slots)}`);
				},
				propagation: "self"
			}),
			headings: propagationMod.getHeadings?.() ?? [],
			remarkPluginFrontmatter: propagationMod.frontmatter ?? {}
		};
	} else if (baseMod.Content && typeof baseMod.Content === "function") return {
		Content: baseMod.Content,
		headings: baseMod.getHeadings?.() ?? [],
		remarkPluginFrontmatter: baseMod.frontmatter ?? {}
	};
	else throw UnexpectedRenderError;
}
function isPropagatedAssetsModule(module) {
	return typeof module === "object" && module != null && "__astroPropagation" in module;
}
//#endregion
//#region \0astro:content
var liveCollections = {};
var logger = createConsoleLogger({ level });
var getCollection = createGetCollection({
	liveCollections,
	logger
});
createGetEntry({
	liveCollections,
	logger
});
var render = createRenderEntry({ logger });
createGetLiveCollection({ liveCollections });
createGetLiveEntry({ liveCollections });
//#endregion
//#region src/pages/oz-bandung.astro
var oz_bandung_exports = /* @__PURE__ */ __exportAll({
	default: () => $$OzBandung,
	file: () => $$file,
	url: () => $$url
});
var $$OzBandung = createComponent(async ($$result, $$props, $$slots) => {
	const audioStreamUrl = "https://streaming.ozradio.id:8443/ozbandung";
	const youtubeChannelUrl = "https://www.youtube.com/@OZMEDIANET";
	const youtubeVideos = [
		{
			id: "UDmfDJTzg4w",
			title: "Featured video"
		},
		{
			id: "dn73m2_u71E",
			title: "Studio session"
		},
		{
			id: "ZStRwkoiTQY",
			title: "Live set"
		}
	];
	const instagramUrl = "https://www.instagram.com/ozradiobandung";
	const tiktokUrl = "https://www.tiktok.com/@ozradio";
	const [programs, announcers, activities, news] = await Promise.all([
		getCollection("programs"),
		getCollection("announcers"),
		getCollection("activities"),
		getCollection("news")
	]);
	const orderedPrograms = programs.sort((a, b) => a.data.order - b.data.order);
	const orderedAnnouncers = announcers.sort((a, b) => a.data.order - b.data.order);
	const orderedActivities = activities.sort((a, b) => a.data.order - b.data.order);
	const orderedNews = news.sort((a, b) => {
		return (b.data.publishedAt?.getTime() ?? 0) - (a.data.publishedAt?.getTime() ?? 0) || a.data.title.localeCompare(b.data.title);
	});
	const programsWithBody = await Promise.all(orderedPrograms.map(async (entry) => ({
		entry,
		Content: (await render(entry)).Content
	})));
	const announcersWithBody = await Promise.all(orderedAnnouncers.map(async (entry) => ({
		entry,
		Content: (await render(entry)).Content
	})));
	const activitiesWithBody = await Promise.all(orderedActivities.map(async (entry) => ({
		entry,
		Content: (await render(entry)).Content
	})));
	const newsWithBody = await Promise.all(orderedNews.map(async (entry) => ({
		entry,
		Content: (await render(entry)).Content
	})));
	const featuredNews = newsWithBody;
	return renderTemplate`<html lang="en" data-astro-cid-wlcjw367><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="theme-color" content="#FFFFF3"><meta name="description" content="Listen, watch and connect with OZ Media."><title>OZ Media</title>${renderHead($$result)}</head><body data-astro-cid-wlcjw367><main class="bandung-page" data-astro-cid-wlcjw367><header class="topbar" data-astro-cid-wlcjw367><a class="wordmark" href="/" aria-label="OZ Radio home" data-astro-cid-wlcjw367><img src="/images/logo-oz-media.png" alt="OZ Media" data-astro-cid-wlcjw367></a><nav class="topbar-nav" aria-label="Page sections" data-topbar-nav data-astro-cid-wlcjw367>${[
		{
			id: "listen",
			label: "ON AIR"
		},
		{
			id: "programs",
			label: "PROGRAMS"
		},
		{
			id: "announcer",
			label: "ANNOUNCER"
		},
		{
			id: "online",
			label: "ONLINE"
		},
		{
			id: "activities",
			label: "ON GROUND"
		},
		{
			id: "news",
			label: "OZ-NEWS"
		},
		{
			id: "contact",
			label: "CONTACT"
		}
	].map((section) => renderTemplate`<a class="topbar-nav-link"${addAttribute(`#${section.id}`, "href")}${addAttribute(section.id, "data-topbar-section-id")} data-astro-cid-wlcjw367>${section.label}</a>`)}</nav></header><section class="screen listen-screen" id="listen" aria-labelledby="listen-title" data-astro-cid-wlcjw367><div class="screen-content listen-content" data-astro-cid-wlcjw367><div class="screen-heading listen-heading" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><h1 id="listen-title" data-astro-cid-wlcjw367><img src="/images/logo-oz-bandung.png" alt="OZ Radio Bandung" data-astro-cid-wlcjw367></h1></div></div><div class="broadcast-layout" data-astro-cid-wlcjw367><section class="live-chat" aria-labelledby="live-chat-title" data-astro-cid-wlcjw367><div class="live-chat-heading" data-astro-cid-wlcjw367><h2 id="live-chat-title" data-astro-cid-wlcjw367>LIVE CHAT</h2></div><div class="live-chat-body" data-astro-cid-wlcjw367><p data-astro-cid-wlcjw367>Chat will be available during the live broadcast.</p><div class="live-chat-compose" aria-hidden="true" data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>Chat is not connected yet</span><span data-astro-cid-wlcjw367>↗</span></div></div></section><div class="broadcast" aria-label="OZ Bandung broadcast" data-astro-cid-wlcjw367><div class="broadcast-heading" data-astro-cid-wlcjw367><div class="broadcast-label" data-astro-cid-wlcjw367><span class="live-dot idle-dot" data-astro-cid-wlcjw367></span> LIVE FROM THE STUDIO</div><span class="on-air" data-astro-cid-wlcjw367>ON AIR</span></div><div class="broadcast-options" data-astro-cid-wlcjw367><button class="broadcast-option" type="button" data-tune-in data-astro-cid-wlcjw367><span class="tune-in-icon" aria-hidden="true" data-astro-cid-wlcjw367>▶</span><span data-tune-in-label data-astro-cid-wlcjw367>Tune in</span></button></div><div class="broadcast-panel" data-broadcast-panel="audio" hidden data-astro-cid-wlcjw367><div class="audio-bar" data-astro-cid-wlcjw367><span class="icon" aria-hidden="true" data-astro-cid-wlcjw367>♫</span><div class="audio-copy" data-astro-cid-wlcjw367><strong data-track-title data-astro-cid-wlcjw367>${"Loading track..."}</strong><span data-track-artist aria-live="polite" data-astro-cid-wlcjw367></span></div>${renderTemplate`<audio data-audio-player controls preload="none"${addAttribute(audioStreamUrl, "src")} aria-label="OZ Bandung audio stream" data-astro-cid-wlcjw367>Your browser does not support audio playback.</audio>`}</div><div class="listener-stats" aria-live="polite" aria-label="Live listener statistics" data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>LISTENERS <strong data-listener-count data-astro-cid-wlcjw367>—</strong></span></div></div><div class="broadcast-panel" data-broadcast-panel="video" hidden data-astro-cid-wlcjw367><div class="video-frame" data-astro-cid-wlcjw367>${renderTemplate`<div class="video-placeholder" data-astro-cid-wlcjw367><img src="/images/studio-livestream.jpg" alt="" aria-hidden="true" data-astro-cid-wlcjw367><span class="placeholder-play" aria-hidden="true" data-astro-cid-wlcjw367>▶</span><p data-astro-cid-wlcjw367>Studio stream coming soon</p><span class="placeholder-caption" data-astro-cid-wlcjw367>TWITCH LIVESTREAM · CHANNEL TO BE ADDED</span></div>`}</div></div></div></div><dialog class="listener-dialog" data-listener-dialog aria-labelledby="listener-dialog-title" data-astro-cid-wlcjw367><form class="listener-form" data-listener-form data-astro-cid-wlcjw367><button class="dialog-close" type="button" data-dialog-close aria-label="Close" data-astro-cid-wlcjw367>×</button><p class="eyebrow" data-dialog-eyebrow data-astro-cid-wlcjw367>OZ BANDUNG · LIVE</p><h2 id="listener-dialog-title" data-dialog-title data-astro-cid-wlcjw367>Choose how to tune in</h2><div class="broadcast-selection" data-broadcast-selection role="group" aria-label="Choose a broadcast" data-astro-cid-wlcjw367><button class="broadcast-option" type="button" data-select-broadcast="audio" data-astro-cid-wlcjw367>♫ <span data-astro-cid-wlcjw367>Listen to audio stream</span></button><button class="broadcast-option" type="button" data-select-broadcast="video" data-astro-cid-wlcjw367>▶ <span data-astro-cid-wlcjw367>Watch the livestream</span></button></div><div data-listener-fields hidden data-astro-cid-wlcjw367><p class="listener-privacy-note" data-astro-cid-wlcjw367>Your details are not sent to OZ or saved. They are only used in this page session.</p><label class="listener-field" data-astro-cid-wlcjw367>Name<input name="name" autocomplete="name" required maxlength="80" data-astro-cid-wlcjw367></label><label class="listener-field" data-astro-cid-wlcjw367>Age<input name="age" type="number" inputmode="numeric" min="1" max="120" step="1" required data-astro-cid-wlcjw367></label><label class="listener-field" data-astro-cid-wlcjw367>Gender<select name="gender" required data-astro-cid-wlcjw367><option value="" selected disabled data-astro-cid-wlcjw367>Select gender</option><option data-astro-cid-wlcjw367>Female</option><option data-astro-cid-wlcjw367>Male</option>></select></label><label class="listener-field" data-astro-cid-wlcjw367>Location<input name="location" autocomplete="address-level2" required maxlength="100" data-astro-cid-wlcjw367></label></div><div class="listener-confirmation" data-listener-confirmation hidden aria-live="polite" data-astro-cid-wlcjw367></div><button class="listener-submit" type="submit" data-listener-submit hidden data-astro-cid-wlcjw367>Continue</button></form></dialog><aside class="ad-space" aria-label="Advertisement space" data-astro-cid-wlcjw367><span class="ad-tag" data-astro-cid-wlcjw367>ADVERTISEMENT</span><strong data-astro-cid-wlcjw367>Advertisement.</strong><span data-astro-cid-wlcjw367>AD SPACE · BANDUNG</span></aside></div></section><section class="screen" id="programs" aria-labelledby="programs-title" data-astro-cid-wlcjw367><div class="screen-content" data-astro-cid-wlcjw367><div class="section-heading" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><p class="eyebrow" data-astro-cid-wlcjw367>02 / ON AIR PROGRAM</p><h2 id="programs-title" data-astro-cid-wlcjw367>Our<span data-astro-cid-wlcjw367> on air</span> program</h2></div></div><div class="program-carousel" data-program-carousel aria-roledescription="carousel" aria-label="On air programs" data-astro-cid-wlcjw367><div class="program-slides" data-astro-cid-wlcjw367>${programsWithBody.map(({ entry: program, Content }, index) => renderTemplate`<article${addAttribute(["program-slide", { "is-active": index < 3 }], "class:list")} data-program-slide data-article-card aria-haspopup="dialog"${addAttribute(`Read full article: ${program.data.title}, slide ${index + 1} of ${programsWithBody.length}`, "aria-label")} role="button" tabindex="0" aria-roledescription="slide"${addAttribute(index >= 3, "hidden")} data-astro-cid-wlcjw367><img${addAttribute(program.data.image, "src")}${addAttribute(program.data.imageAlt, "alt")}${addAttribute(index === 0 ? "high" : void 0, "fetchpriority")}${addAttribute(index === 0 ? void 0 : "lazy", "loading")} data-astro-cid-wlcjw367><div class="program-slide-copy" data-astro-cid-wlcjw367><span class="card-index" data-astro-cid-wlcjw367>${String(index + 1).padStart(2, "0")} / ON AIR</span><h3 data-astro-cid-wlcjw367>${program.data.title}</h3><p data-astro-cid-wlcjw367>${program.data.summary}</p></div><template data-article-body data-astro-cid-wlcjw367>${templateEnter($$result)}${renderComponent($$result, "Content", Content, { "data-astro-cid-wlcjw367": true })}${templateExit($$result)}</template></article>`)}</div><div class="program-carousel-controls" data-astro-cid-wlcjw367><div class="program-pagination" role="group" aria-label="Choose a group of programs" data-astro-cid-wlcjw367>${Array.from({ length: Math.ceil(programsWithBody.length / 3) }, (_, pageIndex) => pageIndex * 3).map((index) => renderTemplate`<button class="program-dot" type="button"${addAttribute(index, "data-program-index")}${addAttribute(`Show programs ${index + 1} to ${Math.min(index + 3, programsWithBody.length)}`, "aria-label")}${addAttribute(index === 0 ? "true" : "false", "aria-pressed")} data-astro-cid-wlcjw367></button>`)}</div><div class="program-arrows" data-astro-cid-wlcjw367><button class="carousel-arrow" type="button" data-program-previous aria-label="Previous programs" data-astro-cid-wlcjw367>←</button><span class="program-count" data-program-count aria-live="polite" data-astro-cid-wlcjw367>${programsWithBody.length ? `01-${String(Math.min(3, programsWithBody.length)).padStart(2, "0")} / ${String(programsWithBody.length).padStart(2, "0")}` : "00-00 / 00"}</span><button class="carousel-arrow" type="button" data-program-next aria-label="Next programs" data-astro-cid-wlcjw367>→</button></div></div></div></div></section><section class="screen" id="announcer" aria-labelledby="announcer-title" data-astro-cid-wlcjw367><div class="screen-content" data-astro-cid-wlcjw367><div class="section-heading" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><p class="eyebrow" data-astro-cid-wlcjw367>03 / THE VOICES OF OZ</p><h2 id="announcer-title" data-astro-cid-wlcjw367>Announcer</h2></div></div><div class="announcer-marquee" data-announcer-marquee role="region" aria-roledescription="carousel" aria-label="OZ Radio Bandung announcers" data-astro-cid-wlcjw367><div class="announcer-track" data-astro-cid-wlcjw367>${[false, true].map((isDuplicate) => renderTemplate`<div class="announcer-group"${addAttribute(isDuplicate ? "true" : void 0, "aria-hidden")} data-astro-cid-wlcjw367>${announcersWithBody.map(({ entry: announcer, Content }) => renderTemplate`<article class="announcer-card" data-article-card aria-haspopup="dialog"${addAttribute(`Read announcer profile: ${announcer.data.name}`, "aria-label")} role="button"${addAttribute(isDuplicate ? -1 : 0, "tabindex")} data-astro-cid-wlcjw367><img${addAttribute(announcer.data.image, "src")}${addAttribute(announcer.data.imageAlt, "alt")} loading="lazy" data-astro-cid-wlcjw367><div class="announcer-card-copy" data-astro-cid-wlcjw367><h3 data-astro-cid-wlcjw367>${announcer.data.name}</h3><p data-astro-cid-wlcjw367>${announcer.data.summary}</p></div><template data-article-body data-astro-cid-wlcjw367>${templateEnter($$result)}${renderComponent($$result, "Content", Content, { "data-astro-cid-wlcjw367": true })}${templateExit($$result)}</template></article>`)}</div>`)}</div></div></div></section><section class="screen" id="online" aria-labelledby="online-title" data-astro-cid-wlcjw367><div class="screen-content" data-astro-cid-wlcjw367><div class="section-heading" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><p class="eyebrow" data-astro-cid-wlcjw367>04 / ONLINE</p><h2 id="online-title" data-astro-cid-wlcjw367>Online <span data-astro-cid-wlcjw367>digital</span></h2></div></div><div class="feature-grid social-grid" data-astro-cid-wlcjw367><article class="feature-card social-card youtube-card" data-astro-cid-wlcjw367><div class="social-topline" data-astro-cid-wlcjw367><span class="social-mark" data-astro-cid-wlcjw367>▶</span><span data-astro-cid-wlcjw367>OZ RADIO BANDUNG · YOUTUBE</span></div><div class="youtube-carousel" data-youtube-carousel data-astro-cid-wlcjw367><div class="channel-preview" data-youtube-player data-astro-cid-wlcjw367><span class="preview-play" data-astro-cid-wlcjw367>▶</span><span class="preview-caption" data-astro-cid-wlcjw367>PODCASTS<br data-astro-cid-wlcjw367>&amp; LIVESTREAMS</span><span class="preview-duration" data-astro-cid-wlcjw367>YOUTUBE VIDEO TO BE ADDED</span></div><div class="youtube-carousel-nav" data-astro-cid-wlcjw367><button class="carousel-arrow" type="button" data-youtube-previous aria-label="Previous video" data-astro-cid-wlcjw367>←</button><div class="video-picker" role="group" aria-label="Select a YouTube video" data-astro-cid-wlcjw367>${youtubeVideos.map((video, index) => renderTemplate`<button class="video-picker-item" type="button" data-youtube-video${addAttribute(video.id, "data-youtube-id")}${addAttribute(video.title, "data-youtube-title")}${addAttribute(`Select ${video.title}`, "aria-label")}${addAttribute(index === 0 ? "true" : "false", "aria-pressed")} data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>${String(index + 1).padStart(2, "0")}</span>${video.title}</button>`)}</div><button class="carousel-arrow" type="button" data-youtube-next aria-label="Next video" data-astro-cid-wlcjw367>→</button></div><div class="youtube-current" aria-live="polite" data-astro-cid-wlcjw367><strong data-youtube-current-title data-astro-cid-wlcjw367>${youtubeVideos[0].title}</strong><span data-youtube-current-count data-astro-cid-wlcjw367>01 / ${String(youtubeVideos.length).padStart(2, "0")}</span></div></div><div class="social-card-bottom" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><h3 data-astro-cid-wlcjw367>Watch podcasts.</h3><p data-astro-cid-wlcjw367>Live sets, studio sessions and more from OZ Radio Bandung.</p></div><a class="outline-link"${addAttribute(youtubeChannelUrl, "href")}${addAttribute(false, "aria-disabled")} data-astro-cid-wlcjw367>${"VISIT YOUTUBE ↗"}</a></div></article><article class="feature-card social-card instagram-card" data-astro-cid-wlcjw367><div class="social-topline" data-astro-cid-wlcjw367><span class="social-mark instagram-mark" data-astro-cid-wlcjw367>◎</span><span data-astro-cid-wlcjw367>OZ RADIO BANDUNG · SOCIALS</span></div><div class="instagram-preview" data-astro-cid-wlcjw367><blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/ozradiobandung/" data-instgrm-version="14" data-astro-cid-wlcjw367><a${addAttribute(instagramUrl, "href")} data-astro-cid-wlcjw367>View this profile on Instagram</a></blockquote></div><script async src="https://www.instagram.com/embed.js"><\/script><div class="social-card-bottom" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><h3 data-astro-cid-wlcjw367>Stay in the loop.</h3><p data-astro-cid-wlcjw367>Behind the scenes and everything.</p></div><a class="outline-link"${addAttribute(instagramUrl, "href")} target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>VISIT INSTAGRAM ↗</a></div></article><article class="feature-card social-card tiktok-card" data-astro-cid-wlcjw367><div class="social-topline" data-astro-cid-wlcjw367><span class="social-mark" data-astro-cid-wlcjw367>♪</span><span data-astro-cid-wlcjw367>OZ RADIO BANDUNG · TIKTOK</span></div><div class="tiktok-preview" data-astro-cid-wlcjw367><blockquote class="tiktok-embed"${addAttribute(tiktokUrl, "cite")} data-unique-id="ozradio" data-embed-type="creator" style="max-width: 720px; min-width: 288px;" data-astro-cid-wlcjw367><section data-astro-cid-wlcjw367><a target="_blank" rel="noopener noreferrer"${addAttribute(`${tiktokUrl}?refer=creator_embed`, "href")} data-astro-cid-wlcjw367>@ozradio</a></section></blockquote></div><script async src="https://www.tiktok.com/embed.js"><\/script><div class="social-card-bottom" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><h3 data-astro-cid-wlcjw367>Catch the moments.</h3><p data-astro-cid-wlcjw367>Short-form updates and behind the scenes from OZ Radio Bandung.</p></div><a class="outline-link"${addAttribute(tiktokUrl, "href")} target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>VISIT TIKTOK ↗</a></div></article></div></div></section><section class="screen" id="activities" aria-labelledby="activities-title" data-astro-cid-wlcjw367><div class="screen-content" data-astro-cid-wlcjw367><div class="section-heading" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><p class="eyebrow" data-astro-cid-wlcjw367>05 / ON GROUND ACTIVITY</p><h2 id="activities-title" data-astro-cid-wlcjw367>On ground <span data-astro-cid-wlcjw367>activity.</span></h2></div></div><div class="feature-grid activity-grid" data-astro-cid-wlcjw367>${activitiesWithBody.map(({ entry: activity, Content }) => renderTemplate`<article class="feature-card activity-card" data-article-card aria-haspopup="dialog"${addAttribute(`Read full article: ${activity.data.title}`, "aria-label")} role="button" tabindex="0" data-astro-cid-wlcjw367><div${addAttribute(["activity-art", `art-${activity.data.artStyle}`], "class:list")} data-astro-cid-wlcjw367><img${addAttribute(activity.data.image, "src")}${addAttribute(activity.data.imageAlt, "alt")} loading="lazy" data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>${activity.data.artLabel}</span></div><div class="activity-info" data-astro-cid-wlcjw367><span class="card-index" data-astro-cid-wlcjw367>${activity.data.category}</span><h3 data-astro-cid-wlcjw367>${activity.data.title}</h3><p data-astro-cid-wlcjw367>${activity.data.summary}</p>${activity.data.status && renderTemplate`<span class="card-status" data-astro-cid-wlcjw367>${activity.data.status}</span>`}</div><template data-article-body data-astro-cid-wlcjw367>${templateEnter($$result)}${renderComponent($$result, "Content", Content, { "data-astro-cid-wlcjw367": true })}${templateExit($$result)}</template></article>`)}</div></div></section><section class="screen" id="news" aria-labelledby="news-title" data-astro-cid-wlcjw367><div class="screen-content" data-astro-cid-wlcjw367><div class="section-heading" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><p class="eyebrow" data-astro-cid-wlcjw367>06 / OZ NEWS TODAY</p><h2 id="news-title" data-astro-cid-wlcjw367>OZ <span data-astro-cid-wlcjw367>News.</span></h2></div></div><div class="news-layout" data-astro-cid-wlcjw367><div class="news-articles" data-news-carousel aria-roledescription="carousel" aria-label="Latest OZ News articles" data-astro-cid-wlcjw367>${featuredNews.map(({ entry: article, Content }, index) => renderTemplate`<article class="feature-card lead-story" data-article-card data-news-slide${addAttribute(index !== 0, "hidden")} aria-haspopup="dialog"${addAttribute(`Read full article: ${article.data.title}`, "aria-label")} role="button" tabindex="0" data-astro-cid-wlcjw367><div class="story-art" data-astro-cid-wlcjw367><img${addAttribute(article.data.image, "src")}${addAttribute(article.data.imageAlt, "alt")} loading="lazy" data-astro-cid-wlcjw367><span class="story-stamp" data-astro-cid-wlcjw367>OZ<br data-astro-cid-wlcjw367>NEWS</span><span class="story-date" data-astro-cid-wlcjw367>${article.data.publishedAt ? renderTemplate`<time${addAttribute(article.data.publishedAt.toISOString(), "datetime")} data-astro-cid-wlcjw367>${article.data.publishedAt.toLocaleDateString("en-GB", {
		day: "2-digit",
		month: "short",
		year: "numeric"
	})}</time>` : "OZ NEWS"}</span></div><div class="story-copy" data-astro-cid-wlcjw367><span class="card-index" data-astro-cid-wlcjw367>${article.data.category}</span><h3 data-astro-cid-wlcjw367>${article.data.title}</h3><p data-astro-cid-wlcjw367>${article.data.summary}</p></div><template data-article-body data-astro-cid-wlcjw367>${templateEnter($$result)}${renderComponent($$result, "Content", Content, { "data-astro-cid-wlcjw367": true })}${templateExit($$result)}</template></article>`)}<div class="news-carousel-controls" data-news-controls${addAttribute(featuredNews.length < 2, "hidden")} data-astro-cid-wlcjw367><button class="news-carousel-button" type="button" data-news-previous aria-label="Previous article" data-astro-cid-wlcjw367>←</button><span class="news-carousel-count" data-news-count aria-live="polite" data-astro-cid-wlcjw367>01 / ${String(featuredNews.length).padStart(2, "0")}</span><button class="news-carousel-button" type="button" data-news-next aria-label="Next article" data-astro-cid-wlcjw367>→</button></div><button class="news-list-trigger" type="button" data-news-list-open data-astro-cid-wlcjw367>VIEW ALL ARTICLES ↓</button></div><aside class="feature-card calendar-card" data-astro-cid-wlcjw367><div class="calendar-head" data-astro-cid-wlcjw367><span class="card-index" data-astro-cid-wlcjw367>SAVE THE DATE</span><span class="calendar-icon" data-astro-cid-wlcjw367>▦</span></div><div class="calendar-date" data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>OZ NEWS</span><strong data-astro-cid-wlcjw367>Event<br data-astro-cid-wlcjw367>calendar.</strong></div><div class="calendar-event" data-astro-cid-wlcjw367><span class="live-dot idle-dot" data-astro-cid-wlcjw367></span><div data-astro-cid-wlcjw367><strong data-astro-cid-wlcjw367>Next OZ Radio event</strong><span data-astro-cid-wlcjw367>Date and details to be announced</span></div></div><a class="outline-link" href="#activities" data-astro-cid-wlcjw367>EXPLORE ACTIVITIES ↓</a></aside></div></div></section><section class="screen contact-screen" id="contact" aria-labelledby="contact-title" data-astro-cid-wlcjw367><div class="screen-content" data-astro-cid-wlcjw367><div class="section-heading" data-astro-cid-wlcjw367><div data-astro-cid-wlcjw367><p class="eyebrow" data-astro-cid-wlcjw367>07 / LET'S TALK BUSINESS</p><h2 id="contact-title" data-astro-cid-wlcjw367>Contact <span data-astro-cid-wlcjw367>Information.</span></h2></div></div><div class="contact-layout" data-astro-cid-wlcjw367><div class="contact-intro" data-astro-cid-wlcjw367><img class="contact-mark" src="/images/logo-oz-bandung.png" alt="OZ Radio Bandung" data-astro-cid-wlcjw367><p data-astro-cid-wlcjw367>Your friendly station.</p><span class="card-status" data-astro-cid-wlcjw367>CONTACT DETAILS TO BE ADDED</span></div><div class="contact-details" data-astro-cid-wlcjw367><div class="contact-item" data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>EMAIL</span><strong data-astro-cid-wlcjw367>TBA</strong><small data-astro-cid-wlcjw367>Business &amp; general enquiries</small></div><div class="contact-item" data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>WHATSAPP</span><strong data-astro-cid-wlcjw367>+62 812 3456 7890</strong><small data-astro-cid-wlcjw367>Reach the OZ team</small></div><div class="contact-item" data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>STUDIO</span><strong data-astro-cid-wlcjw367>Jl. Setrasari II No.14, Sukarasa, Kec. Sukasari, Kota Bandung, Jawa Barat 40152</strong><small data-astro-cid-wlcjw367>Full address coming soon</small></div><div class="contact-item" data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>PARTNERSHIPS</span><strong data-astro-cid-wlcjw367>Let’s work together</strong><small data-astro-cid-wlcjw367>Contact information coming soon</small></div></div></div></div></section><footer class="site-footer" aria-label="Site footer" data-astro-cid-wlcjw367><div class="site-footer-main" data-astro-cid-wlcjw367><div class="site-footer-brand" data-astro-cid-wlcjw367><a class="site-footer-wordmark" href="/" aria-label="OZ Radio home" data-astro-cid-wlcjw367><img src="/images/logo-oz-media.png" alt="OZ Media" data-astro-cid-wlcjw367></a><p data-astro-cid-wlcjw367>YOUR FRIENDLY STATION</p></div><div class="site-footer-column" data-astro-cid-wlcjw367><h2 data-astro-cid-wlcjw367>EXPLORE</h2><a href="/about" target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>ABOUT</a> <br data-astro-cid-wlcjw367><a href="/programs" target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>PROGRAMS</a> <br data-astro-cid-wlcjw367><a href="/news" target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>NEWS</a> <br data-astro-cid-wlcjw367></div><div class="site-footer-column" data-astro-cid-wlcjw367><h2 data-astro-cid-wlcjw367>FOLLOW</h2><a href="https://www.instagram.com/ozradiobandung/" target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>INSTAGRAM</a> <br data-astro-cid-wlcjw367><a href="https://www.tiktok.com/@ozradiobandung" target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>TIKTOK</a> <br data-astro-cid-wlcjw367><a href="https://www.threads.net/@ozradiobandung" target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>THREADS</a> <br data-astro-cid-wlcjw367></div><div class="site-footer-column" data-astro-cid-wlcjw367><h2 data-astro-cid-wlcjw367>GET IN TOUCH</h2><a href="mailto:info@ozradiobandung.com" target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>EMAIL</a> <br data-astro-cid-wlcjw367><a href="https://wa.me/6281234567890" target="_blank" rel="noopener noreferrer" data-astro-cid-wlcjw367>WHATSAPP</a> <br data-astro-cid-wlcjw367></div></div><div class="site-footer-bottom" data-astro-cid-wlcjw367><span data-astro-cid-wlcjw367>© 2026 OZ RADIO BANDUNG</span><span data-astro-cid-wlcjw367>ADD COPYRIGHT OR LEGAL DETAILS HERE</span><a href="#listen" data-astro-cid-wlcjw367>BACK TO TOP ↑</a></div></footer><!-- <SectionNav sections={sections} current="listen" /> --></main><dialog class="news-list-dialog" data-news-list-dialog aria-labelledby="news-list-title" data-astro-cid-wlcjw367><button class="dialog-close news-list-close" type="button" data-news-list-close aria-label="Close article list" data-astro-cid-wlcjw367>×</button><div class="news-list-content" data-astro-cid-wlcjw367><p class="eyebrow" data-astro-cid-wlcjw367>OZ BANDUNG · NEWSROOM</p><h2 id="news-list-title" data-astro-cid-wlcjw367>All <span data-astro-cid-wlcjw367>Articles.</span></h2><label class="news-list-sort-label" for="news-list-sort" data-astro-cid-wlcjw367>SORT BY</label><select class="news-list-sort" id="news-list-sort" data-news-list-sort data-astro-cid-wlcjw367><option value="newest" data-astro-cid-wlcjw367>Newest first</option><option value="oldest" data-astro-cid-wlcjw367>Oldest first</option><option value="title" data-astro-cid-wlcjw367>Title A–Z</option></select><div class="news-list-items" data-news-list-items data-astro-cid-wlcjw367>${newsWithBody.map(({ entry: article, Content }) => renderTemplate`<button class="news-list-item" type="button" data-article-card data-news-list-item${addAttribute(article.data.publishedAt?.getTime() ?? 0, "data-news-date")}${addAttribute(article.data.title, "data-news-title")} aria-haspopup="dialog"${addAttribute(`Read full article: ${article.data.title}`, "aria-label")} data-astro-cid-wlcjw367><img${addAttribute(article.data.image, "src")} alt="" loading="lazy" data-astro-cid-wlcjw367><span class="news-list-item-copy" data-astro-cid-wlcjw367><span class="card-index" data-astro-cid-wlcjw367>${article.data.category}</span><h3 data-astro-cid-wlcjw367>${article.data.title}</h3><p data-astro-cid-wlcjw367>${article.data.summary}</p><time${addAttribute(article.data.publishedAt?.toISOString(), "datetime")} data-astro-cid-wlcjw367>${article.data.publishedAt ? article.data.publishedAt.toLocaleDateString("en-GB", {
		day: "2-digit",
		month: "short",
		year: "numeric"
	}) : "OZ NEWS"}</time></span><template data-article-body data-astro-cid-wlcjw367>${templateEnter($$result)}${renderComponent($$result, "Content", Content, { "data-astro-cid-wlcjw367": true })}${templateExit($$result)}</template></button>`)}</div></div></dialog><dialog class="article-dialog" data-article-dialog aria-labelledby="article-dialog-title" data-astro-cid-wlcjw367><button class="dialog-close article-dialog-close" type="button" data-article-close aria-label="Close article" data-astro-cid-wlcjw367>×</button><img class="article-dialog-image" data-article-image alt="Article image" data-astro-cid-wlcjw367><div class="article-dialog-copy" data-astro-cid-wlcjw367><p class="eyebrow" data-article-category data-astro-cid-wlcjw367></p><h2 id="article-dialog-title" data-article-title data-astro-cid-wlcjw367></h2><p class="article-dialog-description" data-article-description data-astro-cid-wlcjw367></p><div class="article-dialog-body" data-article-body-content hidden data-astro-cid-wlcjw367></div><p class="article-dialog-status" data-article-status hidden data-astro-cid-wlcjw367></p></div></dialog></body></html>${renderScript($$result, "D:/Work/oz-proto/src/pages/oz-bandung.astro?astro&type=script&index=0&lang.ts")}`;
}, "D:/Work/oz-proto/src/pages/oz-bandung.astro", void 0);
var $$file = "D:/Work/oz-proto/src/pages/oz-bandung.astro";
var $$url = "/oz-bandung";
//#endregion
//#region \0virtual:astro:page:src/pages/oz-bandung@_@astro
var page = () => oz_bandung_exports;
//#endregion
export { page };
