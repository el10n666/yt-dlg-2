const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// Electron падает при старте, если один канал зарегистрирован дважды.
test('main.js registers every IPC channel only once', () => {
  const channels = [...src.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]);
  const dupes = channels.filter((c, i) => channels.indexOf(c) !== i);
  assert.deepStrictEqual(dupes, []);
});

// Каждый канал из preload.js должен иметь обработчик в main.js.
test('every channel invoked from preload.js has a handler in main.js', () => {
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const used = [...pre.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
  const handled = new Set([...src.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]));
  assert.deepStrictEqual(used.filter((c) => !handled.has(c)), []);
});

test('window is fixed-size and frameless', () => {
  assert.match(src, /width:\s*480/);
  assert.match(src, /height:\s*740/);
  assert.match(src, /frame:\s*false/);
  assert.match(src, /resizable:\s*false/);
});
