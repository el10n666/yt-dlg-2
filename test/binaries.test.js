const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveYtDlp, updateYtDlp } = require('../src/binaries');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlg-'));
  const bundledDir = path.join(root, 'bundled');
  const userDir = path.join(root, 'user');
  fs.mkdirSync(bundledDir);
  fs.writeFileSync(path.join(bundledDir, 'yt-dlp.exe'), 'GOOD');
  return { bundledDir, userDir, userExe: path.join(userDir, 'yt-dlp.exe') };
}

test('resolveYtDlp prefers the user copy, else the bundled one', () => {
  const { bundledDir, userDir, userExe } = setup();
  assert.strictEqual(resolveYtDlp({ bundledDir, userDir }), path.join(bundledDir, 'yt-dlp.exe'));
  fs.mkdirSync(userDir);
  fs.writeFileSync(userExe, 'X');
  assert.strictEqual(resolveYtDlp({ bundledDir, userDir }), userExe);
});

test('updateYtDlp returns updated when the version changes', async () => {
  const { bundledDir, userDir } = setup();
  const versions = ['2026.01.01', '2026.02.01'];
  const run = async (exe, args) => (args[0] === '--version' ? versions.shift() : '');
  assert.strictEqual(await updateYtDlp({ bundledDir, userDir, run }), 'updated');
});

test('updateYtDlp returns current when the version is unchanged', async () => {
  const { bundledDir, userDir } = setup();
  const run = async (exe, args) => (args[0] === '--version' ? '2026.01.01' : '');
  assert.strictEqual(await updateYtDlp({ bundledDir, userDir, run }), 'current');
});

test('updateYtDlp rolls back when the updated binary is broken', async () => {
  const { bundledDir, userDir, userExe } = setup();
  let updated = false;
  const run = async (exe, args) => {
    if (args[0] === '--update-to') { fs.writeFileSync(userExe, 'BROKEN'); updated = true; return ''; }
    if (updated) throw new Error('crash');
    return '2026.01.01';
  };
  assert.strictEqual(await updateYtDlp({ bundledDir, userDir, run }), 'skipped');
  assert.strictEqual(fs.readFileSync(userExe, 'utf8'), 'GOOD');
});

test('updateYtDlp repairs a truncated user exe from the bundled copy', async () => {
  const { bundledDir, userDir, userExe } = setup();
  fs.mkdirSync(userDir);
  fs.writeFileSync(userExe, 'BROKEN');
  const run = async (exe) => {
    if (fs.readFileSync(exe, 'utf8') === 'BROKEN') throw new Error('not a valid exe');
    return '2026.01.01';
  };
  assert.strictEqual(await updateYtDlp({ bundledDir, userDir, run }), 'current');
  assert.strictEqual(fs.readFileSync(userExe, 'utf8'), 'GOOD');
});

test('updateYtDlp does not throw when offline', async () => {
  const { bundledDir, userDir } = setup();
  const run = async () => { throw new Error('network'); };
  assert.strictEqual(await updateYtDlp({ bundledDir, userDir, run }), 'skipped');
});

test('updateYtDlp requests only the stable channel', async () => {
  const { bundledDir, userDir } = setup();
  const calls = [];
  const run = async (exe, args) => { calls.push(args.join(' ')); return '1'; };
  await updateYtDlp({ bundledDir, userDir, run });
  assert.ok(calls.includes('--update-to stable'), calls.join('|'));
});
