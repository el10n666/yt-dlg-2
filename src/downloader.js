const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { buildArgs, parseProgress, cleanUrl } = require('./args');
const { mapError } = require('./errors');

const NO_SPACE = 'Не хватает места на диске';
const MIN_FREE = 300 * 1024 * 1024;

const fail = (message) => ({ done: Promise.resolve({ ok: false, message }), cancel() {} });

// yt-dlp.exe (PyInstaller) запускает дочерний процесс, поэтому убиваем всё дерево, а не только родителя.
function defaultKillTree(proc) {
  if (proc.pid) execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {});
  proc.kill();
}

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity; // не удалось измерить: не блокируем скачивание
  }
}

function startDownload({ url, mode, outDir, ytdlp, ffmpegDir, spawn, minFreeBytes = MIN_FREE, killTree = defaultKillTree }, onProgress) {
  const clean = cleanUrl(url);
  if (!clean) return fail('Это не похоже на ссылку. Скопируйте адрес видео целиком');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.accessSync(outDir, fs.constants.W_OK);
  } catch {
    return fail('Не удаётся сохранить в папку «Загрузки». Проверьте, что она доступна');
  }
  if (freeBytes(outDir) < minFreeBytes) return fail(NO_SPACE);

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
  // Хвост stderr нужен для отчёта о проблеме; ограничиваем размер.
  proc.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-2000); });

  const done = new Promise((resolve) => {
    proc.on('error', (e) => resolve({ ok: false, message: mapError(''), code: null, stderr: String(e && e.message) }));
    proc.on('close', (code) => {
      if (cancelled) return resolve({ ok: false, cancelled: true, message: 'Загрузка отменена' });
      if (code === 0) return resolve({ ok: true });
      resolve({ ok: false, message: mapError(stderr), code, stderr });
    });
  });

  return { done, cancel() { cancelled = true; killTree(proc); } };
}

module.exports = { startDownload };
