const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { startDownload } = require('../src/downloader');

function fakeSpawn() {
  const calls = [];
  const spawn = (exe, args, opts) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.killed = false;
    p.kill = () => { p.killed = true; p.emit('close', null); };
    calls.push({ exe, args, opts, p });
    return p;
  };
  return { spawn, calls };
}

function base(extra = {}) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlg-dl-'));
  const f = fakeSpawn();
  return { f, opts: { url: 'https://youtu.be/x', mode: 'video', outDir, ytdlp: 'yt-dlp.exe', ffmpegDir: 'bin', spawn: f.spawn, ...extra } };
}

test('progress lines reach onProgress and exit 0 gives ok', async () => {
  const { f, opts } = base();
  const seen = [];
  const { done } = startDownload(opts, (p) => seen.push(p));
  const proc = f.calls[0].p;
  proc.stdout.emit('data', Buffer.from('PROG| 42.5%|1.2MiB/s|00:31\n'));
  proc.emit('close', 0);
  const r = await done;
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(seen, [{ percent: 42.5, speed: '1.2MiB/s', eta: '00:31' }]);
});

test('nonzero exit maps stderr to a Russian message', async () => {
  const { f, opts } = base();
  const { done } = startDownload(opts, () => {});
  const proc = f.calls[0].p;
  proc.stderr.emit('data', Buffer.from('ERROR: Private video'));
  proc.emit('close', 1);
  const r = await done;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.message, 'Видео недоступно или закрыто автором');
});

test('cancel kills the process', async () => {
  const { f, opts } = base();
  const { done, cancel } = startDownload(opts, () => {});
  cancel();
  const r = await done;
  assert.strictEqual(f.calls[0].p.killed, true);
  assert.strictEqual(r.ok, false);
});

test('invalid link fails before spawning', async () => {
  const { f, opts } = base({ url: 'привет' });
  const r = await startDownload(opts, () => {}).done;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(f.calls.length, 0);
  assert.ok(r.message.length > 0);
});

test('link with surrounding whitespace is cleaned and accepted', async () => {
  const { f, opts } = base({ url: '  https://youtu.be/x\n' });
  const { done } = startDownload(opts, () => {});
  f.calls[0].p.emit('close', 0);
  assert.strictEqual((await done).ok, true);
  assert.strictEqual(f.calls[0].args[f.calls[0].args.length - 1], 'https://youtu.be/x');
});

test('processing lines are forwarded as a stage', async () => {
  const { f, opts } = base();
  const seen = [];
  const { done } = startDownload(opts, (p) => seen.push(p));
  f.calls[0].p.stdout.emit('data', Buffer.from('PP|started\n'));
  f.calls[0].p.emit('close', 0);
  await done;
  assert.deepStrictEqual(seen, [{ stage: 'processing' }]);
});

test('failure result carries exit code and stderr tail for the support log', async () => {
  const { f, opts } = base();
  const { done } = startDownload(opts, () => {});
  f.calls[0].p.stderr.emit('data', Buffer.from('ERROR: Private video'));
  f.calls[0].p.emit('close', 1);
  const r = await done;
  assert.strictEqual(r.code, 1);
  assert.ok(r.stderr.includes('Private video'));
});

test('not enough free space fails before spawning', async () => {
  const { f, opts } = base({ minFreeBytes: Number.MAX_SAFE_INTEGER });
  const r = await startDownload(opts, () => {}).done;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.message, 'Не хватает места на диске');
  assert.strictEqual(f.calls.length, 0);
});

test('cancel kills the whole process tree', async () => {
  const killed = [];
  const { f, opts } = base({ killTree: (p) => { killed.push(p); p.emit('close', null); } });
  const { done, cancel } = startDownload(opts, () => {});
  cancel();
  await done;
  assert.strictEqual(killed.length, 1);
  assert.strictEqual(killed[0], f.calls[0].p);
});

test('user options reach the yt-dlp command line', async () => {
  const { f, opts } = base({ options: { cookiesBrowser: 'firefox', proxy: '127.0.0.1:8080', playlist: false } });
  const { done } = startDownload(opts, () => {});
  const a = f.calls[0].args;
  assert.strictEqual(a[a.indexOf('--cookies-from-browser') + 1], 'firefox');
  assert.strictEqual(a[a.indexOf('--proxy') + 1], 'http://127.0.0.1:8080');
  f.calls[0].p.emit('close', 0);
  await done;
});

test('unwritable outDir fails before spawning', async () => {
  const { f, opts } = base({ outDir: path.join(os.tmpdir(), 'ytdlg-no', 'a\0b') });
  const r = await startDownload(opts, () => {}).done;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(f.calls.length, 0);
});
