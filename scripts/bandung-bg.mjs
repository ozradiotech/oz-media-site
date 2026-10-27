// Generates the retro backgrounds for OZ Bandung into public/images/bandung-bg/. Re-run after changing a shape:
//
//   node scripts/bandung-bg.mjs
//
// Everything is drawn here rather than cut from bandung-bg-design-guide/ (those are 19200px PNGs, 1-80MB each);
// the guide is only the reference for the look. Soft glows are rendered small and blurry, so the browser can scale
// them up without visible loss. Halftones and the ribbon are SVGs. Seeded randomness keeps the output identical.
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const OUT = 'public/images/bandung-bg';
mkdirSync(OUT, { recursive: true });

let seed = 103;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const lerp = (a, b, t) => a + (b - a) * t;
const n = (value) => +value.toFixed(1);

const writeWebp = async (name, svg, width, height, quality) => {
	await sharp(Buffer.from(svg)).resize(width, height).webp({ quality, effort: 6 }).toFile(`${OUT}/${name}`);
	console.log(`  ${name}`);
};

// ---------- Announcer: crumpled cling film on black ----------
// Each crease is a tapered sliver (wide in the middle, sharp at the ends) with a bright hairline on its lit edge.
// Slivers run mostly along two diagonals and bend in straight segments, like folded film.
function crease() {
	const direction = random() < 0.62 ? lerp(-0.7, -0.3, random()) : lerp(0.45, 0.95, random());
	let x = random() * 1800 - 100;
	let y = random() * 1200 - 100;
	let angle = direction;
	const length = lerp(140, 700, random());
	const segments = 2 + Math.floor(random() * 3);
	const points = [[x, y]];
	for (let i = 0; i < segments; i++) {
		angle += lerp(-0.22, 0.22, random());
		x += (Math.cos(angle) * length) / segments;
		y += (Math.sin(angle) * length) / segments;
		points.push([x, y]);
	}
	const width = lerp(4, 46, Math.pow(random(), 1.6));
	const side = random() < 0.5 ? 1 : -1;
	const edge = points.map((point, i) => {
		const spread = width * Math.sin((Math.PI * i) / (points.length - 1));
		const next = points[Math.min(i + 1, points.length - 1)];
		const previous = points[Math.max(i - 1, 0)];
		const normal = Math.atan2(next[1] - previous[1], next[0] - previous[0]);
		return [point[0] - Math.sin(normal) * side * spread, point[1] + Math.cos(normal) * side * spread];
	});
	const brightness = Math.pow(random(), 1.8);
	const outline = [...points, ...edge.reverse()].map(([px, py]) => `${n(px)},${n(py)}`).join(' ');
	const hairline = `M${points.map(([px, py]) => `${n(px)} ${n(py)}`).join('L')}`;
	return {
		sliver: `<polygon points="${outline}" opacity="${lerp(0.025, 0.11, brightness).toFixed(3)}"/>`,
		hairline: `<path d="${hairline}" stroke-width="${lerp(0.7, 1.8, random()).toFixed(1)}" opacity="${lerp(0.06, 0.5, brightness * brightness).toFixed(2)}"/>`,
	};
}

const creases = Array.from({ length: 150 }, crease);
const crinkleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
<defs>
	<filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.5"/></filter>
	<filter id="wide" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="40"/></filter>
	<filter id="hair"><feGaussianBlur stdDeviation="0.6"/></filter>
	<radialGradient id="vignette" cx="50%" cy="50%" r="72%"><stop offset="0.45" stop-opacity="0"/><stop offset="1" stop-opacity=".5"/></radialGradient>
</defs>
<rect width="1600" height="1000" fill="#0a0a09"/>
<g filter="url(#wide)" fill="#fff" opacity=".05">
	<ellipse cx="380" cy="300" rx="420" ry="160" transform="rotate(-25 380 300)"/>
	<ellipse cx="1180" cy="640" rx="480" ry="150" transform="rotate(-30 1180 640)"/>
	<ellipse cx="1350" cy="180" rx="260" ry="90" transform="rotate(35 1350 180)"/>
