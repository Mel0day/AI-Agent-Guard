'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aisec', {
  getState: () => ipcRenderer.invoke('get-state'),
  togglePause: () => ipcRenderer.invoke('toggle-pause'),
  setLang: (code) => ipcRenderer.invoke('set-lang', code),
  reDetect: () => ipcRenderer.invoke('re-detect'),
  onStateUpdated: (cb) => ipcRenderer.on('state-updated', cb),
});
