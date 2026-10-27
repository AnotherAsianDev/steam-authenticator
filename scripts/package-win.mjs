// Builds a self-contained Windows folder: Authenticator.exe, no Node or npm needed on the target PC.
import { packager } from '@electron/packager';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });

// Stage only what the app needs; everything is already bundled into these files.
rmSync('out/app', { recursive: true, force: true });
mkdirSync('out/app', { recursive: true });
for (const f of ['main.js', 'preload.js', 'index.html', 'renderer.js', 'style.css']) cpSync(`dist/${f}`, `out/app/${f}`);
writeFileSync(
	'out/app/package.json',
	JSON.stringify({ name: pkg.name, productName: 'Authenticator', version: pkg.version, main: 'main.js' }, null, 2)
);

const paths = await packager({
	dir: 'out/app',
	out: 'out',
	name: 'Authenticator',
	platform: 'win32',
	arch: 'x64',
	overwrite: true,
	prune: false,
	asar: true
});
const built = paths[0];

// Final layout, kept tidy:
//   Authenticator-portable/
//     Authenticator.exe   small launcher
//     maFiles/            your maFiles, like SDA
//     data/               settings, saved passwords, caches (created on first start)
//     app/                the program and its support files
const portable = 'out/Authenticator-portable';
rmSync(portable, { recursive: true, force: true });
mkdirSync(portable, { recursive: true });
cpSync(built, `${portable}/app`, { recursive: true });
mkdirSync(`${portable}/maFiles`);
mkdirSync(`${portable}/data`);
if (!existsSync('launcher/Launcher.exe')) throw new Error('launcher/Launcher.exe is missing');
cpSync('launcher/Launcher.exe', `${portable}/Authenticator.exe`);

// Only English is used, so the other language packs are just clutter.
const locales = `${portable}/app/locales`;
if (existsSync(locales)) for (const f of readdirSync(locales)) if (f !== 'en-US.pak') rmSync(`${locales}/${f}`);
writeFileSync(`${portable}/maFiles/README.txt`, 'Drop your .maFile files here. They are picked up automatically.\n');
console.log('Built:', portable);
