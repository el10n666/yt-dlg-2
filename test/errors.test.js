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
test('unknown text falls back to default', () => {
  assert.strictEqual(mapError('qwerty'), DEFAULT);
  assert.strictEqual(mapError(''), DEFAULT);
});
