const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createSession } = require('../src/zapret-session');
const { runHelper } = require('../src/zapret-helper');

// Настоящий канал и настоящий помощник; заменены только запуск winws.exe и права администратора.
function fakeProc() {
  const p = new EventEmitter();
  p.pid = 777;
  p.kill = () => setImmediate(() => p.emit('exit', null));
  return p;
}

function withHelper(over = {}) {
  const procs = [];
  let helperDone;
  const launch = async ({ pipe }) => {
    if (over.declined) { const e = new Error('canceled by the user'); e.declined = true; throw e; }
    if (over.noConnect) return;
    helperDone = runHelper({
      pipePath: pipe,
      zapretDir: 'C:\\z\\zapret',
      spawn: () => { const p = fakeProc(); procs.push(p); return p; },
      verify: () => ({ ok: true, bad: [] }),
      cleanup: async () => {},
    });
  };
  const session = createSession({ launch, connectTimeoutMs: over.connectTimeoutMs || 3000, replyTimeoutMs: 2000 });
  return { session, procs, helperDone: () => helperDone };
}

test('pipe name is random and in the expected form', () => {
  const a = createSession({ launch: async () => {} }).pipe;
  const b = createSession({ launch: async () => {} }).pipe;
  assert.match(a, /^\\\\\.\\pipe\\yt-dlg-2-[0-9a-f]{24}$/);
  assert.notStrictEqual(a, b);
});

test('open, start, stop and close work end to end through a real pipe', async () => {
  const h = withHelper();
  await h.session.open();
  assert.strictEqual(h.session.alive, true);
  const r = await h.session.request({ cmd: 'start', args: ['--new'] });
  assert.deepStrictEqual(r, { ok: true, event: 'started', pid: 777 });
  assert.deepStrictEqual(await h.session.request({ cmd: 'stop' }), { ok: true, event: 'stopped' });
  await h.session.close();
  await h.helperDone();
  assert.strictEqual(h.session.alive, false);
});

test('a rejected command comes back as ok:false, not as a thrown error', async () => {
  const h = withHelper();
  await h.session.open();
  const r = await h.session.request({ cmd: 'start', args: ['calc.exe'] });
  assert.strictEqual(r.ok, false);
  await h.session.close();
  await h.helperDone();
});

test('winws exiting by itself is reported through onExit, not as a reply', async () => {
  const h = withHelper();
  const exits = [];
  h.session.onExit((e) => exits.push(e));
  await h.session.open();
  await h.session.request({ cmd: 'start', args: ['--new'] });
  h.procs[0].emit('exit', 3);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual(exits, [{ ok: false, event: 'exited', code: 3 }]);
  await h.session.close();
  await h.helperDone();
});

test('declined UAC prompt rejects open with declined=true and frees the pipe', async () => {
  const h = withHelper({ declined: true });
  await assert.rejects(h.session.open(), (e) => e.declined === true);
  assert.strictEqual(h.session.alive, false);
});

test('helper that never connects makes open fail with a timeout', async () => {
  const h = withHelper({ noConnect: true, connectTimeoutMs: 300 });
  await assert.rejects(h.session.open(), /не подключ|timeout/i);
});

test('request before open fails clearly', async () => {
  const h = withHelper();
  await assert.rejects(h.session.request({ cmd: 'stop' }), /не запущен|not open/i);
});
