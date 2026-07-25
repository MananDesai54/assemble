import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { executeAction } from '@assemble/actions';
import type { Action, AppConfig } from '@assemble/core';
import { ConfigStore, type ConfigPatch } from './config-store';
import { createTray } from './tray';

const __dirname = dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow;
let trayHandle: ReturnType<typeof createTray>;
let store: ConfigStore;
let quitting = false;
let serverProc: ChildProcess | null = null;

// The desktop app owns the local daemon: start it if nothing answers on :4817.
async function ensureServer() {
  try {
    await fetch('http://127.0.0.1:4817/health', { signal: AbortSignal.timeout(1000) });
    return; // already running (user-managed or previous instance)
  } catch { /* not running — spawn */ }
  const repoRoot = join(__dirname, '..', '..', '..'); // apps/desktop/dist → repo root
  const bunCandidates = [join(homedir(), '.bun/bin/bun'), '/opt/homebrew/bin/bun', 'bun'];
  const bun = bunCandidates.find(p => p === 'bun' || existsSync(p)) ?? 'bun';
  serverProc = spawn(bun, ['run', 'apps/server/src/index.ts'], {
    cwd: repoRoot, stdio: 'ignore',
  });
  serverProc.on('exit', () => { serverProc = null; });
}

function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 720,
    title: 'assemble',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
    },
  });
  win.loadFile(join(__dirname, 'index.html'));
  win.on('close', e => {           // hide, keep mic running
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
}

app.whenReady().then(() => {
  store = new ConfigStore(join(app.getPath('userData'), 'config.json'));
  void ensureServer();
  createWindow();

  const setArmed = (v: boolean) => {
    store.set({ armed: v });
    win.webContents.send('armed-changed', v);
    trayHandle.rebuild();
  };
  trayHandle = createTray({
    getArmed: () => store.get().armed,
    setArmed,
    openSettings: () => { win.show(); win.focus(); },
    quit: () => { quitting = true; app.quit(); },
  });

  const run = (action: Action | null | undefined) =>
    executeAction(action).catch(err => console.error('action failed:', (err as Error).message));

  ipcMain.handle('config:get', () => store.get());
  ipcMain.handle('config:set', (_e, partial: ConfigPatch) => {
    const c = store.set(partial);
    trayHandle.rebuild();
    return c;
  });
  ipcMain.handle('armed:set', (_e, v: boolean) => { setArmed(v); return v; });
  ipcMain.on('tap', (_e, label: string, _confidence: number, count = 1) => {
    const cfg = store.get();
    if (!cfg.armed || label === 'ultron') return;
    run(cfg.zones[label as keyof AppConfig['zones']]?.actions?.[String(count) as '1' | '2' | '3']);
  });
  ipcMain.on('extra', (_e, kind: string) => {
    const cfg = store.get();
    if (!cfg.armed) return;
    const action =
      kind === 'blow' ? cfg.extras.blow.action :
      kind === 'wave-left' ? cfg.extras.camera.left.action :
      kind === 'wave-right' ? cfg.extras.camera.right.action : null;
    run(action);
  });
  ipcMain.on('whistle-step', (_e, dir: number) => {
    const cfg = store.get();
    if (!cfg.armed || !cfg.extras.whistleVolume) return;
    run({ type: 'system', value: dir > 0 ? 'volume-up' : 'volume-down' });
  });
});

app.on('window-all-closed', () => {}); // tray app: stay alive
app.on('before-quit', () => { serverProc?.kill('SIGTERM'); });