</g>
<g fill="#fff" filter="url(#soft)">${creases.map((c) => c.sliver).join('')}</g>
<g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" filter="url(#hair)">${creases.map((c) => c.hairline).join('')}</g>
<rect width="1600" height="1000" fill="url(#vignette)"/>
</svg>`;

// ---------- Hero + On Air: one warm glow spanning both screens (top half hero, bottom half On Air) ----------
// Sunlight through a window: pale rays from the top left over warm sand, settling to the page cream at the bottom
// so the seam into Programs is invisible.
const broadcastSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200" viewBox="0 0 600 1200">
<defs>
	<filter id="b40" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
	<filter id="b22" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
	<linearGradient id="settle" x1="0" y1="0" x2="0" y2="1">
		<stop offset="0" stop-color="#FFFFF3" stop-opacity="0"/>
		<stop offset="0.52" stop-color="#FFFFF3" stop-opacity="0"/>
		<stop offset="0.9" stop-color="#FFFFF3" stop-opacity="1"/>
	</linearGradient>
</defs>
<rect width="600" height="1200" fill="#F9E6B4"/>
<g filter="url(#b40)">
	<ellipse cx="520" cy="260" rx="190" ry="240" fill="#F4D58E"/>
	<ellipse cx="80" cy="640" rx="200" ry="170" fill="#F5D996"/>
	<ellipse cx="300" cy="330" rx="210" ry="170" fill="#FFF6DC"/>
	<ellipse cx="470" cy="760" rx="220" ry="140" fill="#F7DFA3"/>
</g>
<g filter="url(#b22)" fill="#FFFDF2">
	<path d="M-40 -40 L120 -40 L300 520 L210 540 Z" opacity=".85"/>
	<path d="M170 -40 L250 -40 L420 420 L370 430 Z" opacity=".6"/>
	<path d="M-60 120 L-10 60 L230 640 L150 660 Z" opacity=".5"/>
</g>
<rect width="600" height="1200" fill="url(#settle)"/>
</svg>`;

// ---------- Contact: blurred sparks drifting over warm sand, cream along the top to meet OZ News ----------
const contactSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
<defs>
	<filter id="b30" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>
	<filter id="b9" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
	<filter id="b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
	<linearGradient id="rise" x1="0" y1="0" x2="0" y2="1">
		<stop offset="0" stop-color="#FFFFF3"/>
		<stop offset="0.3" stop-color="#FFFFF3" stop-opacity="0"/>
	</linearGradient>
</defs>
<rect width="800" height="500" fill="#FBEDC6"/>
<g filter="url(#b30)">
	<ellipse cx="180" cy="420" rx="260" ry="120" fill="#F6DA97"/>
	<ellipse cx="640" cy="120" rx="200" ry="110" fill="#FFF4D6"/>
	<ellipse cx="520" cy="300" rx="220" ry="130" fill="#F7DC9C"/>
</g>
<g fill="#F2C766">
	<g filter="url(#b9)" transform="translate(600 360) rotate(-28)" opacity=".85">
		<rect x="-150" y="-26" width="300" height="52" rx="6"/><rect x="-26" y="-150" width="52" height="300" rx="6"/>
	</g>
	<g filter="url(#b3)" transform="translate(150 140) rotate(32)" opacity=".75">
		<rect x="-42" y="-11" width="84" height="22" rx="3"/><rect x="-11" y="-11" width="22" height="50" rx="3"/>
	</g>
	<g filter="url(#b9)" transform="translate(760 110) rotate(12)" opacity=".45">
		<rect x="-60" y="-14" width="120" height="28" rx="4"/><rect x="-14" y="-60" width="28" height="120" rx="4"/>
	</g>
</g>
<rect width="800" height="500" fill="url(#rise)"/>
</svg>`;

// ---------- Halftones: dot grids shaped like the logo's asterisk, used as CSS masks so CSS picks the colour ----------
// Dots swell toward the middle of the shape until they touch, leaving star-shaped gaps, and shrink to nothing at
// the edge. The shape is a signed distance field (negative inside) over a unit square centred on 0,0.
function capsule(px, py, angle, length, radius) {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const along = Math.max(-length, Math.min(length, px * cos + py * sin));
	return Math.hypot(px - along * cos, py - along * sin) - radius;
}

const asterisk = (length, radius) => (x, y) => {
	let distance = Infinity;
	for (let i = 0; i < 4; i++) distance = Math.min(distance, capsule(x, y, (i * Math.PI) / 4, length, radius));
	return distance;
};

function halftone(shape, spacing, outer, inner, fill) {
	const dots = [];
	const step = spacing;
	for (let gy = -0.75; gy <= 0.75; gy += step) {
		for (let gx = -0.75; gx <= 0.75; gx += step) {
			// The grid is turned 45deg, like a printed screen.
			const x = (gx - gy) * Math.SQRT1_2;
			const y = (gx + gy) * Math.SQRT1_2;
			if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) continue;
			const t = Math.max(0, Math.min(1, (outer - shape(x, y)) / (outer + inner)));
			const r = spacing * 0.58 * t * t * (3 - 2 * t);
			if (r > spacing * 0.06) dots.push(`<circle cx="${((x + 0.5) * 1000).toFixed(0)}" cy="${((y + 0.5) * 1000).toFixed(0)}" r="${(r * 1000).toFixed(1)}"/>`);
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"${fill ? ` fill="${fill}"` : ''}>${dots.join('')}</svg>`;
}

