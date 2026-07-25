import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigStore } from './config-store.js';
import { executeAction } from './actions.js';
import { createTray } from './tray.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let win, trayHandle, store;

function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 720,
    title: 'ASSEMBLE',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
    },
  });
  win.loadFile(join(__dirname, '../renderer/index.html'));
  win.on('close', e => {           // hide, keep mic running
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

app.whenReady().then(() => {
  store = new ConfigStore(join(app.getPath('userData'), 'config.json'));
  createWindow();

  const setArmed = v => {
    store.set({ armed: v });
    win.webContents.send('armed-changed', v);
    trayHandle.rebuild();
  };
  trayHandle = createTray({
    getArmed: () => store.get().armed,
    setArmed,
    openSettings: () => { win.show(); win.focus(); },
    quit: () => { app.isQuitting = true; app.quit(); },
  });

  ipcMain.handle('config:get', () => store.get());
  ipcMain.handle('config:set', (_e, partial) => { const c = store.set(partial); trayHandle.rebuild(); return c; });
  ipcMain.handle('armed:set', (_e, v) => { setArmed(v); return v; });
  ipcMain.on('tap', (_e, label, confidence, count = 1) => {
    const cfg = store.get();
    if (!cfg.armed || label === 'ultron') return;
    const action = cfg.zones[label]?.actions?.[String(count)];
    executeAction(action).catch(err => console.error('action failed:', err.message));
  });
  ipcMain.on('extra', (_e, kind) => {
    const cfg = store.get();
    if (!cfg.armed) return;
    const action =
      kind === 'blow' ? cfg.extras.blow.action :
      kind === 'wave-left' ? cfg.extras.camera.left.action :
      kind === 'wave-right' ? cfg.extras.camera.right.action : null;
    executeAction(action).catch(err => console.error('action failed:', err.message));
  });
  ipcMain.on('whistle-step', (_e, dir) => {
    const cfg = store.get();
    if (!cfg.armed || !cfg.extras.whistleVolume) return;
    executeAction({ type: 'system', value: dir > 0 ? 'volume-up' : 'volume-down' })
      .catch(err => console.error('action failed:', err.message));
  });
});

app.on('window-all-closed', () => {}); // tray app: stay alive
