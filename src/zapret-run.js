const path = require('node:path');

// ---------- Проверка команд для привилегированного помощника ----------
// Помощник работает с правами администратора и запускает winws.exe. Всё, что он принимает, проходит через эту проверку:
// путь к программе зафиксирован в самом помощнике и из сообщения не берётся, а аргументы допускаются только вида --опция[=значение].

const MAX_ARGS = 300;
const OPTION_RE = /^--[A-Za-z0-9-]+(=[^\u0000-\u001f"]*)?$/;
// Решаем по значению, а не по имени опции: у winws одни и те же опции принимают и файл, и литерал (0x00, sni=..., !).
// Всё, что похоже на путь (диск, UNC, \ или /, ..), обязано лежать внутри папки zapret; литералы без разделителей проходят.
const looksLikePath = (v) => /^[A-Za-z]:/.test(v) || /[\\/]/.test(v) || v.includes('..');

const w = path.win32;
const norm = (p) => w.resolve(p).toLowerCase();

function insideRoot(value, root) {
  const r = norm(root);
  const v = norm(value);
  return v === r || v.startsWith(r.endsWith('\\') ? r : r + '\\');
}

function validateHelperCommand(msg, { winws }) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('Команда должна быть объектом');
  if (msg.cmd === 'stop') return { cmd: 'stop' };
  if (msg.cmd === 'quit') return { cmd: 'quit' };
  if (msg.cmd !== 'start') throw new Error('Неизвестная команда');

  const args = msg.args;
  if (!Array.isArray(args) || args.length === 0 || args.length > MAX_ARGS) throw new Error('Неверный список аргументов');
  const root = w.dirname(w.dirname(winws)); // папка zapret: .../zapret/bin/winws.exe -> .../zapret

  for (const a of args) {
    if (typeof a !== 'string' || !OPTION_RE.test(a)) throw new Error(`Недопустимый аргумент: ${typeof a === 'string' ? a : typeof a}`);
    const eq = a.indexOf('=');
    const name = eq < 0 ? a : a.slice(0, eq);
    const value = eq < 0 ? '' : a.slice(eq + 1);
    if (value.startsWith('@')) throw new Error('Значения вида @файл запрещены');
    if (looksLikePath(value) && !(/^[A-Za-z]:\\/.test(value) && insideRoot(value, root))) {
      throw new Error(`Файл вне папки zapret: ${name}`);
    }
  }
  return { cmd: 'start', exe: winws, args: [...args] };
}

// ---------- Запрос прав администратора ----------
// Одна строка PowerShell: Start-Process -Verb RunAs показывает системное окно «Да/Нет». Значения не экранируются хитрыми приёмами:
// путь берётся в одинарные кавычки с удвоением, а аргументы с кавычками, пробелами и переводами строк просто отвергаются.

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function buildElevatedLaunch({ exe, args }) {
  for (const a of args) {
    if (typeof a !== 'string' || /["\u0000- ]/.test(a)) throw new Error(`Недопустимый аргумент помощника: ${JSON.stringify(a)}`);
  }
  if (/[\u0000-\u001f"]/.test(exe)) throw new Error('Недопустимый путь к программе');
  const list = args.map(psQuote).join(',');
  const command = `Start-Process -FilePath ${psQuote(exe)} -ArgumentList ${list} -Verb RunAs -WindowStyle Hidden`;
  return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] };
}

// ---------- Проверка, что обход работает ----------
// Любой HTTP-ответ (даже 403 или 404) значит, что соединение с узлом прошло. Тайм-аут или сброс значит, что нет.

const DEFAULT_TARGETS = [
  { name: 'discord', url: 'https://discord.com' },
  { name: 'discord-gateway', url: 'https://gateway.discord.gg' },
  { name: 'discord-cdn', url: 'https://cdn.discordapp.com' },
  { name: 'youtube', url: 'https://www.youtube.com' },
  { name: 'youtube-images', url: 'https://i.ytimg.com' },
  { name: 'youtube-video', url: 'https://redirector.googlevideo.com' },
];

async function httpProbe(url, { signal } = {}) {
  const res = await fetch(url, { method: 'GET', redirect: 'manual', signal });
  try { await res.body?.cancel(); } catch { /* тело не нужно */ }
  return { status: res.status };
}

async function checkTargets({ targets = DEFAULT_TARGETS, fetchFn = httpProbe, timeoutMs = 6000 } = {}) {
  const one = async (t) => {
    const ctrl = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, timeoutMs); });
    try {
      const res = await Promise.race([fetchFn(t.url, { signal: ctrl.signal }), timeout]);
      return Boolean(res && typeof res.status === 'number');
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
  const results = await Promise.all(targets.map(one)); // параллельно: один зависший узел не умножает ожидание
  const failed = targets.filter((_, i) => !results[i]).map((t) => t.name);
  return { passed: results.filter(Boolean).length, total: targets.length, failed };
}

// ---------- Проверка настоящего скачивания видео ----------
// Раньше проверка считала успехом любой HTTP-ответ, и «Включено» появлялось сразу, хотя видеопоток googlevideo.com мог не идти.
// Теперь берём настоящий кусок видео (первые байты по Range) и требуем, чтобы он пришёл целиком и достаточно быстро.

async function measureThroughput({ url, bytes = 2 * 1024 * 1024, timeoutMs = 8000, fetchFn = fetch }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let got = 0;
  let reader;
  const stalled = new Promise((resolve) => ctrl.signal.addEventListener('abort', () => resolve('timeout')));
  try {
    const res = await Promise.race([
      fetchFn(url, { headers: { Range: `bytes=0-${bytes - 1}` }, signal: ctrl.signal }),
      stalled.then(() => { throw new Error('timeout'); }),
    ]);
    if (!res || (res.status !== 200 && res.status !== 206)) return { ok: false, bytes: 0, reason: `http ${res && res.status}` };
    // Файл может быть меньше пробы: тогда сервер сообщает полный размер в Content-Range ("bytes 0-433080/433081"),
    // и цель это весь файл, а не запрошенные мегабайты.
    let want = bytes;
    const cr = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-range') : null;
    const total = cr && /\/(\d+)$/.exec(cr);
    if (total) want = Math.min(bytes, Number(total[1]));
    reader = res.body.getReader();
    while (got < want) {
      const next = await Promise.race([reader.read(), stalled.then(() => ({ timeout: true }))]);
      if (next.timeout) return { ok: false, bytes: got, reason: 'timeout' };
      if (next.done) break;
      got += next.value.length;
    }
    return got >= want ? { ok: true, bytes: got } : { ok: false, bytes: got, reason: 'short' };
  } catch (e) {
    return { ok: false, bytes: got, reason: e.message === 'timeout' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
    if (reader) { try { await reader.cancel(); } catch { /* поток уже закрыт */ } }
  }
}

// Прямая ссылка на видеопоток из вывода yt-dlp -g: только https и только googlevideo.com, остальное отбрасывается.
function parseDirectUrl(output) {
  for (const raw of String(output || '').split(/\r?\n/)) {
    const line = raw.trim();
    try {
      const u = new URL(line);
      if (u.protocol === 'https:' && (u.hostname === 'googlevideo.com' || u.hostname.endsWith('.googlevideo.com'))) return line;
    } catch { /* не ссылка */ }
  }
  return null;
}

// Проверка узлов и, если есть ссылка, реальное скачивание видео. Провал скачивания считается отдельной проверкой.
async function checkAll({ targets = DEFAULT_TARGETS, fetchFn = httpProbe, timeoutMs = 6000, videoUrl = null, measure = measureThroughput } = {}) {
  const hosts = await checkTargets({ targets, fetchFn, timeoutMs });
  if (!videoUrl) return hosts;
  const video = await measure({ url: videoUrl });
  return {
    passed: hosts.passed + (video.ok ? 1 : 0),
    total: hosts.total + 1,
    failed: video.ok ? hosts.failed : [...hosts.failed, 'video-download'],
  };
}

// VPN и туннели: по имени сетевого адаптера. Обход блокировок против VPN не работает (трафик уже зашифрован и идёт мимо провайдера).
const VPN_NAME = /^(tun\d*|tap\d*|wg\d*|utun\d*)$|wireguard|openvpn|\bvpn\b|warp|nord|proton|happ|v2ray|xray|clash|sing-?box|hiddify|outline|amnezia|tailscale|zerotier|hamachi|mullvad|surfshark|expressvpn/i;

function detectVpn(interfaces) {
  for (const [name, addrs] of Object.entries(interfaces || {})) {
    if (VPN_NAME.test(name) && Array.isArray(addrs) && addrs.some((a) => !a.internal)) return name;
  }
  return null;
}

module.exports = { validateHelperCommand, buildElevatedLaunch, checkTargets, httpProbe, DEFAULT_TARGETS, MAX_ARGS, measureThroughput, parseDirectUrl, checkAll, detectVpn };
