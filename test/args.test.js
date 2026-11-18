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
  assert.strictEqual(cleanUrl('ftp://host/file'), null);
});
test('buildArgs common flags', () => {
  const a = buildArgs({ ...base, mode: 'video' });
  for (const f of ['--no-playlist', '--windows-filenames', '--newline']) assert.ok(a.includes(f), f);
  assert.strictEqual(a[a.indexOf('--ffmpeg-location') + 1], base.ffmpegDir);
  assert.ok(a[a.indexOf('-o') + 1].startsWith(base.outDir));
  assert.strictEqual(a[a.length - 1], base.url);
});
test('buildArgs has a download and a postprocess progress template', () => {
  const a = buildArgs({ ...base, mode: 'video' });
  const templates = a.filter((x, i) => a[i - 1] === '--progress-template');
  assert.strictEqual(templates.length, 2);
  assert.ok(templates.some((t) => t.startsWith('download:PROG|')));
  assert.ok(templates.some((t) => t.startsWith('postprocess:PP|')));
});
test('buildArgs downloads one item even for playlist or channel URLs', () => {
  const a = buildArgs({ ...base, mode: 'video' });
  assert.strictEqual(a[a.indexOf('--playlist-items') + 1], '1');
});
test('buildArgs video mode prefers H.264 and m4a so files play on older Windows', () => {
  const a = buildArgs({ ...base, mode: 'video' });
  const f = a[a.indexOf('-f') + 1];
  assert.ok(f.startsWith('bv*[vcodec^=avc1]+ba[ext=m4a]'), f);
  assert.ok(f.endsWith('/bv*+ba/b'), f); // запасной вариант: скачать хоть что-то
  assert.strictEqual(a[a.indexOf('--merge-output-format') + 1], 'mp4');
  assert.ok(!a.includes('-x'));
});
test('buildArgs audio mode', () => {
  const a = buildArgs({ ...base, mode: 'audio' });
  assert.ok(a.includes('-x'));
  assert.strictEqual(a[a.indexOf('--audio-format') + 1], 'mp3');
});
test('parseProgress parses a progress line', () => {
  assert.deepStrictEqual(parseProgress('PROG| 42.5%|1.2MiB/s|00:31'), { percent: 42.5, speed: '1.2MiB/s', eta: '00:31' });
});
test('parseProgress tolerates unknown speed, eta and percent', () => {
  assert.deepStrictEqual(parseProgress('PROG|  N/A|Unknown B/s|Unknown'), { percent: null, speed: '', eta: '' });
  assert.deepStrictEqual(parseProgress('PROG| 10.0%|Unknown B/s|00:05'), { percent: 10, speed: '', eta: '00:05' });
});
test('parseProgress recognises a postprocess line', () => {
  assert.deepStrictEqual(parseProgress('PP|started'), { stage: 'processing' });
});
test('parseProgress ignores other lines', () => {
  assert.strictEqual(parseProgress('[youtube] Extracting URL'), null);
});
