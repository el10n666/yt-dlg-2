const path = require('node:path');

// Только http/https: file:// и произвольный текст отбрасываются.
function cleanUrl(raw) {
  const s = String(raw || '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}

const PROGRESS_TEMPLATE = 'download:PROG %(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s';

function buildArgs({ url, mode, outDir, ffmpegDir }) {
  const args = [
    '--no-playlist',
    '--windows-filenames',
    '--newline',
    '--encoding', 'utf-8',
    '--ffmpeg-location', ffmpegDir,
    '--progress-template', PROGRESS_TEMPLATE,
    '-o', path.join(outDir, '%(title).150B [%(id)s].%(ext)s'),
  ];
  if (mode === 'audio') args.push('-x', '--audio-format', 'mp3');
  else args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
  args.push(url);
  return args;
}

function parseProgress(line) {
  const m = /^PROG\s+([\d.]+)%\s+(\S+)\s+(\S+)\s*$/.exec(String(line).trim());
  return m ? { percent: parseFloat(m[1]), speed: m[2], eta: m[3] } : null;
}

module.exports = { buildArgs, parseProgress, cleanUrl };
