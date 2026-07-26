import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

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
  entryPoints: ['src/renderer/main.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  outfile: 'dist/renderer.js',
});

await build({
  entryPoints: ['src/renderer/quick.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  outfile: 'dist/quick.js',
});

// Tailwind v4: scans src/renderer for class names, emits one flat stylesheet.
const cssIn = 'src/renderer/styles.css';
const result = await postcss([tailwindcss({ base: 'src/renderer' })])
  .process(readFileSync(cssIn, 'utf8'), { from: cssIn });
writeFileSync('dist/styles.css', result.css);

cpSync('src/renderer/index.html', 'dist/index.html');
cpSync('src/renderer/quick.html', 'dist/quick.html');
console.log('desktop build done');
