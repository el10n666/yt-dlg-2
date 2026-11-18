const fs = require('node:fs');
const { buildArgs, parseProgress, cleanUrl } = require('./args');
const { mapError } = require('./errors');

const fail = (message) => ({ done: Promise.resolve({ ok: false, message }), cancel() {} });

function startDownload({ url, mode, outDir, ytdlp, ffmpegDir, spawn }, onProgress) {
  const clean = cleanUrl(url);
  if (!clean) return fail('Это не похоже на ссылку. Скопируйте адрес видео целиком');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.accessSync(outDir, fs.constants.W_OK);
  } catch {
    return fail('Не удаётся сохранить в папку «Загрузки». Проверьте, что она доступна');
  }

  const args = buildArgs({ url: clean, mode, outDir, ffmpegDir });
  const proc = spawn(ytdlp, args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
  let stderr = '';
  let cancelled = false;
  let buf = '';

  proc.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const p = parseProgress(line);
      if (p) onProgress(p);
    }
  });
  proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

  const done = new Promise((resolve) => {
    proc.on('error', () => resolve({ ok: false, message: mapError('') }));
    proc.on('close', (code) => {
      if (cancelled) return resolve({ ok: false, message: 'Загрузка отменена' });
      if (code === 0) return resolve({ ok: true });
      resolve({ ok: false, message: mapError(stderr) });
    });
  });

  return { done, cancel() { cancelled = true; proc.kill(); } };
}

module.exports = { startDownload };
