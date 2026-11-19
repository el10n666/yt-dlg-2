const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ---------- Разбор стратегий из официальных general*.bat ----------
// Аргументы winws.exe берём из самих скриптов Flowseal: новые стратегии приходят с обновлением архива, без правки нашего кода.
// Результат уходит в процесс с правами администратора, поэтому разбор строгий: любая неожиданность это ошибка, а не «как-нибудь».

const withSep = (d) => (d.endsWith('\\') ? d : d + '\\');

function tokenize(s) {
  const out = [];
  let cur = '';
  let inQuote = false;
  let has = false;
  for (const ch of s) {
    if (ch === '"') { inQuote = !inQuote; has = true; continue; }
    if (!inQuote && /\s/.test(ch)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch;
    has = true;
  }
  if (inQuote) throw new Error('Незакрытая кавычка в скрипте стратегии');
  if (has) out.push(cur);
  return out;
}

function parseStrategy(text, { binDir, listsDir }) {
  // Строки, оканчивающиеся на ^, это одна команда.
  const joined = [];
  let acc = '';
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trimEnd();
    if (t.endsWith('^')) { acc += t.slice(0, -1) + ' '; continue; }
    joined.push(acc + t);
    acc = '';
  }
  if (acc) joined.push(acc);

  const cmd = joined.find((l) => /winws\.exe/i.test(l));
  const m = cmd && /winws\.exe"?\s+(.*)$/i.exec(cmd);
  if (!m) throw new Error('В скрипте не найден запуск winws.exe');

  // Фильтр игр выключен (так в service.bat по умолчанию): порты-заглушки 12.
  const VARS = { BIN: withSep(binDir), LISTS: withSep(listsDir), GameFilterTCP: '12', GameFilterUDP: '12' };
  const body = m[1].replace(/%([A-Za-z0-9_~]+)%/g, (all, name) => {
    if (!(name in VARS)) throw new Error(`Неизвестная переменная в скрипте: ${all}`);
    return VARS[name];
  });

  const args = tokenize(body);
  for (const a of args) {
    if (!/^--[A-Za-z0-9-]+(=[^\u0000-\u001f]*)?$/.test(a)) throw new Error(`Недопустимый параметр в скрипте (ожидалось --...): ${a}`);
  }
  return { args };
}

// ---------- Список и порядок стратегий ----------

function listStrategies(dir) {
  const names = fs.readdirSync(dir)
    .filter((f) => /^general( \(.+\))?\.bat$/i.test(f))
    .map((f) => f.replace(/\.bat$/i, ''));
  return names.sort((a, b) => {
    if (a === 'general') return -1;
    if (b === 'general') return 1;
    return a.localeCompare(b, 'en', { numeric: true });
  });
}

// Начальная догадка: базовая и ALT11 (на нём построены обходы из обсуждений 18 ноября). Это эвристика, а не гарантия: реальный выбор делает проверка.
const GUESSES = ['general', 'general (ALT11)'];

function orderStrategies(names, preferred) {
  const first = [preferred, ...GUESSES].filter((n, i, arr) => n && names.includes(n) && arr.indexOf(n) === i);
  return [...first, ...names.filter((n) => !first.includes(n))];
}

function ensureUserLists(listsDir) {
  fs.mkdirSync(listsDir, { recursive: true });
  const files = {
    'ipset-exclude-user.txt': '203.0.113.113/32\r\n',
    'list-general-user.txt': '# Never leave this file empty\r\ndomain.example.abc\r\n',
    'list-exclude-user.txt': 'domain.example.abc\r\n',
  };
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(listsDir, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content, 'utf8');
  }
}

// ---------- Версии ----------

// '1.10.4' > '1.9.9d' > '1.9.9': числа сравниваются как числа, буквенный суффикс означает более новую правку.
function compareVersions(a, b) {
  const A = String(a).trim().match(/\d+|[A-Za-z]+/g) || [];
  const B = String(b).trim().match(/\d+|[A-Za-z]+/g) || [];
  const isNum = (t) => /^\d+$/.test(t);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? '';
    const y = B[i] ?? '';
    if (x === y) continue;
    if ((isNum(x) || x === '') && (isNum(y) || y === '')) {
      const d = Number(x || 0) - Number(y || 0);
      if (d !== 0) return Math.sign(d);
      continue;
    }
    if (x === '') return -1;
    if (y === '') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// ---------- Целостность: manifest.json с хэшами ----------
// Защищает от порчи файлов (антивирус, обрыв копирования) и от лишних файлов рядом с winws.exe (подмена DLL). Не защита от
// локального злоумышленника с правом записи в папку пользователя: он может переписать и манифест.

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function protectedFiles(root) {
  const out = [];
  const bin = path.join(root, 'bin');
  if (fs.existsSync(bin)) for (const f of fs.readdirSync(bin)) if (fs.statSync(path.join(bin, f)).isFile()) out.push(`bin/${f}`);
  for (const f of fs.readdirSync(root)) if (/^general.*\.bat$/i.test(f)) out.push(f);
  return out.sort();
}

function writeManifest(root) {
  const files = {};
  for (const rel of protectedFiles(root)) files[rel] = sha256(path.join(root, rel));
  const version = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version, files }, null, 2), 'utf8');
}

