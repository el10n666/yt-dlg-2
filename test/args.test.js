const test = require('node:test');
const assert = require('node:assert');
const { buildArgs, parseProgress, cleanUrl } = require('../src/args');

const base = { url: 'https://youtu.be/x', outDir: 'C:\\Users\\Мама\\Downloads', ffmpegDir: 'C:\\app\\bin' };

test('cleanUrl trims spaces and newlines', () => {
  assert.strictEqual(cleanUrl('  https://youtu.be/x\n'), 'https://youtu.be/x');
});
test('cleanUrl rejects non-http text', () => {
  assert.strictEqual(cleanUrl('привет'), null);
  assert.strictEqual(cleanUrl(''), null);
  assert.strictEqual(cleanUrl('file:///c:/secret.txt'), null);
});
test('buildArgs common flags', () => {
  const a = buildArgs({ ...base, mode: 'video' });
  for (const f of ['--no-playlist', '--windows-filenames', '--newline']) assert.ok(a.includes(f), f);
  assert.strictEqual(a[a.indexOf('--ffmpeg-location') + 1], base.ffmpegDir);
  assert.ok(a.includes('--progress-template'));
  assert.ok(a[a.indexOf('-o') + 1].startsWith(base.outDir));
  assert.strictEqual(a[a.length - 1], base.url);
});
test('buildArgs video mode', () => {
  const a = buildArgs({ ...base, mode: 'video' });
  assert.strictEqual(a[a.indexOf('-f') + 1], 'bv*+ba/b');
  assert.strictEqual(a[a.indexOf('--merge-output-format') + 1], 'mp4');
  assert.ok(!a.includes('-x'));
});
test('buildArgs audio mode', () => {
  const a = buildArgs({ ...base, mode: 'audio' });
  assert.ok(a.includes('-x'));
  assert.strictEqual(a[a.indexOf('--audio-format') + 1], 'mp3');
});
test('parseProgress parses a progress line', () => {
  assert.deepStrictEqual(parseProgress('PROG 42.5% 1.2MiB/s 00:31'), { percent: 42.5, speed: '1.2MiB/s', eta: '00:31' });
});
test('parseProgress ignores other lines', () => {
  assert.strictEqual(parseProgress('[youtube] Extracting URL'), null);
});
