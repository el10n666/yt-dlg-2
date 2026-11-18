const fs = require('node:fs');
const path = require('node:path');

const EXE = 'yt-dlp.exe';

function resolveYtDlp({ bundledDir, userDir }) {
  const user = path.join(userDir, EXE);
  return fs.existsSync(user) ? user : path.join(bundledDir, EXE);
}

// Обновляет пользовательскую копию yt-dlp, при любом сбое откатывает на рабочую.
// Исключения наружу не выходят: нет сети или поломка обновления не должны ронять приложение.
async function updateYtDlp({ bundledDir, userDir, run }) {
  const user = path.join(userDir, EXE);
  const bak = path.join(userDir, 'yt-dlp.bak');
  try {
    fs.mkdirSync(userDir, { recursive: true });
    if (!fs.existsSync(user)) fs.copyFileSync(path.join(bundledDir, EXE), user);
    const before = String(await run(user, ['--version'])).trim();
    fs.copyFileSync(user, bak);
    try {
      await run(user, ['--update-to', 'stable']);
      const after = String(await run(user, ['--version'])).trim();
      if (!after) throw new Error('empty version');
      return after === before ? 'current' : 'updated';
    } catch (e) {
      fs.copyFileSync(bak, user);
      return 'skipped';
    }
  } catch (e) {
    return 'skipped';
  }
}

module.exports = { resolveYtDlp, updateYtDlp };
