const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assemble', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: p => ipcRenderer.invoke('config:set', p),
  setArmed: v => ipcRenderer.invoke('armed:set', v),
  tap: (label, confidence, count) => ipcRenderer.send('tap', label, confidence, count),
  extra: kind => ipcRenderer.send('extra', kind),
  whistleStep: dir => ipcRenderer.send('whistle-step', dir),
  onArmedChanged: cb => ipcRenderer.on('armed-changed', (_e, v) => cb(v)),
});
