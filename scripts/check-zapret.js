// Проверка настоящего архива zapret после npm run fetch-bin: манифест и разбор каждого general*.bat.
const fs = require('node:fs');
const path = require('node:path');
const z = require('../src/zapret');

const root = path.join(__dirname, '..', 'resources', 'zapret');
const dirs = { binDir: 'C:\\Users\\Иван Петров\\AppData\\Roaming\\yt-dlg-2\\zapret\\bin', listsDir: 'C:\\Users\\Иван Петров\\AppData\\Roaming\\yt-dlg-2\\zapret\\lists' };
console.log('version:', fs.readFileSync(path.join(root, 'version.txt'), 'utf8'));
console.log('manifest:', JSON.stringify(z.verifyManifest(root)));
const names = z.listStrategies(root);
let ok = 0;
const bad = [];
let sample;
for (const n of names) {
  try {
    const { args } = z.parseStrategy(fs.readFileSync(path.join(root, `${n}.bat`), 'utf8'), dirs);
    if (n === 'general') sample = args;
    ok++;
  } catch (e) { bad.push(`${n}: ${e.message}`); }
}
console.log('strategies:', names.length, 'parsed:', ok, 'failed:', JSON.stringify(bad));
console.log('general args:', sample.length, 'first:', sample[0], '| sample file arg:', sample.find((a) => a.startsWith('--hostlist=')));

// Каждая настоящая стратегия должна пройти проверку помощника, иначе слайдер её никогда не запустит.
const { validateHelperCommand, buildElevatedLaunch } = require('../src/zapret-run');
const winws = path.win32.join(path.win32.dirname(dirs.binDir), 'bin', 'winws.exe');
const rejected = [];
for (const n of names) {
  const { args } = z.parseStrategy(fs.readFileSync(path.join(root, `${n}.bat`), 'utf8'), dirs);
  try { validateHelperCommand({ cmd: 'start', args }, { winws }); } catch (e) { rejected.push(`${n}: ${e.message}`); }
}
console.log('helper accepts:', names.length - rejected.length, 'rejects:', JSON.stringify(rejected));
const l = buildElevatedLaunch({ exe: 'C:\\Users\\Иван\\AppData\\Local\\Programs\\yt-dlg-2\\Скачать видео.exe', args: ['--zapret-helper', '--zapret-pipe=\\\\.\\pipe\\yt-dlg-2-0123456789abcdef01234567'] });
console.log('elevated line:', l.args[l.args.length - 1]);
if (bad.length || rejected.length) process.exit(1);
