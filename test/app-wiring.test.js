const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const main = read('main.js');
const app = read('renderer/app.js');
const pkg = JSON.parse(read('package.json'));
const html = read('renderer/index.html');
const css = read('renderer/style.css');
const pre = read('preload.js');

test('only one app instance may run (two updaters would fight over yt-dlp.exe)', () => {
  assert.match(main, /requestSingleInstanceLock\(\)/);
});

test('download waits for the startup yt-dlp update and cancels jobs on quit', () => {
  assert.match(main, /updateReady/);
  assert.match(main, /before-quit/);
});

test('main process never shows English crash dialogs: errors are caught and logged', () => {
  assert.match(main, /uncaughtException/);
  assert.match(main, /unhandledRejection/);
});

test('support log is persisted to disk', () => {
  assert.match(main, /log\.txt/);
});

test('renderer adds the list item before awaiting the main process (fast errors must not be lost)', () => {
  const go = app.slice(app.indexOf('async function go'), app.indexOf("$('go').addEventListener"));
  assert.ok(go.indexOf('addItem') < go.indexOf('await window.api.start'), 'addItem must come before await start');
  assert.match(go, /try\s*{/);
  assert.match(go, /disabled/);
});

test('installer file name is ASCII so GitHub does not rewrite the asset URL', () => {
  assert.match(pkg.build.nsis.artifactName, /^[\x20-\x7e]+$/);
});

test('after install the user sees a one-time window saying where the shortcuts are', () => {
  assert.match(main, /shouldWelcome/);
  assert.match(main, /showMessageBox/);
  assert.match(main, /app\.isPackaged/);
});

test('installer creates both shortcuts under the name the welcome window looks for', () => {
  const { SHORTCUT_NAME } = require('../src/firstrun');
  assert.strictEqual(pkg.build.nsis.createDesktopShortcut, true);
  assert.strictEqual(pkg.build.nsis.createStartMenuShortcut, true);
  assert.strictEqual(pkg.build.nsis.shortcutName, SHORTCUT_NAME);
});

test('all three window buttons are real buttons wired to the main process', () => {
  for (const id of ['close', 'min', 'full']) {
    assert.match(html, new RegExp(`<button id="${id}"`), `${id} must be a <button>`);
    assert.match(app, new RegExp(`\\$\\('${id}'\\)\\.addEventListener`), `${id} must have a click handler`);
  }
  assert.match(app, /toggleFullscreen/);
  assert.match(pre, /toggleFullscreen/);
});

test('main process toggles fullscreen and tells the renderer the new state', () => {
  assert.match(main, /ipcMain\.handle\('window:fullscreen'/);
  assert.match(main, /fullscreenable:\s*true/);
  assert.match(main, /enter-full-screen/);
  assert.match(main, /leave-full-screen/);
  assert.match(main, /window:state/);
  assert.match(pre, /onWindowState/);
});

// Кнопки внутри зоны перетаскивания (-webkit-app-region: drag) на Windows получают от системы HTCAPTION (WM_NCHITTEST = 2)
// и не принимают клики мышью, даже с no-drag. Проверено в настоящем окне. Поэтому зона перетаскивания не должна покрывать кнопки.
test('window buttons are outside the drag region', () => {
  assert.doesNotMatch(css, /\.titlebar\s*{[^}]*app-region:\s*drag/);
  assert.doesNotMatch(css, /\.lights\s*{[^}]*app-region/);
  assert.match(css, /\.drag\s*{[^}]*app-region:\s*drag/);
  const left = /\.drag\s*{[^}]*left:\s*(\d+)px/.exec(css);
  assert.ok(left && Number(left[1]) >= 80, 'drag layer must start to the right of the three buttons');
  assert.match(html, /<div class="drag"><\/div>/);
});

test('Escape leaves fullscreen', () => {
  assert.match(app, /Escape/);
});

// Для безрамочного прозрачного окна isFullScreen() врёт (false в полном экране): состояние ведём сами по событиям.
test('fullscreen toggle does not trust win.isFullScreen()', () => {
  const handler = main.slice(main.indexOf("ipcMain.handle('window:fullscreen'"), main.indexOf("ipcMain.handle('folder:open'"));
  assert.doesNotMatch(handler, /isFullScreen\(\)/);
  assert.match(main, /let isFull\b/);
  assert.match(main, /isFull = full/);
  assert.match(main, /enter-full-screen'\, \(\) => sendState\(true\)/);
  assert.match(main, /leave-full-screen'\, \(\) => sendState\(false\)/);
});

test('in fullscreen the compose block keeps its normal width, centred, and downloads use the window width', () => {
  assert.match(app, /classList\.toggle\('full'/);
  assert.match(css, /body\.full\s+\.compose\s*{[^}]*max-width:\s*480px[^}]*margin:\s*0 auto/);
  assert.match(css, /body\.full\s+\.downloads/);
  assert.doesNotMatch(css, /body\.full\s+\.compose\s*{[^}]*(zoom|scale)/);
});

// Не "release": electron-builder запускает двух издателей параллельно, и второй получает 422 "Published releases must have a valid tag",
// после чего в релизе остаётся только .blockmap. Черновик избегает гонки; публикуется вручную кнопкой "Publish release".
test('advanced section: collapsed block with browser, proxy, playlist, folder and zapret controls', () => {
  assert.match(html, /<details[^>]*id="adv"/);
  for (const id of ['opt-browser', 'opt-proxy', 'opt-playlist', 'opt-folder', 'opt-zapret']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // Слайдеры вкл/выкл: настоящие чекбоксы со стилем-переключателем, чтобы работали с клавиатуры и читались экранным диктором.
  assert.match(html, /<input type="checkbox" id="opt-playlist" role="switch"/);
  assert.match(html, /<input type="checkbox" id="opt-zapret" role="switch"/);
  assert.match(css, /\.switch/);
});

// Раскрытый блок «Дополнительно» не должен вытеснять список загрузок: средняя часть окна прокручивается целиком.
test('compose block and downloads scroll together inside one container', () => {
  assert.match(html, /<div class="scroll">[\s\S]*<section class="compose">[\s\S]*<section class="downloads">[\s\S]*<\/div>\s*<footer/);
  assert.match(css, /\.scroll\s*{[^}]*overflow-y:\s*auto/);
  assert.doesNotMatch(css, /\.downloads\s*{[^}]*overflow-y/);
});

test('main process loads and saves settings through IPC and picks the folder with a dialog', () => {
  assert.match(main, /ipcMain\.handle\('settings:get'/);
  assert.match(main, /ipcMain\.handle\('settings:set'/);
  assert.match(main, /ipcMain\.handle\('settings:pickFolder'/);
  assert.match(main, /showOpenDialog/);
  assert.match(main, /loadSettings/);
  assert.match(main, /options:/);
});

test('settings are applied to downloads: folder from settings, never from the renderer', () => {
  const start = main.slice(main.indexOf("ipcMain.handle('download:start'"), main.indexOf("ipcMain.handle('download:cancel'"));
  assert.match(start, /settings\.outDir/);
  assert.doesNotMatch(start, /outDir:\s*(url|mode|id)\b/);
});

test('main.js runs as the zapret helper when started with --zapret-helper, before any app setup', () => {
  const helperAt = main.indexOf("'--zapret-helper'");
  assert.ok(helperAt > 0, 'helper switch is handled');
  assert.ok(helperAt < main.indexOf('requestSingleInstanceLock'), 'helper must not take the single-instance lock');
  assert.ok(helperAt < main.indexOf("ipcMain.handle("), 'helper must not register app IPC');
  assert.match(main, /runHelper\(/);
});

test('zapret slider is wired: on/off IPC, status events, elevated launch, quit on exit', () => {
  for (const ch of ['zapret:on', 'zapret:off']) assert.match(main, new RegExp(`ipcMain\\.handle\\('${ch}'`), ch);
  assert.match(main, /zapret:status/);
  assert.match(main, /buildElevatedLaunch/);
  assert.match(main, /pickStrategy/);
  assert.match(main, /prepareZapret/);
  assert.match(pre, /zapretOn/);
  assert.match(pre, /zapretOff/);
  assert.match(pre, /onZapretStatus/);
  assert.match(app, /\$\('opt-zapret'\)\.addEventListener\('change'/);
});

test('zapret is bundled into the installer from resources/zapret', () => {
  assert.ok(pkg.build.extraResources.some((r) => r.from === 'resources/zapret' && r.to === 'zapret'));
});

test('release is created as a draft to avoid the parallel-publisher 422 race', () => {
  assert.strictEqual(pkg.build.publish.releaseType, 'draft');
});
