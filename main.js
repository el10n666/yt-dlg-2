const { app, BrowserWindow, ipcMain, clipboard, shell, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Режим помощника zapret: та же программа, запущенная с правами администратора. Окна, единственного экземпляра и IPC нет,
// только канал к приложению. Папка zapret вычисляется здесь же и из командной строки не берётся.
const helperArg = process.argv.find((a) => a.startsWith('--zapret-pipe='));
if (process.argv.includes('--zapret-helper') && helperArg) {
  const pipePath = helperArg.slice('--zapret-pipe='.length);
  app.whenReady().then(async () => {
    const { runHelper } = require('./src/zapret-helper');
    if (/^\\\\\.\\pipe\\yt-dlg-2-[0-9a-f]{24}$/.test(pipePath)) {
      await runHelper({ pipePath, zapretDir: path.join(app.getPath('userData'), 'zapret') }).catch(() => {});
    }
    app.exit(0);
  });
  return; // eslint-disable-line no-useless-return -- дальше идёт только код обычного приложения
}

const { startDownload } = require('./src/downloader');
const { resolveYtDlp, updateYtDlp } = require('./src/binaries');
const { cleanUrl } = require('./src/args');
const { shouldWelcome, markWelcomed, welcomeText, findShortcuts } = require('./src/firstrun');
const { loadSettings, saveSettings } = require('./src/settings');
const { prepareZapret, listStrategies, parseStrategy, ensureUserLists, pickStrategy } = require('./src/zapret');
const { buildElevatedLaunch, checkTargets } = require('./src/zapret-run');
const { createSession } = require('./src/zapret-session');

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

app.on('before-quit', () => {
  for (const j of active.values()) j.cancel();
  zapretOff().catch(() => {}); // при закрытии канал рвётся, и помощник сам останавливает winws и выгружает драйвер
});

// ---------- Обход блокировок (zapret) ----------

const zapretBundled = () => (app.isPackaged ? path.join(process.resourcesPath, 'zapret') : path.join(__dirname, 'resources', 'zapret'));
const zapretDir = () => path.join(app.getPath('userData'), 'zapret');
let zSession = null;
let zBusy = false;
let zCancel = false;

function zStatus(state, text, extra = {}) {
  note(`zapret: ${state} ${text}`);
  if (win && !win.isDestroyed()) win.webContents.send('zapret:status', { state, text, ...extra });
}

// Помощник это та же программа: в собранном приложении сам exe, при разработке electron с путём к проекту.
function helperLaunch(pipe) {
  const helperArgs = ['--zapret-helper', `--zapret-pipe=${pipe}`];
  const exe = process.execPath;
  const args = app.isPackaged ? helperArgs : [app.getAppPath(), ...helperArgs];
  return buildElevatedLaunch({ exe, args });
}

function launchElevated({ pipe }) {
  const l = helperLaunch(pipe);
  return new Promise((resolve, reject) => {
    execFile(l.file, l.args, { windowsHide: true }, (err, _out, stderr) => {
      if (!err) return resolve();
      const e = new Error(`Не удалось получить права администратора: ${String(stderr || err.message).trim()}`);
      e.declined = /cancel|отмен/i.test(String(stderr)); // пользователь нажал «Нет» в окне Windows
      reject(e);
    });
  });
}

async function zapretOn() {
  if (zBusy) return;
  zBusy = true;
  zCancel = false;
  try {
    zStatus('busy', 'Готовим обход блокировок…');
    const prep = prepareZapret({ bundledDir: zapretBundled(), userDir: zapretDir() });
    note(`zapret prepare: ${prep.action} ${prep.version}`);
    ensureUserLists(path.join(zapretDir(), 'lists'));
    const dirs = { binDir: path.join(zapretDir(), 'bin'), listsDir: path.join(zapretDir(), 'lists') };
    const names = listStrategies(zapretDir());
    const argsOf = (name) => parseStrategy(fs.readFileSync(path.join(zapretDir(), `${name}.bat`), 'utf8'), dirs).args;

    zStatus('busy', 'Подтвердите запрос Windows…');
    zSession = createSession({ launch: launchElevated });
    zSession.onExit((e) => zStatus('error', `Обход блокировок остановился (код ${e.code}). Включите заново`, { on: false }));
    await zSession.open();

    const settings = loadSettings(app.getPath('userData'));
    const result = await pickStrategy({
      names,
      preferred: settings.zapretStrategy,
      start: async (name) => {
        const r = await zSession.request({ cmd: 'start', args: argsOf(name) });
        if (!r.ok) throw new Error(r.error || 'не запустилась');
      },
      stop: async () => { if (zSession && zSession.alive) await zSession.request({ cmd: 'stop' }); },
      wait: () => new Promise((r) => setTimeout(r, 2500)), // драйверу нужно время, чтобы начать перехват
      check: () => checkTargets(),
      onProgress: ({ index, total }) => zStatus('busy', `Подбираем настройку: ${index} из ${total}…`),
      isCancelled: () => zCancel,
    });

    if (!result || result.cancelled) {
      await zapretOff();
      if (result && result.cancelled) return;
      saveSettings(app.getPath('userData'), { ...loadSettings(app.getPath('userData')), zapret: false });
      zStatus('error', 'Ни одна настройка не помогла. Обход выключен', { on: false });
      return;
    }
    saveSettings(app.getPath('userData'), { ...loadSettings(app.getPath('userData')), zapret: true, zapretStrategy: result.name });
    zStatus('on', result.partial ? `Включено частично (${result.name}): часть сайтов может не открываться` : `Включено (${result.name})`, { on: true });
  } catch (e) {
    note(`zapret error: ${e && e.stack}`);
    await zapretOff();
    saveSettings(app.getPath('userData'), { ...loadSettings(app.getPath('userData')), zapret: false });
    zStatus('error', e && e.declined ? 'Вы отказали в разрешении. Обход выключен' : 'Не удалось включить обход блокировок. Нажмите «Сообщить о проблеме»', { on: false });
  } finally {
    zBusy = false;
  }
}

async function zapretOff() {
  zCancel = true;
  const s = zSession;
  zSession = null;
  if (s) {
    try { if (s.alive) await s.request({ cmd: 'stop' }); } catch { /* помощник уже завершился */ }
    await s.close();
  }
}

ipcMain.handle('zapret:on', () => { zapretOn(); return true; });
ipcMain.handle('zapret:off', async () => {
  await zapretOff();
  saveSettings(app.getPath('userData'), { ...loadSettings(app.getPath('userData')), zapret: false });
  zStatus('off', 'Выключено', { on: false });
});

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
