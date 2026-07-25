import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/main.mjs',
  external: ['electron'],
});

await build({
  entryPoints: ['src/main/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/preload.cjs',
  external: ['electron'],
});

await build({
  entryPoints: ['src/renderer/renderer.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  outfile: 'dist/renderer.js',
});

cpSync('src/renderer/index.html', 'dist/index.html');
cpSync('src/renderer/styles.css', 'dist/styles.css');
console.log('desktop build done');
