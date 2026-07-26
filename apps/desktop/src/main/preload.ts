import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('assemble', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (p: unknown) => ipcRenderer.invoke('config:set', p),
  setArmed: (v: boolean) => ipcRenderer.invoke('armed:set', v),
  resetAll: () => ipcRenderer.invoke('config:reset'),
  tap: (label: string, confidence: number, count: number) => ipcRenderer.send('tap', label, confidence, count),
  extra: (kind: string) => ipcRenderer.send('extra', kind),
  whistleStep: (dir: number) => ipcRenderer.send('whistle-step', dir),
  onArmedChanged: (cb: (v: boolean) => void) => ipcRenderer.on('armed-changed', (_e, v) => cb(v)),
  onVoiceToggle: (cb: () => void) => ipcRenderer.on('voice-toggle', () => cb()),
  // quick-ask floating panel
  quickOpenInApp: (text: string) => ipcRenderer.send('quick:open-in-app', text),
  quickHide: () => ipcRenderer.send('quick:hide'),
  onOpenTalk: (cb: (text: string) => void) => ipcRenderer.on('open-talk', (_e, text) => cb(text)),
});
