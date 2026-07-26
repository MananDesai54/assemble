// electron-builder afterPack: extraResources silently drops node_modules
// directories, but the staged server needs its ML packages (kokoro /
// transformers / onnxruntime — native dylibs, cannot be bundled). Copy them in.
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export default async function afterPack(context) {
  const src = join(import.meta.dirname, '..', 'stage', 'server', 'node_modules');
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  const dest = join(resources, 'server', 'node_modules');
  if (!existsSync(src)) throw new Error('stage/server/node_modules missing — run scripts/stage-server.mjs first');
  cpSync(src, dest, { recursive: true });
  console.log('  • afterPack: copied server node_modules →', dest);
}
