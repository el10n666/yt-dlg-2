const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

async function verifySha256(filePath, expected) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex') === String(expected).trim().toLowerCase();
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Хэш yt-dlp берём из SHA2-256SUMS того же стабильного релиза.
async function fetchYtDlp(outDir) {
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
  const dest = path.join(outDir, 'yt-dlp.exe');
  await download(`${base}/yt-dlp.exe`, dest);
  const sums = await (await fetch(`${base}/SHA2-256SUMS`)).text();
  const line = sums.split('\n').find((l) => /\s\*?yt-dlp\.exe\s*$/.test(l));
  if (!line) throw new Error('yt-dlp.exe not found in SHA2-256SUMS');
  if (!(await verifySha256(dest, line.trim().split(/\s+/)[0]))) {
    fs.rmSync(dest);
    throw new Error('yt-dlp.exe: SHA-256 mismatch');
  }
}

// ffmpeg: хэш пинится вручную в sha256.json после первой проверки; пустой хэш = отказ.
async function fetchFfmpeg(outDir, pins) {
  const pin = pins.ffmpeg;
  if (!pin || !pin.url || !pin.sha256) {
    throw new Error('ffmpeg: заполните url и sha256 в scripts/sha256.json после ручной проверки архива');
  }
  const zip = path.join(outDir, 'ffmpeg.zip');
  await download(pin.url, zip);
  if (!(await verifySha256(zip, pin.sha256))) {
    fs.rmSync(zip);
    throw new Error('ffmpeg: SHA-256 mismatch');
  }
  // Встроенный bsdtar по полному пути: tar из Git Bash (GNU) принимает "C:" за удалённый хост.
  const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  require('node:child_process').execFileSync(bsdtar, ['-xf', zip, '-C', outDir, '--strip-components=2', '*/bin/ffmpeg.exe']);
  fs.rmSync(zip);
}

// zapret (Flowseal, MIT): официальный архив релиза с закреплённым хэшем. Берём только то, что нужно приложению:
// bin/, lists/ и general*.bat. service.bat и утилиты не нужны: подбор и запуск делает само приложение.
async function fetchZapret(outDir, pins) {
  const pin = pins.zapret;
  if (!pin || !pin.url || !pin.sha256 || !pin.version) throw new Error('zapret: заполните version, url и sha256 в scripts/sha256.json');
  const work = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'zapret-'));
  const zip = path.join(work, 'zapret.zip');
  await download(pin.url, zip);
  if (!(await verifySha256(zip, pin.sha256))) throw new Error('zapret: SHA-256 mismatch');
  const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  require('node:child_process').execFileSync(bsdtar, ['-xf', zip, '-C', work]);
  const src = path.join(work, `zapret-discord-youtube-${pin.version}`);
  if (!fs.existsSync(path.join(src, 'bin', 'winws.exe'))) throw new Error('zapret: в архиве нет bin/winws.exe');

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(path.join(src, 'bin'), path.join(outDir, 'bin'), { recursive: true });
  fs.cpSync(path.join(src, 'lists'), path.join(outDir, 'lists'), { recursive: true });
  for (const f of fs.readdirSync(src)) if (/^general.*\.bat$/i.test(f)) fs.copyFileSync(path.join(src, f), path.join(outDir, f));
  // В архиве релиза лицензии нет; MIT требует её при распространении, поэтому берём копию из репозитория (тег 1.10.4).
  fs.copyFileSync(path.join(__dirname, 'licenses', 'zapret-LICENSE.txt'), path.join(outDir, 'LICENSE.txt'));
  fs.writeFileSync(path.join(outDir, 'version.txt'), pin.version, 'utf8');
  require('../src/zapret').writeManifest(outDir);
  fs.rmSync(work, { recursive: true, force: true });
}

async function main() {
  const root = path.join(__dirname, '..', 'resources');
  const outDir = path.join(root, 'bin');
  const pins = JSON.parse(fs.readFileSync(path.join(__dirname, 'sha256.json'), 'utf8'));
  await fetchYtDlp(outDir);
  await fetchFfmpeg(outDir, pins);
  await fetchZapret(path.join(root, 'zapret'), pins);
  console.log('Binaries ready in', root);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { verifySha256 };
