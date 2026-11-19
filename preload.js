const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  clipboardUrl: () => ipcRenderer.invoke('clipboard:url'),
  start: (id, url, mode) => ipcRenderer.invoke('download:start', { id, url, mode }),
  cancel: (id) => ipcRenderer.invoke('download:cancel', id),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  onWindowState: (cb) => ipcRenderer.on('window:state', (_e, d) => cb(d)),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFolder: () => ipcRenderer.invoke('settings:pickFolder'),
  zapretOn: () => ipcRenderer.invoke('zapret:on'),
  zapretOff: () => ipcRenderer.invoke('zapret:off'),
  onZapretStatus: (cb) => ipcRenderer.on('zapret:status', (_e, d) => cb(d)),
  saveReport: () => ipcRenderer.invoke('report:save'),
  onProgress: (cb) => ipcRenderer.on('download:progress', (_e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('download:done', (_e, d) => cb(d)),
});
