const fs = require('node:fs');
const path = require('node:path');

const EXE = 'yt-dlp.exe';

function resolveYtDlp({ bundledDir, userDir }) {
  const user = path.join(userDir, EXE);
  return fs.existsSync(user) ? user : path.join(bundledDir, EXE);
}

// Копия через временный файл: обрыв посреди копирования не оставляет обрезанный exe на месте рабочего.
function safeCopy(from, to) {
  const tmp = `${to}.tmp`;
  fs.copyFileSync(from, tmp);
  fs.renameSync(tmp, to);
}

const version = async (run, exe) => String(await run(exe, ['--version'])).trim();

// Обновляет пользовательскую копию yt-dlp, при любом сбое откатывает на рабочую.
// Исключения наружу не выходят: нет сети или поломка обновления не должны ронять приложение.
async function updateYtDlp({ bundledDir, userDir, run }) {
  const bundled = path.join(bundledDir, EXE);
  const user = path.join(userDir, EXE);
  const bak = path.join(userDir, 'yt-dlp.bak');
  try {
    fs.mkdirSync(userDir, { recursive: true });
    if (!fs.existsSync(user)) safeCopy(bundled, user);
    let before;
    try {
      before = await version(run, user);
    } catch {
      // Обрезанный или битый exe (обрыв питания, антивирус): чиним из .bak, иначе из вшитой копии.
      safeCopy(fs.existsSync(bak) ? bak : bundled, user);
      before = await version(run, user);
    }
    safeCopy(user, bak);
    try {
      await run(user, ['--update-to', 'stable']);
      const after = await version(run, user);
      if (!after) throw new Error('empty version');
      return after === before ? 'current' : 'updated';
    } catch {
      try { safeCopy(bak, user); } catch { /* файл занят: останется как есть, повторим при следующем запуске */ }
      return 'skipped';
    }
  } catch {
    return 'skipped';
  }
}

module.exports = { resolveYtDlp, updateYtDlp };
