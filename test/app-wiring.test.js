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
test('release is created as a draft to avoid the parallel-publisher 422 race', () => {
  assert.strictEqual(pkg.build.publish.releaseType, 'draft');
});