// ---------- On Ground: the plain ribbon that rises out of Online into On Ground ----------
// Ribbons share one coordinate frame (see .bg-ribbon in oz-bandung.astro): a 4000 x 840 strip centred on a section
// seam (y = 0), with the visible frame at x 0-1600. The same strip is drawn at the bottom of one section and the top
// of the next, so the halves meet exactly. Text-carrying ribbons are inline SVG (src/components/BandungRibbon.astro).
const smoothPath = (points) => {
	let d = `M${points[0][0]} ${points[0][1]}`;
	for (let i = 0; i < points.length - 1; i++) {
		const [p0, p1, p2, p3] = [points[i - 1] ?? points[i], points[i], points[i + 1], points[i + 2] ?? points[i + 1]];
		d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]} ${p2[1]}`;
	}
	return d;
};

const groundRibbon = smoothPath([[-1300, -60], [-600, 60], [-80, -40], [330, -270], [700, 40], [1050, -120], [1380, 230], [1750, -60], [2300, 120], [2900, -40]]);
const groundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1200 -420 4000 840"><path d="${groundRibbon}" fill="none" stroke="#F2BD57" stroke-width="78" stroke-linecap="round"/></svg>`;

console.log(`Writing ${OUT}/`);
await writeWebp('crinkle-2400.webp', crinkleSvg, 2400, 1500, 55);
await writeWebp('crinkle-1600.webp', crinkleSvg, 1600, 1000, 60);
await writeWebp('crinkle-900.webp', crinkleSvg, 900, 563, 62);
await writeWebp('glow-broadcast.webp', broadcastSvg, 600, 1200, 80);
await writeWebp('glow-contact.webp', contactSvg, 800, 500, 80);
writeFileSync(`${OUT}/halftone-flower.svg`, halftone(asterisk(0.34, 0.13), 0.032, 0.02, 0.16));
// A ready-coloured copy for the Announcer / Online seam, where it's a background rather than a mask.
writeFileSync(`${OUT}/halftone-flower-accent.svg`, halftone(asterisk(0.34, 0.13), 0.032, 0.02, 0.16, '#F2BD57'));
writeFileSync(`${OUT}/halftone-spark.svg`, halftone(asterisk(0.42, 0.05), 0.026, 0.015, 0.06));
writeFileSync(`${OUT}/ribbon-ground.svg`, groundSvg);
console.log('  halftone-flower.svg, halftone-flower-accent.svg, halftone-spark.svg, ribbon-ground.svg');
