const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const main = read('main.js');
const app = read('renderer/app.js');
const pkg = JSON.parse(read('package.json'));

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

test('release is published, not left as a draft the updater cannot see', () => {
  assert.strictEqual(pkg.build.publish.releaseType, 'release');
});
