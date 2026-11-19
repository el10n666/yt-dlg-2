const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSettings, saveSettings, DEFAULTS } = require('../src/settings');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlg-set-')), 'userData');

test('defaults are returned when the file does not exist', () => {
  assert.deepStrictEqual(loadSettings(tmp()), DEFAULTS);
});

test('settings survive a save and load round trip, and the folder is created', () => {
  const dir = tmp();
  const s = { cookiesBrowser: 'firefox', proxy: 'http://127.0.0.1:8080', playlist: true, outDir: 'D:\\Видео', zapret: true };
  saveSettings(dir, s);
  assert.deepStrictEqual(loadSettings(dir), s);
});

test('a corrupt file falls back to defaults instead of crashing the app', () => {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), '{not json', 'utf8');
  assert.deepStrictEqual(loadSettings(dir), DEFAULTS);
});

test('unknown keys and wrong types are dropped, valid keys are kept', () => {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ evil: 1, playlist: 'yes', proxy: 5, cookiesBrowser: 'chrome', zapret: true }), 'utf8');
  assert.deepStrictEqual(loadSettings(dir), { ...DEFAULTS, cookiesBrowser: 'chrome', zapret: true });
});

test('saveSettings also sanitizes what it writes', () => {
  const dir = tmp();
  saveSettings(dir, { evil: 'x', playlist: 1, proxy: 'p' });
  assert.deepStrictEqual(loadSettings(dir), { ...DEFAULTS, proxy: 'p' });
});
