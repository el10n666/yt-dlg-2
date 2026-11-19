const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const z = require('../src/zapret');

const BAT = [
  '@echo off',
  'chcp 65001 > nul',
  'call service.bat status_zapret',
  'set "BIN=%~dp0bin\\"',
  'set "LISTS=%~dp0lists\\"',
  'cd /d %BIN%',
  '',
  'start "zapret: %~n0" /min "%BIN%winws.exe" --wf-tcp=80,443,%GameFilterTCP% --wf-udp=443,%GameFilterUDP% ^',
  '--filter-udp=443 --hostlist="%LISTS%list-general.txt" --dpi-desync=fake --dpi-desync-fake-quic="%BIN%quic_initial_www_google_com.bin" --new ^',
  '--filter-tcp=80,443 --ipset="%LISTS%ipset-all.txt" --dpi-desync=multisplit',
  '',
].join('\r\n');

const dirs = { binDir: 'C:\\Users\\Иван Петров\\z\\bin', listsDir: 'C:\\Users\\Иван Петров\\z\\lists' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlg-zap-'));

test('parseStrategy joins ^ continuation lines and substitutes paths and game filter ports', () => {
  const { args } = z.parseStrategy(BAT, dirs);
  assert.strictEqual(args[0], '--wf-tcp=80,443,12');
  assert.strictEqual(args[1], '--wf-udp=443,12');
  assert.ok(args.includes('--hostlist=C:\\Users\\Иван Петров\\z\\lists\\list-general.txt'));
  assert.ok(args.includes('--dpi-desync-fake-quic=C:\\Users\\Иван Петров\\z\\bin\\quic_initial_www_google_com.bin'));
  assert.ok(args.includes('--new'));
  assert.strictEqual(args[args.length - 1], '--dpi-desync=multisplit');
});

test('parseStrategy output has no quotes, no percent signs, and every token is an option', () => {
  const { args } = z.parseStrategy(BAT, dirs);
  for (const a of args) {
    assert.ok(a.startsWith('--'), a);
    assert.ok(!a.includes('"') && !a.includes('%'), a);
  }
});

test('parseStrategy works with LF line endings too', () => {
  assert.deepStrictEqual(z.parseStrategy(BAT.replace(/\r\n/g, '\n'), dirs).args, z.parseStrategy(BAT, dirs).args);
});

test('parseStrategy refuses a script with an unknown variable instead of passing it on', () => {
  assert.throws(() => z.parseStrategy(BAT.replace('multisplit', '%Evil%'), dirs), /неизвестн|unknown/i);
});

test('parseStrategy refuses a script without a winws.exe line', () => {
  assert.throws(() => z.parseStrategy('@echo off\r\necho hi\r\n', dirs), /winws/i);
});

test('parseStrategy refuses a token that is not an option (nothing else may reach the elevated process)', () => {
  assert.throws(() => z.parseStrategy(BAT.replace('--dpi-desync=multisplit', 'calc.exe'), dirs), /--/);
});

test('listStrategies returns general scripts in natural order, general first, ignoring other files', () => {
  const d = tmp();
  for (const f of ['general (ALT10).bat', 'general.bat', 'general (ALT2).bat', 'service.bat', 'general (ALT).bat', 'readme.txt']) fs.writeFileSync(path.join(d, f), '');
  assert.deepStrictEqual(z.listStrategies(d), ['general', 'general (ALT)', 'general (ALT2)', 'general (ALT10)']);
});

test('orderStrategies puts the remembered one first, then the usual best guesses, then the rest', () => {
  const names = ['general', 'general (ALT)', 'general (ALT11)', 'general (ALT13)', 'general (ALT2)', 'general (FAKE TLS AUTO)'];
  assert.deepStrictEqual(z.orderStrategies(names, 'general (ALT2)').slice(0, 3), ['general (ALT2)', 'general', 'general (ALT11)']);
  assert.deepStrictEqual(z.orderStrategies(names, 'gone').slice(0, 2), ['general', 'general (ALT11)']);
  assert.strictEqual(z.orderStrategies(names, '').length, names.length);
});

test('ensureUserLists creates the user lists once and never overwrites the user edits', () => {
  const d = tmp();
  z.ensureUserLists(d);
  for (const f of ['ipset-exclude-user.txt', 'list-general-user.txt', 'list-exclude-user.txt']) assert.ok(fs.existsSync(path.join(d, f)), f);
  fs.writeFileSync(path.join(d, 'list-general-user.txt'), 'my.example.org');
  z.ensureUserLists(d);
  assert.strictEqual(fs.readFileSync(path.join(d, 'list-general-user.txt'), 'utf8'), 'my.example.org');
});

test('compareVersions orders zapret release tags', () => {
  assert.ok(z.compareVersions('1.10.4', '1.9.9d') > 0);
  assert.ok(z.compareVersions('1.9.9d', '1.9.9') > 0);
  assert.ok(z.compareVersions('1.9.9', '1.9.9d') < 0);
  assert.strictEqual(z.compareVersions('1.10.4', '1.10.4'), 0);
});

// Заготовка установки: bin/winws.exe, bin/WinDivert64.sys, lists/, general.bat, version.txt, manifest.json
function makeInstall(root, version, winws = 'WINWS') {
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lists'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'winws.exe'), winws);
  fs.writeFileSync(path.join(root, 'bin', 'WinDivert64.sys'), 'SYS' + version);
  fs.writeFileSync(path.join(root, 'general.bat'), BAT);
  fs.writeFileSync(path.join(root, 'lists', 'list-general.txt'), 'discord.com');
  fs.writeFileSync(path.join(root, 'version.txt'), version);
  z.writeManifest(root);
  return root;
}

test('verifyManifest accepts an intact install and names a tampered file', () => {
  const d = makeInstall(tmp(), '1.10.4');
  assert.deepStrictEqual(z.verifyManifest(d), { ok: true, bad: [] });
  fs.writeFileSync(path.join(d, 'bin', 'winws.exe'), 'EVIL');
  const r = z.verifyManifest(d);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.bad, ['bin/winws.exe']);
});

