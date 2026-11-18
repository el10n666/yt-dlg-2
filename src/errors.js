const DEFAULT = 'Не удалось скачать. Нажмите «Сообщить о проблеме»';

// Порядок важен: DRM проверяется раньше общих «недоступно».
const RULES = [
  [/drm/i, 'Это видео защищено, скачать его нельзя'],
  [/video unavailable|private video/i, 'Видео недоступно или закрыто автором'],
  [/unsupported url/i, 'Этот сайт не поддерживается'],
  [/no space left/i, 'Не хватает места на диске'],
  [/unable to download webpage/i, 'Нет связи с сайтом, проверьте интернет'],
];

function mapError(stderr) {
  const text = String(stderr || '');
  for (const [re, msg] of RULES) if (re.test(text)) return msg;
  return DEFAULT;
}

module.exports = { mapError };
