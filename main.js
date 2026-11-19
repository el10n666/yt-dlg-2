const { app, BrowserWindow, ipcMain, clipboard, shell, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { startDownload } = require('./src/downloader');
const { resolveYtDlp, updateYtDlp } = require('./src/binaries');
const { cleanUrl } = require('./src/args');
const { shouldWelcome, markWelcomed, welcomeText, findShortcuts } = require('./src/firstrun');
const { loadSettings, saveSettings } = require('./src/settings');

let win;
let isFull = false;
let nextId = 1;
const active = new Map();

const bundledDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'resources', 'bin'));
const userDir = () => path.join(app.getPath('userData'), 'bin');
const logFile = () => path.join(app.getPath('userData'), 'log.txt');

// Журнал пишется на диск: после перезапуска или падения он не пропадает.
function note(m) {
  const line = `${new Date().toISOString()} ${m}\n`;
  try { fs.appendFileSync(logFile(), line, 'utf8'); } catch { /* журнал не должен ронять приложение */ }
}

// Любая неожиданная ошибка: в журнал и по-русски, а не английское системное окно.
process.on('uncaughtException', (e) => {
  note(`uncaughtException: ${e && e.stack}`);
  try { dialog.showErrorBox('Скачать видео', 'Что-то пошло не так. Закройте программу и откройте её снова. Если повторится, нажмите «Сообщить о проблеме».'); } catch { /* окно ещё недоступно */ }
});
process.on('unhandledRejection', (e) => note(`unhandledRejection: ${e && e.stack ? e.stack : e}`));

if (!app.requestSingleInstanceLock()) {
  app.quit(); // второй запуск: два обновления yt-dlp одновременно портят exe
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

const run = (exe, args) => new Promise((resolve, reject) => {
  execFile(exe, args, { windowsHide: true, timeout: 120000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

// Скачивание ждёт обновления yt-dlp (не дольше 20 с), чтобы не взять exe в момент замены.
let updateReady = Promise.resolve();
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 740,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  // Состояние ведём сами по событиям: для безрамочного прозрачного окна win.isFullScreen() возвращает false даже в полном экране.
  const sendState = (full) => { isFull = full; if (win && !win.isDestroyed()) win.webContents.send('window:state', { full }); };
  win.on('enter-full-screen', () => sendState(true));
  win.on('leave-full-screen', () => sendState(false));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('clipboard:url', () => cleanUrl(clipboard.readText()));

// id выдаёт интерфейс заранее: быстрые ошибки не теряются, элемент списка уже существует.
ipcMain.handle('download:start', async (_e, { id, url, mode }) => {
  await withTimeout(updateReady, 20000);
  // Настройки читаются из файла в главном процессе: интерфейс не может подставить папку или аргументы.
  const settings = loadSettings(app.getPath('userData'));
  const job = startDownload({
    url,
    mode: mode === 'audio' ? 'audio' : 'video',
    outDir: settings.outDir || app.getPath('downloads'),
    ytdlp: resolveYtDlp({ bundledDir: bundledDir(), userDir: userDir() }),
    ffmpegDir: bundledDir(),
    spawn,
    options: { cookiesBrowser: settings.cookiesBrowser, proxy: settings.proxy, playlist: settings.playlist },
  }, (p) => win && win.webContents.send('download:progress', { id, ...p }));
  active.set(id, job);
  job.done.then((r) => {
    active.delete(id);
    note(`download ${id} url=${url} ${r.ok ? 'ok' : `fail code=${r.code} msg="${r.message}" stderr=${JSON.stringify(r.stderr || '')}`}`);
    if (win) win.webContents.send('download:done', { id, ok: r.ok, cancelled: Boolean(r.cancelled), message: r.message });
  });
});

ipcMain.handle('download:cancel', (_e, id) => { const j = active.get(id); if (j) j.cancel(); });
ipcMain.handle('window:close', () => win && win.close());
ipcMain.handle('window:minimize', () => win && win.minimize());
ipcMain.handle('window:fullscreen', () => {
  if (!win) return;
  // У окна без рамки с resizable:false Windows может не пускать в полный экран, поэтому разрешаем изменение размера на время переключения.
  win.setResizable(true);
  win.setFullScreen(!isFull);
  if (isFull) win.once('leave-full-screen', () => win.setResizable(false));
});
ipcMain.handle('settings:get', () => loadSettings(app.getPath('userData')));
ipcMain.handle('settings:set', (_e, patch) => {
  const next = { ...loadSettings(app.getPath('userData')), ...(patch && typeof patch === 'object' ? patch : {}) };
  return saveSettings(app.getPath('userData'), next);
});
ipcMain.handle('settings:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Куда сохранять', properties: ['openDirectory', 'createDirectory'], defaultPath: app.getPath('downloads') });
  if (r.canceled || !r.filePaths[0]) return null;
  return saveSettings(app.getPath('userData'), { ...loadSettings(app.getPath('userData')), outDir: r.filePaths[0] });
});
ipcMain.handle('folder:open', () => shell.openPath(loadSettings(app.getPath('userData')).outDir || app.getPath('downloads')));

ipcMain.handle('report:save', () => {
  const file = path.join(app.getPath('desktop'), 'отчёт-о-проблеме.txt');
  let text = `Версия приложения: ${app.getVersion()}\n\n`;
  try { text += fs.readFileSync(logFile(), 'utf8'); } catch { text += 'Записей нет'; }
  fs.writeFileSync(file, text, 'utf8');
  shell.showItemInFolder(file);
  return file;
});

app.on('before-quit', () => { for (const j of active.values()) j.cancel(); });

// Первый запуск после установки: один раз объясняем, где лежат ярлыки. В режиме разработки не показываем.
function welcomeOnce() {
  if (!app.isPackaged || !shouldWelcome(app.getPath('userData'))) return;
  const text = welcomeText(findShortcuts({
    desktopDir: app.getPath('desktop'),
    startMenuDir: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  }));
  markWelcomed(app.getPath('userData')); // сначала маркер: окно не повторится, даже если его закроют аварийно
  dialog.showMessageBox(win, { type: 'info', title: 'Скачать видео', message: 'Всё готово', detail: text, buttons: ['Понятно'] })
    .catch((e) => note(`welcome dialog error: ${e.message}`));
}

app.whenReady().then(() => {
  createWindow();
  welcomeOnce();
  if (app.isPackaged) {
    // Обновление приложения ставится при закрытии. Ошибки только в журнал.
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (e) => note(`app update error: ${e.message}`));
    autoUpdater.checkForUpdates().catch((e) => note(`app update check failed: ${e.message}`));
  }
  updateReady = updateYtDlp({ bundledDir: bundledDir(), userDir: userDir(), run })
    .then((r) => note(`yt-dlp update: ${r}`))
    .catch((e) => note(`yt-dlp update error: ${e.message}`));
});

app.on('window-all-closed', () => app.quit());