test('verifyManifest fails when the manifest or a binary is missing', () => {
  const d = makeInstall(tmp(), '1.10.4');
  fs.rmSync(path.join(d, 'bin', 'WinDivert64.sys'));
  assert.strictEqual(z.verifyManifest(d).ok, false);
  fs.rmSync(path.join(d, 'manifest.json'));
  assert.strictEqual(z.verifyManifest(d).ok, false);
});

test('prepareZapret installs the bundled copy on first run', () => {
  const root = tmp();
  const bundled = makeInstall(path.join(root, 'bundled'), '1.10.4');
  const user = path.join(root, 'user', 'zapret');
  const r = z.prepareZapret({ bundledDir: bundled, userDir: user });
  assert.strictEqual(r.action, 'installed');
  assert.strictEqual(fs.readFileSync(path.join(user, 'version.txt'), 'utf8'), '1.10.4');
  assert.strictEqual(z.prepareZapret({ bundledDir: bundled, userDir: user }).action, 'current');
});

test('prepareZapret repairs a tampered or broken user copy from the bundled one', () => {
  const root = tmp();
  const bundled = makeInstall(path.join(root, 'bundled'), '1.10.4');
  const user = path.join(root, 'user', 'zapret');
  z.prepareZapret({ bundledDir: bundled, userDir: user });
  fs.writeFileSync(path.join(user, 'bin', 'winws.exe'), 'EVIL');
  assert.strictEqual(z.prepareZapret({ bundledDir: bundled, userDir: user }).action, 'repaired');
  assert.strictEqual(fs.readFileSync(path.join(user, 'bin', 'winws.exe'), 'utf8'), 'WINWS');
});

test('prepareZapret upgrades to a newer bundled version, keeps user lists, and keeps the previous version for rollback', () => {
  const root = tmp();
  const user = path.join(root, 'user', 'zapret');
  z.prepareZapret({ bundledDir: makeInstall(path.join(root, 'b1'), '1.10.4'), userDir: user });
  fs.writeFileSync(path.join(user, 'lists', 'list-general-user.txt'), 'my.example.org');
  const r = z.prepareZapret({ bundledDir: makeInstall(path.join(root, 'b2'), '1.10.5'), userDir: user });
  assert.strictEqual(r.action, 'upgraded');
  assert.strictEqual(fs.readFileSync(path.join(user, 'version.txt'), 'utf8'), '1.10.5');
  assert.strictEqual(fs.readFileSync(path.join(user, 'lists', 'list-general-user.txt'), 'utf8'), 'my.example.org');
  assert.strictEqual(fs.readFileSync(path.join(user + '.prev', 'version.txt'), 'utf8'), '1.10.4');
});

