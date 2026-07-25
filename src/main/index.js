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
  const forcedScreen = process.env.ASSEMBLE_SCREEN; // dev: jump straight to a screen
  win.loadFile(join(__dirname, '../renderer/index.html'),
    forcedScreen ? { hash: `screen=${forcedScreen}` } : {});
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
  ipcMain.on('tap', (_e, label, confidence) => {
    const cfg = store.get();
    if (!cfg.armed || label === 'ultron') return;
    const action = cfg.zones[label]?.action;
    executeAction(action).catch(err => console.error('action failed:', err.message));
  });
});

app.on('window-all-closed', () => {}); // tray app: stay alive
