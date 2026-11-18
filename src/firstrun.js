const fs = require('node:fs');
const path = require('node:path');

// Имя ярлыка задаёт установщик (nsis.shortcutName); окно ищет файлы именно с этим именем.
const SHORTCUT_NAME = 'Скачать видео';
const MARKER = 'welcomed';

function welcomeText({ desktop, startMenu }) {
  const places = [];
  if (desktop) places.push('на рабочем столе');
  if (startMenu) places.push('в меню «Пуск»');
  if (!places.length) {
    return 'Программа установлена. Чтобы открыть её снова, нажмите кнопку «Пуск» и введите в поиск: Скачать видео.';
  }
  return `Программа установлена. Ярлык «${SHORTCUT_NAME}» лежит ${places.join(' и ')}. Нажмите на него, когда захотите скачать видео.`;
}

// Показываем окно один раз: после первого показа в папке данных остаётся маркер.
function shouldWelcome(userDataDir) {
  return !fs.existsSync(path.join(userDataDir, MARKER));
}

function markWelcomed(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, MARKER), new Date().toISOString(), 'utf8');
}

// Проверяем, что ярлыки действительно есть, чтобы не обещать лишнего (например, если их удалили при установке).
function findShortcuts({ desktopDir, startMenuDir }) {
  const file = `${SHORTCUT_NAME}.lnk`;
  return {
    desktop: fs.existsSync(path.join(desktopDir, file)),
    startMenu: fs.existsSync(path.join(startMenuDir, file)),
  };
}

module.exports = { SHORTCUT_NAME, welcomeText, shouldWelcome, markWelcomed, findShortcuts };
