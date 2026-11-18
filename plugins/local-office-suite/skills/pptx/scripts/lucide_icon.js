// Render preinstalled `lucide` icons to `image/png;base64,...` data URIs via `sharp` for PptxGenJS.
// Usage in generator scripts:
//   const { iconDataUri } = require("<pptx-skill-dir>/scripts/lucide_icon.js");
//   const pngData = await iconDataUri("Rocket", { color: "#FFFFFF", size: 256, strokeWidth: 2 });
//   slide.addImage({ data: pngData, x: 0.8, y: 1.5, w: 0.4, h: 0.4 });
"use strict";

const path = require("path");
const os = require("os");
const SEARCH_PATHS = [
	__dirname,
	process.cwd(),
	...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : []),
	path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules"),
];
const lucide = require(require.resolve("lucide", { paths: SEARCH_PATHS }));
const sharp = require(require.resolve("sharp", { paths: SEARCH_PATHS }));

function iconToSvg(iconName, { color = "#1E293B", size = 256, strokeWidth = 2 } = {}) {
	const def = lucide[iconName];
	if (!Array.isArray(def)) {
		throw new Error(`Unknown Lucide icon "${iconName}". Check PascalCase name (e.g. "Check", "BarChart3", "Cpu", "Layers").`);
	}
	const hex = String(color).startsWith("#") ? String(color) : `#${color}`;
	const children = def
		.map(([tag, attrs]) => {
			const attrStr = Object.entries(attrs || {})
				.map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
				.join(" ");
			return `<${tag} ${attrStr}/>`;
		})
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${hex}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

async function iconDataUri(iconName, opts = {}) {
	const svg = iconToSvg(iconName, opts);
	const buf = await sharp(Buffer.from(svg)).png().toBuffer();
	return "image/png;base64," + buf.toString("base64");
}

module.exports = { iconToSvg, iconDataUri };
