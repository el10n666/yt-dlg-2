const path = require('node:path');

// Только http/https: file://, ftp:// и произвольный текст отбрасываются.
function cleanUrl(raw) {
  const s = String(raw || '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}

// Разделитель | вместо пробелов: yt-dlp печатает "Unknown B/s" с пробелом, и разбор по пробелам ломался.
const TEMPLATES = [
  'download:PROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
  'postprocess:PP|%(progress.status)s',
];

// H.264 + m4a играет даже на старом Windows; последний вариант в цепочке гарантирует, что хоть что-то скачается.
const VIDEO_FORMAT = 'bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b';

// Только известные браузеры: значение уходит в командную строку yt-dlp, произвольный текст туда попасть не должен.
const BROWSERS = ['chrome', 'edge', 'firefox', 'opera', 'brave', 'vivaldi', 'chromium'];

// Прокси: [схема://][логин:пароль@]хост:порт. Схема по умолчанию http. Всё остальное отбрасывается.
const PROXY_RE = /^(?:(https?|socks4a?|socks5h?):\/\/)?(?:[^\s@\/:]+(?::[^\s@\/]*)?@)?[A-Za-z0-9.\-]+:(\d{1,5})$/;
function cleanProxy(raw) {
  const s = String(raw || '').trim();
  const m = PROXY_RE.exec(s);
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return null;
  return m[1] ? s : `http://${s}`;
}

function buildArgs({ url, mode, outDir, ffmpegDir, options = {} }) {
  const args = [];
  if (!options.playlist) {
    args.push('--no-playlist', '--playlist-items', '1'); // ссылка на плейлист или канал даёт одно видео, а не сотни файлов
  }
  args.push('--windows-filenames', '--newline', '--encoding', 'utf-8', '--ffmpeg-location', ffmpegDir);
  if (BROWSERS.includes(options.cookiesBrowser)) args.push('--cookies-from-browser', options.cookiesBrowser);
  const proxy = cleanProxy(options.proxy);
  if (proxy) args.push('--proxy', proxy);
  for (const t of TEMPLATES) args.push('--progress-template', t);
  args.push('-o', path.join(outDir, '%(title).150B [%(id)s].%(ext)s'));
  if (mode === 'audio') args.push('-x', '--audio-format', 'mp3');
  else args.push('-f', VIDEO_FORMAT, '--merge-output-format', 'mp4');
  args.push(url);
  return args;
}

const unknown = (s) => (/unknown|n\/a/i.test(s) ? '' : s);

function parseProgress(line) {
  const text = String(line).trim();
  if (text.startsWith('PP|')) return { stage: 'processing' };
  if (!text.startsWith('PROG|')) return null;
  const [, pct, speed, eta] = text.split('|');
  const m = /([\d.]+)%/.exec(pct || '');
  return { percent: m ? parseFloat(m[1]) : null, speed: unknown((speed || '').trim()), eta: unknown((eta || '').trim()) };
}

module.exports = { buildArgs, parseProgress, cleanUrl };
