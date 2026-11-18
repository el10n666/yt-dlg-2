const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { startDownload } = require('./src/downloader');
const { resolveYtDlp, updateYtDlp } = require('./src/binaries');
const { cleanUrl } = require('./src/args');

const log = [];
const note = (m) => log.push(`${new Date().toISOString()} ${m}`);

let win;
let nextId = 1;
const active = new Map();

const bundledDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'resources', 'bin'));
const userDir = () => path.join(app.getPath('userData'), 'bin');

const run = (exe, args) => new Promise((resolve, reject) => {
  execFile(exe, args, { windowsHide: true, timeout: 120000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

function createWindow() {
  win = new BrowserWindow({
    width: 720,
    height: 640,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('clipboard:url', () => cleanUrl(clipboard.readText()));

ipcMain.handle('download:start', (_e, { url, mode }) => {
  const id = nextId++;
  const job = startDownload({
    url,
    mode: mode === 'audio' ? 'audio' : 'video',
    outDir: app.getPath('downloads'),
    ytdlp: resolveYtDlp({ bundledDir: bundledDir(), userDir: userDir() }),
    ffmpegDir: bundledDir(),
    spawn,
  }, (p) => win && win.webContents.send('download:progress', { id, ...p }));
  active.set(id, job);
  job.done.then((r) => {
    active.delete(id);
    note(`download ${id} ${r.ok ? 'ok' : 'fail: ' + r.message}`);
    if (win) win.webContents.send('download:done', { id, ok: r.ok, message: r.message });
  });
  return id;
});

ipcMain.handle('download:cancel', (_e, id) => { const j = active.get(id); if (j) j.cancel(); });
ipcMain.handle('window:close', () => win && win.close());
ipcMain.handle('window:minimize', () => win && win.minimize());
ipcMain.handle('window:close', () => win && win.close());
ipcMain.handle('window:minimize', () => win && win.minimize());
ipcMain.handle('folder:open', () => shell.openPath(app.getPath('downloads')));

ipcMain.handle('report:save', () => {
  const file = path.join(app.getPath('desktop'), 'отчёт-о-проблеме.txt');
  fs.writeFileSync(file, log.join('\n') || 'Записей нет', 'utf8');
  shell.showItemInFolder(file);
  return file;
});

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) {
    // Обновление приложения: ставится при закрытии, не посреди скачивания. Ошибки только в лог.
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (e) => note(`app update error: ${e.message}`));
    autoUpdater.checkForUpdates().catch((e) => note(`app update check failed: ${e.message}`));
  }
  // Обновление yt-dlp в фоне: ошибки только в лог, пользователю не показываются.
  updateYtDlp({ bundledDir: bundledDir(), userDir: userDir(), run })
    .then((r) => note(`yt-dlp update: ${r}`))
    .catch((e) => note(`yt-dlp update error: ${e.message}`));
});

app.on('window-all-closed', () => app.quit());
