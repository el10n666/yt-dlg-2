const DEFAULT = 'Не удалось скачать. Нажмите «Сообщить о проблеме»';

// Порядок важен: более конкретные причины раньше общих («недоступно», «войти»).
const RULES = [
  [/\bdrm\b/i, 'Это видео защищено, скачать его нельзя'],
  [/not available in your country|geo.?restrict|blocked it in your country/i, 'Видео недоступно в вашей стране'],
  [/confirm your age|age.?restrict|inappropriate for some users/i, 'Видео с возрастным ограничением, скачать его нельзя'],
  [/sign in to confirm|not a bot|login required|requires? (a )?login/i, 'Сайт просит войти в аккаунт, это видео скачать не получится'],
  [/http error (429|403)|too many requests|forbidden/i, 'Сайт временно ограничил доступ. Попробуйте позже'],
  [/requested format is not available/i, 'Для этого видео нет подходящего формата'],
  [/video unavailable|private video/i, 'Видео недоступно или закрыто автором'],
  [/unsupported url/i, 'Этот сайт не поддерживается'],
  [/no space left/i, 'Не хватает места на диске'],
  [/unable to download webpage|getaddrinfo|network is unreachable|timed out/i, 'Нет связи с сайтом, проверьте интернет'],
];

function mapError(stderr) {
  const text = String(stderr || '');
  for (const [re, msg] of RULES) if (re.test(text)) return msg;
  return DEFAULT;
}

module.exports = { mapError };
