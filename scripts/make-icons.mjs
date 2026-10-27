// Renders build/icon.svg to build/icon.png (256) and build/icon.ico (16 to 256).
// Dev tool: needs `playwright` with Chromium (not a dependency of the app).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync('build/icon.svg', 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const png = {};
for (const s of sizes) {
	await page.setViewportSize({ width: s, height: s });
	await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`);
	png[s] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
}
await browser.close();
writeFileSync('build/icon.png', png[256]);

// ICO with PNG-compressed images (Windows Vista and later).
const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = [];
for (const s of sizes) {
	const e = Buffer.alloc(16);
	e[0] = s === 256 ? 0 : s;
	e[1] = s === 256 ? 0 : s;
	e.writeUInt16LE(1, 4);
	e.writeUInt16LE(32, 6);
	e.writeUInt32LE(png[s].length, 8);
	e.writeUInt32LE(offset, 12);
	offset += png[s].length;
	dir.push(e);
}
writeFileSync('build/icon.ico', Buffer.concat([head, ...dir, ...sizes.map((s) => png[s])]));
console.log('icons written', sizes.join(' '));
