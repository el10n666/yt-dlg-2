const test = require('node:test');
const assert = require('node:assert');
const { mapError } = require('../src/errors');

const DEFAULT = 'Не удалось скачать. Нажмите «Сообщить о проблеме»';

test('unavailable video', () => {
  assert.strictEqual(mapError('ERROR: Video unavailable'), 'Видео недоступно или закрыто автором');
});
test('private video', () => {
  assert.strictEqual(mapError('ERROR: Private video'), 'Видео недоступно или закрыто автором');
});
test('DRM protected', () => {
  assert.strictEqual(mapError('ERROR: DRM protected'), 'Это видео защищено, скачать его нельзя');
  assert.strictEqual(mapError('This video is DRM'), 'Это видео защищено, скачать его нельзя');
});
test('unsupported URL', () => {
  assert.strictEqual(mapError('ERROR: Unsupported URL: x'), 'Этот сайт не поддерживается');
});
test('no disk space', () => {
  assert.strictEqual(mapError('OSError: No space left on device'), 'Не хватает места на диске');
});
test('no connection', () => {
  assert.strictEqual(mapError('ERROR: Unable to download webpage'), 'Нет связи с сайтом, проверьте интернет');
});
test('geo-blocked video', () => {
  assert.strictEqual(mapError('ERROR: Video unavailable. This video is not available in your country'), 'Видео недоступно в вашей стране');
});
test('age-restricted video', () => {
  assert.strictEqual(mapError('ERROR: Sign in to confirm your age'), 'Видео с возрастным ограничением, скачать его нельзя');
});
test('site asks to sign in', () => {
  assert.strictEqual(mapError("ERROR: Sign in to confirm you're not a bot"), 'Сайт просит войти в аккаунт, это видео скачать не получится');
});
test('rate limited or forbidden', () => {
  assert.strictEqual(mapError('ERROR: HTTP Error 429: Too Many Requests'), 'Сайт временно ограничил доступ. Попробуйте позже');
  assert.strictEqual(mapError('ERROR: unable to download video data: HTTP Error 403: Forbidden'), 'Сайт временно ограничил доступ. Попробуйте позже');
});
test('no suitable format', () => {
  assert.strictEqual(mapError('ERROR: Requested format is not available'), 'Для этого видео нет подходящего формата');
});
test('drm must be a whole word', () => {
  assert.strictEqual(mapError('ERROR: Video unavailable (drmfree.example)'), 'Видео недоступно или закрыто автором');
});
test('unknown text falls back to default', () => {
  assert.strictEqual(mapError('qwerty'), DEFAULT);
  assert.strictEqual(mapError(''), DEFAULT);
});