test('prepareZapret never downgrades to an older bundled version', () => {
  const root = tmp();
  const user = path.join(root, 'user', 'zapret');
  z.prepareZapret({ bundledDir: makeInstall(path.join(root, 'b2'), '1.10.5'), userDir: user });
  assert.strictEqual(z.prepareZapret({ bundledDir: makeInstall(path.join(root, 'b1'), '1.10.4'), userDir: user }).action, 'current');
});

test('rollbackZapret restores the previous version', () => {
  const root = tmp();
  const user = path.join(root, 'user', 'zapret');
  z.prepareZapret({ bundledDir: makeInstall(path.join(root, 'b1'), '1.10.4'), userDir: user });
  z.prepareZapret({ bundledDir: makeInstall(path.join(root, 'b2'), '1.10.5'), userDir: user });
  assert.strictEqual(z.rollbackZapret(user), true);
  assert.strictEqual(fs.readFileSync(path.join(user, 'version.txt'), 'utf8'), '1.10.4');
  assert.strictEqual(z.rollbackZapret(user), false); // откатывать больше некуда
});

// --- автоподбор стратегии ---

function harness(passMap) {
  const log = { started: [], stopped: 0, progress: [] };
  let current = null;
  return {
    log,
    opts: {
      start: async (n) => { current = n; log.started.push(n); },
      stop: async () => { log.stopped++; current = null; },
      check: async () => passMap[current] || { passed: 0, total: 4 },
      wait: async () => {},
      onProgress: (p) => log.progress.push(p),
      isCancelled: () => false,
    },
  };
}
const FULL = { passed: 4, total: 4 };

test('pickStrategy stops at the first strategy that passes every check', async () => {
  const h = harness({ 'general (ALT2)': FULL });
  const r = await z.pickStrategy({ names: ['general', 'general (ALT)', 'general (ALT2)'], preferred: '', ...h.opts });
  assert.deepStrictEqual(r, { name: 'general (ALT2)', partial: false });
  assert.deepStrictEqual(h.log.started, ['general', 'general (ALT)', 'general (ALT2)']);
  assert.deepStrictEqual(h.log.progress.map((p) => p.index), [1, 2, 3]);
  assert.strictEqual(h.log.progress[0].total, 3);
});

test('pickStrategy tries the remembered strategy first and stops there when it still works', async () => {
  const h = harness({ 'general (ALT2)': FULL });
  const r = await z.pickStrategy({ names: ['general', 'general (ALT2)'], preferred: 'general (ALT2)', ...h.opts });
  assert.strictEqual(r.name, 'general (ALT2)');
  assert.deepStrictEqual(h.log.started, ['general (ALT2)']);
});

test('pickStrategy falls back to the best partial result and says so', async () => {
  const h = harness({ general: { passed: 1, total: 4 }, 'general (ALT)': { passed: 3, total: 4 } });
  const r = await z.pickStrategy({ names: ['general', 'general (ALT)', 'general (ALT2)'], preferred: '', ...h.opts });
  assert.deepStrictEqual(r, { name: 'general (ALT)', partial: true });
  assert.strictEqual(h.log.started[h.log.started.length - 1], 'general (ALT)'); // лучшая оставлена включённой
});

test('pickStrategy turns everything off and returns null when nothing helps', async () => {
  const h = harness({});
  const r = await z.pickStrategy({ names: ['general', 'general (ALT)'], preferred: '', ...h.opts });
  assert.strictEqual(r, null);
  assert.ok(h.log.stopped >= 1);
});

test('pickStrategy stops promptly when cancelled and leaves nothing running', async () => {
  const h = harness({ 'general (ALT2)': FULL });
  let n = 0;
  const r = await z.pickStrategy({ names: ['general', 'general (ALT)', 'general (ALT2)'], preferred: '', ...h.opts, isCancelled: () => ++n > 1 });
  assert.deepStrictEqual(r, { cancelled: true });
  assert.ok(h.log.stopped >= 1);
  assert.ok(h.log.started.length < 3);
});

test('pickStrategy survives a strategy that fails to start and moves on', async () => {
  const h = harness({ 'general (ALT)': FULL });
  const start = h.opts.start;
  h.opts.start = async (n) => { if (n === 'general') throw new Error('crashed'); return start(n); };
  const r = await z.pickStrategy({ names: ['general', 'general (ALT)'], preferred: '', ...h.opts });
  assert.strictEqual(r.name, 'general (ALT)');
});
