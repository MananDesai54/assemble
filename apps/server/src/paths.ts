import { existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Everything the app stores lives under one user directory — never inside the
// repo. macOS: ~/Library/Application Support/assemble (where the desktop
// config.json already lives). Linux: $XDG_DATA_HOME/assemble or
// ~/.local/share/assemble. Override: ASSEMBLE_HOME.
const platformHome = () =>
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'assemble')
    : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'assemble');
export const HOME_DIR = process.env.ASSEMBLE_HOME || platformHome();
export const DATA_DIR = join(HOME_DIR, 'data');
export const MODELS_DIR = join(HOME_DIR, 'models');
export const BIN_DIR = join(HOME_DIR, 'bin');
export const RECORDINGS_DIR = join(DATA_DIR, 'recordings');
export const VOICE_DIR = join(DATA_DIR, 'voice');

for (const d of [HOME_DIR, DATA_DIR, MODELS_DIR, BIN_DIR]) mkdirSync(d, { recursive: true });

/** One-time move of anything an older version stored inside the repo. */
export function migrateRepoLocalStorage(log: (m: string) => void = console.log): void {
  const moves: [string, string][] = [
    ['data/assemble.db', join(DATA_DIR, 'assemble.db')],
    ['data/assemble.db-wal', join(DATA_DIR, 'assemble.db-wal')],
    ['data/assemble.db-shm', join(DATA_DIR, 'assemble.db-shm')],
    ['native/audiotap/audiotap', join(BIN_DIR, 'audiotap')],
    ['native/keywatch/keywatch', join(BIN_DIR, 'keywatch')],
  ];
  for (const dir of ['data/recordings', 'data/voice', 'models']) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const destDir = dir === 'models' ? MODELS_DIR : dir === 'data/voice' ? VOICE_DIR : RECORDINGS_DIR;
      mkdirSync(destDir, { recursive: true });
      moves.push([join(dir, f), join(destDir, f)]);
    }
  }
  for (const [from, to] of moves) {
    if (existsSync(from) && !existsSync(to)) {
      try {
        renameSync(from, to);
        log(`migrated ${from} → ${to}`);
      } catch (err) {
        log(`migration of ${from} failed: ${(err as Error).message}`);
      }
    }
  }
}
