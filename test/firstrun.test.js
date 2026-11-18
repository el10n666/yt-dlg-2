const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { welcomeText, shouldWelcome, markWelcomed } = require('../src/firstrun');

test('welcome text names both places when both shortcuts exist', () => {
  const t = welcomeText({ desktop: true, startMenu: true });
  assert.match(t, /на рабочем столе/);
  assert.match(t, /меню «Пуск»/);
});

test('welcome text names only the shortcut that really exists', () => {
  const t = welcomeText({ desktop: false, startMenu: true });
  assert.doesNotMatch(t, /рабочем столе/);
  assert.match(t, /меню «Пуск»/);
});

test('welcome text falls back to Windows search when no shortcut was found', () => {
  const t = welcomeText({ desktop: false, startMenu: false });
  assert.match(t, /поиск/);
});

test('welcome is shown once: not again after markWelcomed', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlg-fr-')), 'userData');
  assert.strictEqual(shouldWelcome(dir), true);
  markWelcomed(dir); // создаёт папку, если её ещё нет
  assert.strictEqual(shouldWelcome(dir), false);
});
