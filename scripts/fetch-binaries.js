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

async function main() {
  const outDir = path.join(__dirname, '..', 'resources', 'bin');
  const pins = JSON.parse(fs.readFileSync(path.join(__dirname, 'sha256.json'), 'utf8'));
  await fetchYtDlp(outDir);
  await fetchFfmpeg(outDir, pins);
  console.log('Binaries ready in', outDir);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { verifySha256 };
