const test = require('node:test');
const assert = require('node:assert');
const r = require('../src/zapret-run');

const WINWS = 'C:\\Users\\Иван\\AppData\\Roaming\\yt-dlg-2\\zapret\\bin\\winws.exe';

test('validateHelperCommand accepts a start command with only winws options and returns the fixed exe', () => {
  const c = r.validateHelperCommand({ cmd: 'start', args: ['--wf-tcp=80,443', '--filter-tcp=443', '--new', '--dpi-desync=fake'] }, { winws: WINWS });
  assert.deepStrictEqual(c, { cmd: 'start', exe: WINWS, args: ['--wf-tcp=80,443', '--filter-tcp=443', '--new', '--dpi-desync=fake'] });
});

test('validateHelperCommand accepts stop and quit', () => {
  assert.deepStrictEqual(r.validateHelperCommand({ cmd: 'stop' }, { winws: WINWS }), { cmd: 'stop' });
  assert.deepStrictEqual(r.validateHelperCommand({ cmd: 'quit' }, { winws: WINWS }), { cmd: 'quit' });
});

test('validateHelperCommand ignores any exe path sent by the caller', () => {
  const c = r.validateHelperCommand({ cmd: 'start', exe: 'C:\\Windows\\System32\\cmd.exe', args: ['--new'] }, { winws: WINWS });
  assert.strictEqual(c.exe, WINWS);
});

test('validateHelperCommand rejects anything that is not a plain winws option', () => {
  const bad = [
    ['calc.exe'], ['--new', '& calc'], ['--a=1\n--b'], ['-x'], [''], ['--'], ['--dpi desync'], [42], [null],
    ['--debug=@C:\\Windows\\win.ini'], ['--hostlist=C:\\Windows\\System32\\config\\SAM'],
  ];
  for (const args of bad) assert.throws(() => r.validateHelperCommand({ cmd: 'start', args }, { winws: WINWS }), undefined, JSON.stringify(args));
});

test('validateHelperCommand only allows file options that point inside the zapret folder', () => {
  const ok = r.validateHelperCommand({ cmd: 'start', args: ['--hostlist=C:\\Users\\Иван\\AppData\\Roaming\\yt-dlg-2\\zapret\\lists\\list-general.txt'] }, { winws: WINWS });
  assert.strictEqual(ok.cmd, 'start');
  assert.throws(() => r.validateHelperCommand({ cmd: 'start', args: ['--hostlist=C:\\Users\\Иван\\secret.txt'] }, { winws: WINWS }));
  assert.throws(() => r.validateHelperCommand({ cmd: 'start', args: ['--hostlist=C:\\Users\\Иван\\AppData\\Roaming\\yt-dlg-2\\zapret\\lists\\..\\..\\secret.txt'] }, { winws: WINWS }));
});

test('validateHelperCommand rejects unknown commands, non-objects and oversized argument lists', () => {
  for (const bad of [null, 'start', 5, {}, { cmd: 'exec' }, { cmd: 'start' }, { cmd: 'start', args: 'x' }]) {
    assert.throws(() => r.validateHelperCommand(bad, { winws: WINWS }), undefined, JSON.stringify(bad));
  }
  assert.throws(() => r.validateHelperCommand({ cmd: 'start', args: new Array(500).fill('--new') }, { winws: WINWS }));
});

test('buildElevatedLaunch produces one PowerShell line, quotes paths safely and sets a hidden window', () => {
  const l = r.buildElevatedLaunch({ exe: "C:\\App's\\Скачать видео.exe", args: ['--zapret-helper', '--pipe=\\\\.\\pipe\\yt-1234'] });
  assert.strictEqual(l.file, 'powershell.exe');
  assert.ok(l.args.includes('-NoProfile'));
  const command = l.args[l.args.indexOf('-Command') + 1];
  assert.match(command, /Start-Process/);
  assert.match(command, /-Verb RunAs/);
  assert.match(command, /-WindowStyle Hidden/);
  assert.match(command, /'C:\\App''s\\Скачать видео\.exe'/); // одинарная кавычка в пути удвоена
  assert.ok(!/\n/.test(command));
});

test('buildElevatedLaunch refuses arguments with quotes or newlines instead of trying to escape them', () => {
  assert.throws(() => r.buildElevatedLaunch({ exe: 'C:\\a.exe', args: ['--x="y"'] }));
  assert.throws(() => r.buildElevatedLaunch({ exe: 'C:\\a.exe', args: ['--x\n--y'] }));
});

// --- проверка сети ---

const TARGETS = [
  { name: 'discord', url: 'https://discord.com' },
  { name: 'gateway', url: 'https://gateway.discord.gg' },
  { name: 'youtube', url: 'https://www.youtube.com' },
  { name: 'video', url: 'https://redirector.googlevideo.com' },
];

test('checkTargets counts a target as reachable on any HTTP answer, even 403 or 404', async () => {
  const fetchFn = async () => ({ status: 404 });
  assert.deepStrictEqual(await r.checkTargets({ targets: TARGETS, fetchFn, timeoutMs: 50 }), { passed: 4, total: 4, failed: [] });
});

test('checkTargets counts timeouts and network errors as failures and names them', async () => {
  const fetchFn = async (url) => {
    if (url.includes('discord.com')) throw new Error('ECONNRESET');
    if (url.includes('googlevideo')) return new Promise(() => {}); // зависает
    return { status: 200 };
  };
  const res = await r.checkTargets({ targets: TARGETS, fetchFn, timeoutMs: 30 });
  assert.strictEqual(res.passed, 2);
  assert.strictEqual(res.total, 4);
  assert.deepStrictEqual(res.failed.sort(), ['discord', 'video']);
});

test('checkTargets runs requests in parallel so a hung target does not multiply the wait', async () => {
  const fetchFn = () => new Promise(() => {});
  const t0 = Date.now();
  await r.checkTargets({ targets: TARGETS, fetchFn, timeoutMs: 80 });
  assert.ok(Date.now() - t0 < 400, 'took ' + (Date.now() - t0));
});

test('default targets cover Discord, its voice host and YouTube video hosts', () => {
  const urls = r.DEFAULT_TARGETS.map((t) => t.url).join(' ');
  for (const host of ['discord.com', 'gateway.discord.gg', 'youtube.com', 'googlevideo.com']) assert.ok(urls.includes(host), host);
});
