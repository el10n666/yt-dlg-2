const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { runHelper } = require('../src/zapret-helper');

const ZDIR = 'C:\\Users\\Иван\\AppData\\Roaming\\yt-dlg-2\\zapret';
const WINWS = path.win32.join(ZDIR, 'bin', 'winws.exe');
let seq = 0;
const pipePath = () => `\\\\.\\pipe\\ytdlg-test-${process.pid}-${Date.now()}-${++seq}`;

// Сервер на стороне приложения: принимает подключение помощника, шлёт команды, собирает ответы.
function appSide(pipe) {
  const events = [];
  let sock;
  const waiters = [];
  const server = net.createServer((s) => {
    sock = s;
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        events.push(msg);
        for (const w of waiters.splice(0)) w();
      }
    });
    for (const w of waiters.splice(0)) w();
  });
  const listening = new Promise((r) => server.listen(pipe, r));
  const until = (pred) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout; events=' + JSON.stringify(events))), 3000);
    const check = () => { if (pred()) { clearTimeout(t); resolve(); } else waiters.push(check); };
    check();
  });
  return {
    events, listening,
    connected: () => until(() => Boolean(sock)),
    send: (m) => sock.write(JSON.stringify(m) + '\n'),
    waitEvents: (n) => until(() => events.length >= n),
    closeSock: () => sock.destroy(),
    close: () => new Promise((r) => { try { sock && sock.destroy(); } catch {} server.close(() => r()); }),
  };
}

function fakeProc() {
  const p = new EventEmitter();
  p.pid = 4242;
  p.killed = false;
  p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit', null)); };
  return p;
}

function setup(over = {}) {
  const pipe = pipePath();
  const app = appSide(pipe);
  const calls = { spawn: [], cleanup: 0, verify: 0 };
  let proc;
  const helper = runHelper({
    pipePath: pipe,
    zapretDir: ZDIR,
    spawn: (exe, args) => { calls.spawn.push({ exe, args }); proc = fakeProc(); return proc; },
    verify: () => { calls.verify++; return over.verifyResult || { ok: true, bad: [] }; },
    cleanup: async () => { calls.cleanup++; },
    ...over.deps,
  });
  return { app, helper, calls, proc: () => proc };
}

test('helper starts winws.exe from the fixed path after the manifest check and reports the pid', async () => {
  const t = setup();
  await t.app.listening; await t.app.connected();
  t.app.send({ cmd: 'start', args: ['--wf-tcp=80,443', '--new'] });
  await t.app.waitEvents(1);
  assert.deepStrictEqual(t.app.events[0], { ok: true, event: 'started', pid: 4242 });
  assert.strictEqual(t.calls.spawn[0].exe, WINWS);
  assert.deepStrictEqual(t.calls.spawn[0].args, ['--wf-tcp=80,443', '--new']);
  assert.strictEqual(t.calls.verify, 1);
  t.app.send({ cmd: 'quit' });
  await t.helper;
  await t.app.close();
});

test('helper refuses to start when the manifest check fails and says which file is bad', async () => {
  const t = setup({ verifyResult: { ok: false, bad: ['bin/winws.exe'] } });
  await t.app.listening; await t.app.connected();
  t.app.send({ cmd: 'start', args: ['--new'] });
  await t.app.waitEvents(1);
  assert.strictEqual(t.app.events[0].ok, false);
  assert.match(t.app.events[0].error, /winws\.exe/);
  assert.strictEqual(t.calls.spawn.length, 0);
  t.app.send({ cmd: 'quit' });
  await t.helper;
  await t.app.close();
});

test('helper rejects an invalid command, never spawns and keeps listening', async () => {
  const t = setup();
  await t.app.listening; await t.app.connected();
  t.app.send({ cmd: 'start', exe: 'C:\\Windows\\System32\\cmd.exe', args: ['calc.exe'] });
  await t.app.waitEvents(1);
  assert.strictEqual(t.app.events[0].ok, false);
  assert.strictEqual(t.calls.spawn.length, 0);
  t.app.send({ cmd: 'start', args: ['--new'] }); // после отказа помощник работает дальше
  await t.app.waitEvents(2);
  assert.strictEqual(t.app.events[1].event, 'started');
  t.app.send({ cmd: 'quit' });
  await t.helper;
  await t.app.close();
});

test('helper survives garbage on the pipe', async () => {
  const t = setup();
  await t.app.listening; await t.app.connected();
  t.app.send('not an object');
  t.app.send({ cmd: 'start', args: ['--new'] });
  await t.app.waitEvents(2);
  assert.strictEqual(t.app.events[0].ok, false);
  assert.strictEqual(t.app.events[1].event, 'started');
  t.app.send({ cmd: 'quit' });
  await t.helper;
  await t.app.close();
});

test('stop kills winws, runs the driver cleanup and confirms', async () => {
  const t = setup();
  await t.app.listening; await t.app.connected();
  t.app.send({ cmd: 'start', args: ['--new'] });
  await t.app.waitEvents(1);
  t.app.send({ cmd: 'stop' });
  await t.app.waitEvents(2);
  assert.deepStrictEqual(t.app.events[1], { ok: true, event: 'stopped' });
  assert.strictEqual(t.proc().killed, true);
  assert.strictEqual(t.calls.cleanup, 1);
  t.app.send({ cmd: 'quit' });
  await t.helper;
  await t.app.close();
});

test('a second start replaces the running winws instead of running two', async () => {
  const t = setup();
  await t.app.listening; await t.app.connected();
  t.app.send({ cmd: 'start', args: ['--new'] });
  await t.app.waitEvents(1);
  const first = t.proc();
  t.app.send({ cmd: 'start', args: ['--new', '--dpi-desync=fake'] });
  await t.app.waitEvents(2);
  assert.strictEqual(first.killed, true);
  assert.strictEqual(t.calls.spawn.length, 2);
  t.app.send({ cmd: 'quit' });
  await t.helper;
  await t.app.close();
});

test('when winws exits on its own the helper reports it with the exit code', async () => {
  const t = setup();
  await t.app.listening; await t.app.connected();
  t.app.send({ cmd: 'start', args: ['--new'] });
  await t.app.waitEvents(1);
  t.proc().emit('exit', 1);
  await t.app.waitEvents(2);
  assert.deepStrictEqual(t.app.events[1], { ok: false, event: 'exited', code: 1 });
  t.app.send({ cmd: 'quit' });
  await t.helper;
  await t.app.close();
});

test('if the app disappears (pipe closes) the helper stops winws and exits by itself', async () => {
  const t = setup();
  await t.app.listening; await t.app.connected();
  t.app.send({ cmd: 'start', args: ['--new'] });
  await t.app.waitEvents(1);
  t.app.closeSock();
  await t.helper; // должен завершиться без команды quit
  assert.strictEqual(t.proc().killed, true);
  assert.strictEqual(t.calls.cleanup >= 1, true);
  await t.app.close();
});

test('helper exits quietly when the app pipe is not there', async () => {
  const res = await runHelper({ pipePath: pipePath(), zapretDir: ZDIR, spawn: () => { throw new Error('no'); }, verify: () => ({ ok: true, bad: [] }), cleanup: async () => {}, connectTimeoutMs: 300 });
  assert.strictEqual(res.connected, false);
});
