'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tracker', {
  onUsage: (cb) => ipcRenderer.on('usage', (_e, snap) => cb(snap)),
  refresh: () => ipcRenderer.send('refresh'),
  hide: () => ipcRenderer.send('hide'),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  openConfig: () => ipcRenderer.send('open-config'),
});
