const $ = (id) => document.getElementById(id);
const items = new Map();

function addItem(id, url) {
  const li = document.createElement('li');
  const title = document.createElement('div');
  title.textContent = url;
  const bar = document.createElement('progress');
  bar.max = 100;
  bar.value = 0;
  const status = document.createElement('div');
  status.textContent = 'Начинаем…';
  li.append(title, bar, status);
  $('list').prepend(li);
  items.set(id, { bar, status });
}

async function go() {
  const url = $('url').value;
  const mode = document.querySelector('input[name=mode]:checked').value;
  const id = await window.api.start(url, mode);
  addItem(id, url.trim());
  $('url').value = '';
}

$('go').addEventListener('click', go);
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
$('folder').addEventListener('click', () => window.api.openFolder());
$('report').addEventListener('click', async () => {
  await window.api.saveReport();
  alert('Файл «отчёт-о-проблеме.txt» сохранён на рабочем столе. Отправьте его мне.');
});

window.api.onProgress(({ id, percent, speed, eta }) => {
  const it = items.get(id);
  if (!it) return;
  it.bar.value = percent;
  it.status.textContent = `${percent}%  ·  ${speed}  ·  осталось ${eta}`;
});

window.api.onDone(({ id, ok, message }) => {
  const it = items.get(id);
  if (!it) return;
  if (ok) { it.bar.value = 100; it.status.textContent = 'Готово! Файл в папке «Загрузки»'; }
  else { it.status.textContent = message; it.status.className = 'err'; }
});

// Ссылка из буфера обмена подставляется сама.
window.api.clipboardUrl().then((u) => { if (u) $('url').value = u; });
