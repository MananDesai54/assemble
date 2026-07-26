// Stage the local daemon for packaging: one bundled server.js (bun target)
// plus real node_modules for the ML chain — kokoro/transformers load native
// onnxruntime dylibs that cannot be embedded in a bundle — plus the Swift
// helper sources the server compiles on demand.
// Output: apps/desktop/stage/server/  →  shipped as Electron extraResources.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const desktop = join(import.meta.dirname, '..');
const repo = join(desktop, '..', '..');
const stage = join(desktop, 'stage', 'server');

rmSync(join(desktop, 'stage'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

execSync(
  'bun build apps/server/src/index.ts --target=bun ' +
  '--external kokoro-js --external @huggingface/transformers ' +
  `--outfile ${join(stage, 'server.js')}`,
  { cwd: repo, stdio: 'inherit' },
);

// real installs for the externals (native deps intact)
const rootPkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const serverPkg = JSON.parse(readFileSync(join(repo, 'apps', 'server', 'package.json'), 'utf8'));
const pin = (name) => serverPkg.dependencies?.[name] ?? rootPkg.dependencies?.[name] ?? 'latest';
writeFileSync(join(stage, 'package.json'), JSON.stringify({
  name: 'assemble-server-stage',
  private: true,
  dependencies: {
    'kokoro-js': pin('kokoro-js'),
    '@huggingface/transformers': pin('@huggingface/transformers'),
  },
}, null, 2));
execSync('bun install --production', { cwd: stage, stdio: 'inherit' });

// prune to this build's platform/arch: onnxruntime-node ships every OS's
// binaries (~200 MB); onnxruntime-web is browser-only — the node build never
// imports it (verified: boot + full kokoro synth with both removed)
const napi = join(stage, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
for (const os of readdirSync(napi)) {
  if (os !== process.platform) { rmSync(join(napi, os), { recursive: true, force: true }); continue; }
  for (const arch of readdirSync(join(napi, os))) {
    if (arch !== process.arch) rmSync(join(napi, os, arch), { recursive: true, force: true });
  }
}
rmSync(join(stage, 'node_modules', 'onnxruntime-web'), { recursive: true, force: true });

// swift helper sources — the server compiles them into ASSEMBLE_HOME/bin
cpSync(join(repo, 'native'), join(stage, 'native'), { recursive: true });

console.log('server staged at', stage);
