const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  clipboardUrl: () => ipcRenderer.invoke('clipboard:url'),
  start: (url, mode) => ipcRenderer.invoke('download:start', { url, mode }),
  cancel: (id) => ipcRenderer.invoke('download:cancel', id),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  saveReport: () => ipcRenderer.invoke('report:save'),
  onProgress: (cb) => ipcRenderer.on('download:progress', (_e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('download:done', (_e, d) => cb(d)),
});
