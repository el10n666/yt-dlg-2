const test = require('node:test');
const assert = require('node:assert');
const { detectPlatform, shortLink } = require('../renderer/platform');

test('detects YouTube on all its hosts', () => {
  for (const u of ['https://www.youtube.com/watch?v=x', 'https://youtu.be/x', 'https://m.youtube.com/watch?v=x', 'https://music.youtube.com/watch?v=x']) {
    assert.strictEqual(detectPlatform(u).name, 'YouTube', u);
  }
});

test('detects Russian platforms', () => {
  assert.strictEqual(detectPlatform('https://vk.com/video-1_2').name, 'ВКонтакте');
  assert.strictEqual(detectPlatform('https://vkvideo.ru/video-1_2').name, 'ВКонтакте');
  assert.strictEqual(detectPlatform('https://rutube.ru/video/abc/').name, 'Rutube');
  assert.strictEqual(detectPlatform('https://ok.ru/video/1').name, 'Одноклассники');
});

test('detects social platforms', () => {
  assert.strictEqual(detectPlatform('https://www.instagram.com/reel/abc/').name, 'Instagram');
  assert.strictEqual(detectPlatform('https://www.tiktok.com/@a/video/1').name, 'TikTok');
  assert.strictEqual(detectPlatform('https://t.me/channel/1').name, 'Telegram');
});

test('every platform has a hex colour', () => {
  assert.match(detectPlatform('https://youtu.be/x').color, /^#[0-9a-f]{6}$/i);
  assert.match(detectPlatform('https://example.org/a').color, /^#[0-9a-f]{6}$/i);
});

test('unknown host falls back to the hostname without www', () => {
  assert.strictEqual(detectPlatform('https://www.example.org/a').name, 'example.org');
});

test('lookalike hosts are not mistaken for a known platform', () => {
  assert.strictEqual(detectPlatform('https://notyoutube.com/x').name, 'notyoutube.com');
  assert.strictEqual(detectPlatform('https://youtube.com.evil.ru/x').name, 'youtube.com.evil.ru');
});

test('invalid input gives null', () => {
  assert.strictEqual(detectPlatform('привет'), null);
  assert.strictEqual(detectPlatform(''), null);
});

test('shortLink strips scheme and www', () => {
  assert.strictEqual(shortLink('https://www.youtube.com/watch?v=jNQXAC9IVRw'), 'youtube.com/watch?v=jNQXAC9IVRw');
});

test('shortLink truncates long links to 38 characters with an ellipsis', () => {
  const s = shortLink('https://youtu.be/' + 'a'.repeat(60));
  assert.strictEqual(s.length, 38);
  assert.ok(s.endsWith('…'));
});
