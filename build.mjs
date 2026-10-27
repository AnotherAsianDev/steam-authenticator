import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
const common = { bundle: true, sourcemap: false, logLevel: 'info' };

await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.js',
  platform: 'node', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.js',
  platform: 'node', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/renderer/main.ts'], outfile: 'dist/renderer.js',
  platform: 'browser', format: 'iife' });

cpSync('src/renderer/index.html', 'dist/index.html');
cpSync('src/renderer/style.css', 'dist/style.css');
