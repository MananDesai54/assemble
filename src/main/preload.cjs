const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assemble', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: p => ipcRenderer.invoke('config:set', p),
  setArmed: v => ipcRenderer.invoke('armed:set', v),
  tap: (label, confidence) => ipcRenderer.send('tap', label, confidence),
  onArmedChanged: cb => ipcRenderer.on('armed-changed', (_e, v) => cb(v)),
});
