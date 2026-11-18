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

async function go() {
  const url = $('url').value.trim();
  if (!detectPlatform(url)) {
    showHint('Это не похоже на ссылку. Скопируйте адрес видео целиком.');
    return;
  }
  showHint('');
  const mode = document.querySelector('input[name=mode]:checked').value;
  const id = await window.api.start(url, mode);
  addItem(id, url, mode);
  $('url').value = '';
}

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
$('folder').addEventListener('click', () => window.api.openFolder());
$('report').addEventListener('click', async () => {
  await window.api.saveReport();
  showHint('Файл «отчёт-о-проблеме.txt» лежит на рабочем столе. Отправьте его мне.');
});

window.api.onProgress(({ id, percent, speed, eta }) => {
  const it = items.get(id);
  if (!it) return;
  it.bar.style.setProperty('stroke-dashoffset', String(CIRC * (1 - percent / 100)));
  it.status.textContent = `${Math.round(percent)}% · ${speed} · осталось ${eta}`;
});

window.api.onDone(({ id, ok, message }) => {
  const it = items.get(id);
  if (!it) return;
  it.cancel.remove();
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
