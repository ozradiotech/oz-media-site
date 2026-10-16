// Shrinks CMS uploads before the build. Runs automatically as part of `npm run build`:
//
//   node scripts/optimize-uploads.mjs
//
// Decap commits full-size originals to public/uploads/. For each /uploads/ image a content entry
// references, this writes a resized WebP next to it and points the entry at the WebP. Originals are
// left in place, and WebPs that are already up to date are skipped, so it is safe to run repeatedly.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const CONTENT_DIR = 'src/content';
const PUBLIC_DIR = 'public';
// Announcer cards are at most 250px wide at 4:5; other images display up to ~1000px wide.
const SIZES = {
	announcers: { width: 600, height: 750, fit: 'cover', position: 'attention' },
	default: { width: 1600, height: 1600, fit: 'inside' },
};
const UPLOAD_PATTERN = /\/uploads\/[^\n"')]+?\.(?:png|jpe?g|webp)/gi;

const kb = (path) => `${Math.round(statSync(path).size / 1024)}KB`;

async function optimize(uploadPath, size) {
	const source = join(PUBLIC_DIR, uploadPath);
	if (!existsSync(source)) {
		console.warn(`  missing ${uploadPath}, skipped`);
		return uploadPath;
	}
	const webpPath = uploadPath.replace(/\.[^.]+$/, '.webp');
	const target = join(PUBLIC_DIR, webpPath);
	const isWebp = source === target;

	if (isWebp) {
		const { width, height } = await sharp(source).metadata();
		if (width <= size.width && height <= size.height) return uploadPath;
	} else if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) {
		return webpPath;
	}

	const before = kb(source);
	const output = isWebp ? `${target}.tmp` : target;
	await sharp(source)
		.rotate()
		.resize({ ...size, withoutEnlargement: true })
		.webp({ quality: 80 })
		.toFile(output);
	if (isWebp) renameSync(output, target);
	console.log(`  ${uploadPath} (${before}) -> ${webpPath} (${kb(target)})`);
	return webpPath;
}

console.log('Optimizing CMS uploads...');
for (const collection of readdirSync(CONTENT_DIR)) {
	const dir = join(CONTENT_DIR, collection);
	if (!statSync(dir).isDirectory()) continue;
	const size = SIZES[collection] ?? SIZES.default;

	for (const file of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
		const entry = join(dir, file);
		const text = readFileSync(entry, 'utf8');
		const replacements = new Map();
		for (const uploadPath of new Set(text.match(UPLOAD_PATTERN) ?? [])) {
			replacements.set(uploadPath, await optimize(uploadPath, size));
		}
		const updated = text.replace(UPLOAD_PATTERN, (uploadPath) => replacements.get(uploadPath));
		if (updated !== text) writeFileSync(entry, updated);
	}
}