function verifyManifest(root) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); } catch { return { ok: false, bad: ['manifest.json'] }; }
  const bad = [];
  const expected = (manifest && manifest.files) || {};
  for (const [rel, hash] of Object.entries(expected)) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p) || sha256(p) !== hash) bad.push(rel);
  }
  for (const rel of protectedFiles(root)) if (!(rel in expected)) bad.push(rel);
  return { ok: bad.length === 0, bad };
}

// ---------- Папка обновлений: установка, ремонт, обновление, откат ----------

const readVersion = (root) => { try { return fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim(); } catch { return null; } };

function copyInstall(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
}

function restoreUserLists(fromRoot, toRoot) {
  const src = path.join(fromRoot, 'lists');
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.join(toRoot, 'lists'), { recursive: true });
  for (const f of fs.readdirSync(src)) if (/-user\.txt$/i.test(f)) fs.copyFileSync(path.join(src, f), path.join(toRoot, 'lists', f));
}

function prepareZapret({ bundledDir, userDir }) {
  const bundledVersion = readVersion(bundledDir);
  if (!bundledVersion) throw new Error('Вшитая копия zapret не найдена');
  const userVersion = readVersion(userDir);

  if (!userVersion) {
    copyInstall(bundledDir, userDir);
    if (!verifyManifest(userDir).ok) throw new Error('Не удалось установить zapret: файлы повреждены');
    return { action: 'installed', version: bundledVersion };
  }

  if (!verifyManifest(userDir).ok) {
    // Повреждённую копию чиним целиком; лишние файлы в bin удаляем, чтобы рядом с winws.exe не осталось чужих DLL.
    fs.rmSync(path.join(userDir, 'bin'), { recursive: true, force: true });
    for (const f of fs.readdirSync(userDir)) if (/^general.*\.bat$/i.test(f)) fs.rmSync(path.join(userDir, f));
    copyInstall(bundledDir, userDir);
    if (!verifyManifest(userDir).ok) throw new Error('Не удалось починить zapret: файлы повреждены');
    return { action: 'repaired', version: bundledVersion };
  }

  if (compareVersions(bundledVersion, userVersion) > 0) {
    const next = `${userDir}.new`;
    const prev = `${userDir}.prev`;
    fs.rmSync(next, { recursive: true, force: true });
    copyInstall(bundledDir, next);
    if (!verifyManifest(next).ok) { fs.rmSync(next, { recursive: true, force: true }); throw new Error('Новая версия zapret повреждена'); }
    fs.rmSync(prev, { recursive: true, force: true });
    fs.renameSync(userDir, prev);
    try { fs.renameSync(next, userDir); } catch (e) { fs.renameSync(prev, userDir); throw e; }
    restoreUserLists(prev, userDir);
    return { action: 'upgraded', version: bundledVersion };
  }

  return { action: 'current', version: userVersion };
}

function rollbackZapret(userDir) {
  const prev = `${userDir}.prev`;
  if (!fs.existsSync(prev)) return false;
  fs.rmSync(userDir, { recursive: true, force: true });
  fs.renameSync(prev, userDir);
  return true;
}

// ---------- Автоподбор стратегии ----------
// start/stop/check/wait подставляются снаружи: в тестах это заглушки, в приложении настоящий запуск и проверка сети.

async function pickStrategy({ names, preferred, start, stop, check, wait, onProgress, isCancelled, onAttempt = () => {} }) {
  const order = orderStrategies(names, preferred);
  let best = null;
  for (let i = 0; i < order.length; i++) {
    if (isCancelled()) { await stop(); return { cancelled: true }; }
    const name = order[i];
    onProgress({ index: i + 1, total: order.length, name });
    try {
      await start(name);
      await wait();
      const r = await check();
      onAttempt({ name, passed: r.passed, total: r.total, failed: r.failed || [] }); // в журнал: что пробовали и что не прошло
      if (r.total > 0 && r.passed === r.total) return { name, partial: false }; // рабочая стратегия остаётся включённой
      if (r.passed > 0 && (!best || r.passed > best.passed)) best = { name, passed: r.passed };
    } catch {
      // стратегия не запустилась: пробуем следующую
    }
    await stop();
  }
  if (best) {
    try { await start(best.name); return { name: best.name, partial: true }; } catch { await stop(); }
  }
  await stop();
  return null;
}

module.exports = {
  parseStrategy, listStrategies, orderStrategies, ensureUserLists, compareVersions,
  writeManifest, verifyManifest, prepareZapret, rollbackZapret, pickStrategy, GUESSES,
};
