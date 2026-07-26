// Dev-run branding: the stock Electron.app binary shows "Electron" in the
// menu bar / ⌘Tab switcher. Patch its bundle in place — name, localized
// name overrides, icon — then re-sign ad-hoc (mandatory on Apple Silicon).
// Idempotent; a packaged build makes this obsolete.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

if (process.platform !== 'darwin') process.exit(0);

const require = createRequire(import.meta.url);
let appDir;
try {
  appDir = join(dirname(require.resolve('electron/package.json')), 'dist', 'Electron.app');
} catch {
  process.exit(0);
}
if (!existsSync(appDir)) process.exit(0);

const plist = join(appDir, 'Contents', 'Info.plist');
const read = (key) => {
  try { return execFileSync('plutil', ['-extract', key, 'raw', plist]).toString().trim(); }
  catch { return ''; }
};

try {
  if (read('CFBundleName') !== 'assemble') {
    execFileSync('plutil', ['-replace', 'CFBundleName', '-string', 'assemble', plist]);
    execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', 'assemble', plist]);

    // localized InfoPlist.strings override the plist — patch every locale
    const res = join(appDir, 'Contents', 'Resources');
    for (const entry of readdirSync(res)) {
      if (!entry.endsWith('.lproj')) continue;
      const strings = join(res, entry, 'InfoPlist.strings');
      if (!existsSync(strings)) continue;
      for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
        try { execFileSync('plutil', ['-replace', key, '-string', 'assemble', strings]); } catch { /* key absent */ }
      }
    }

    // icon: 512px png → icns (sips converts square pngs directly)
    const png = join(import.meta.dirname, '..', 'assets', 'icon.png');
    const icns = join(res, 'electron.icns');
    if (existsSync(png)) {
      try { execFileSync('sips', ['-s', 'format', 'icns', png, '--out', icns], { stdio: 'ignore' }); }
      catch { copyFileSync(png, icns); /* worst case: png bytes still render */ }
    }

    // bundle changed → signature invalid → re-sign ad-hoc or macOS kills it
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appDir], { stdio: 'ignore' });
    console.log('electron dev binary branded as assemble');
  }
} catch (err) {
  console.warn(`brand-electron skipped: ${err.message}`);
}
