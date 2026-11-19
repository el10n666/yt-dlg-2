const $ = (id) => document.getElementById(id);
const items = new Map();
const CIRC = 144.5; // длина окружности кольца прогресса (r=23)
const NS = 'http://www.w3.org/2000/svg';

function ringSvg() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 52 52');
  const mk = (cls) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '26'); c.setAttribute('cy', '26'); c.setAttribute('r', '23');
    c.setAttribute('class', cls);
    return c;
  };
  const bar = mk('bar');
  svg.append(mk('track'), bar);
  return { svg, bar };
}

function addItem(id, url, mode) {
  const plat = detectPlatform(url) || { name: 'Видео', color: '#6a6e7c' };
  const li = document.createElement('li');
  li.className = 'item';

  const ring = document.createElement('div');
  ring.className = 'ring';
  const { svg, bar } = ringSvg();
  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.style.setProperty('background', plat.color);
  badge.textContent = plat.name.charAt(0).toUpperCase();
  ring.append(svg, badge);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = `${plat.name} · ${mode === 'audio' ? 'звук' : 'видео'}`;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = shortLink(url);
  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = 'Начинаем…';
  meta.append(name, sub, status);

  const cancel = document.createElement('button');
  cancel.className = 'cancel';
  cancel.textContent = 'Отмена';
  cancel.addEventListener('click', () => window.api.cancel(id));

  li.append(ring, meta, cancel);
  $('list').prepend(li);
  $('empty').hidden = true;
  items.set(id, { li, bar, status, cancel, badge });
}

function showHint(text) {
  $('hint').textContent = text;
  $('url').parentElement.classList.toggle('bad', Boolean(text));
}

let lastId = 0;

async function go() {
  const url = $('url').value.trim();
  if (!/^https?:\/\/\S+$/i.test(url) || !detectPlatform(url)) {
    showHint('Это не похоже на ссылку. Скопируйте адрес видео целиком.');
    return;
  }
  showHint('');
  const mode = document.querySelector('input[name=mode]:checked').value;
  const id = ++lastId;
  // Элемент списка создаём до запроса: ответ о быстрой ошибке не потеряется.
  addItem(id, url, mode);
  $('url').value = '';
  $('go').disabled = true; // защита от двойного нажатия
  try {
    await window.api.start(id, url, mode);
  } catch {
    const it = items.get(id);
    it.cancel.remove();
    it.li.classList.add('fail');
    it.badge.textContent = '!';
    it.status.textContent = 'Не удалось начать загрузку. Попробуйте ещё раз';
  } finally {
    $('go').disabled = false;
  }
}

// Блок «Дополнительно»: настройки хранятся в главном процессе, здесь только показ и сохранение.
function advHint(text) { $('adv-hint').textContent = text; }

const folderLabel = (p) => (p ? p.replace(/^.*[\\/]/, '') || p : 'Папка «Загрузки»');

async function loadAdvanced() {
  const s = await window.api.getSettings();
  $('opt-playlist').checked = s.playlist;
  $('opt-zapret').checked = s.zapret;
  $('opt-browser').value = s.cookiesBrowser;
  $('opt-proxy').value = s.proxy;
  $('opt-folder').textContent = folderLabel(s.outDir);
  $('opt-folder').title = s.outDir || '';
}

async function save(patch) {
  try { await window.api.setSettings(patch); advHint(''); }
  catch { advHint('Не удалось сохранить настройку. Попробуйте ещё раз.'); }
}

$('opt-playlist').addEventListener('change', (e) => save({ playlist: e.target.checked }));
$('opt-browser').addEventListener('change', (e) => save({ cookiesBrowser: e.target.value }));
$('opt-proxy').addEventListener('change', (e) => save({ proxy: e.target.value.trim() }));
$('opt-folder').addEventListener('click', async () => {
  try {
    const s = await window.api.pickFolder();
    if (s) { $('opt-folder').textContent = folderLabel(s.outDir); $('opt-folder').title = s.outDir; }
  } catch { advHint('Не удалось выбрать папку. Попробуйте ещё раз.'); }
});
loadAdvanced().catch(() => advHint('Не удалось прочитать настройки.'));

$('go').addEventListener('click', go);
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
$('url').addEventListener('input', () => showHint(''));
$('paste').addEventListener('click', async () => {
  const u = await window.api.clipboardUrl();
  if (u) { $('url').value = u; showHint(''); }
  else showHint('В буфере нет ссылки. Скопируйте адрес видео и нажмите «Вставить».');
});
$('close').addEventListener('click', () => window.api.closeWindow());
$('min').addEventListener('click', () => window.api.minimizeWindow());
$('full').addEventListener('click', () => window.api.toggleFullscreen());
// Esc выводит из полного экрана; состояние окна приходит из главного процесса.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('full')) window.api.toggleFullscreen();
});
window.api.onWindowState(({ full }) => {
  document.body.classList.toggle('full', full);
  $('full').setAttribute('aria-label', full ? 'Свернуть из полного экрана' : 'Во весь экран');
});
$('folder').addEventListener('click', () => window.api.openFolder());
$('report').addEventListener('click', async () => {
  try {
    await window.api.saveReport();
    showHint('Файл «отчёт-о-проблеме.txt» лежит на рабочем столе. Отправьте его мне.');
  } catch {
    showHint('Не удалось сохранить отчёт на рабочий стол. Попробуйте ещё раз.');
  }
});

window.api.onProgress(({ id, percent, speed, eta, stage }) => {
  const it = items.get(id);
  if (!it) return;
  if (stage === 'processing') {
    // Склейка или конвертация в MP3: процентов нет, но видно, что программа работает.
    it.bar.style.setProperty('stroke-dashoffset', '0');
    it.status.textContent = 'Обработка файла…';
    return;
  }
  if (percent == null) { it.status.textContent = 'Скачиваем…'; return; }
  it.bar.style.setProperty('stroke-dashoffset', String(CIRC * (1 - percent / 100)));
  const parts = [`${Math.round(percent)}%`];
  if (speed) parts.push(speed);
  if (eta) parts.push(`осталось ${eta}`);
  it.status.textContent = parts.join(' · ');
});

window.api.onDone(({ id, ok, cancelled, message }) => {
  const it = items.get(id);
  if (!it) return;
  it.cancel.remove();
  if (cancelled) { // отмена не ошибка: без красного
    it.li.classList.add('cancelled');
    it.badge.textContent = '–';
    it.status.textContent = message;
    return;
  }
  it.li.classList.add(ok ? 'ok' : 'fail');
  if (ok) {
    it.bar.style.setProperty('stroke-dashoffset', '0');
    it.badge.textContent = '✓';
    it.badge.style.setProperty('background', '#12a150');
    it.status.textContent = 'Готово. Файл в папке «Загрузки»';
  } else {
    it.badge.textContent = '!';
    it.badge.style.setProperty('background', '#ff2d55');
    it.status.textContent = message;
  }
});
