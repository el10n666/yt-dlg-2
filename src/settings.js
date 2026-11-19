const fs = require('node:fs');
const path = require('node:path');

const FILE = 'settings.json';

// Тип каждого поля: всё остальное из файла отбрасывается, чтобы испорченный или чужой файл не мог повлиять на запуск yt-dlp.
const SCHEMA = {
  cookiesBrowser: 'string',
  proxy: 'string',
  playlist: 'boolean',
  outDir: 'string',
  zapret: 'boolean',
};

const DEFAULTS = { cookiesBrowser: '', proxy: '', playlist: false, outDir: '', zapret: false };

function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const [key, type] of Object.entries(SCHEMA)) {
      if (typeof raw[key] === type) out[key] = raw[key];
    }
  }
  return out;
}

function loadSettings(userDataDir) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(path.join(userDataDir, FILE), 'utf8')));
  } catch {
    return { ...DEFAULTS }; // нет файла или он повреждён: работаем с настройками по умолчанию
  }
}

function saveSettings(userDataDir, settings) {
  const clean = sanitize(settings);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, FILE), JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

module.exports = { loadSettings, saveSettings, sanitize, DEFAULTS };
