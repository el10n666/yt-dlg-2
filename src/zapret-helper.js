const net = require('node:net');
const path = require('node:path');
const { spawn: nodeSpawn, execFile } = require('node:child_process');
const { validateHelperCommand } = require('./zapret-run');
const { verifyManifest } = require('./zapret');

// Привилегированный помощник: запускается с правами администратора и живёт, пока жив канал с приложением.
// Протокол: JSON-строки через именованный канал. Приложение шлёт {cmd:'start',args}|{cmd:'stop'}|{cmd:'quit'},
// помощник отвечает {ok,event,...}. Что именно запускать, решает не сообщение, а эта программа: путь к winws.exe зафиксирован ниже.

const run = (file, args) => new Promise((resolve) => execFile(file, args, { windowsHide: true }, () => resolve()));

// Драйвер WinDivert остаётся загруженным после остановки winws.exe и мешает следующему запуску: выгружаем его.
async function defaultCleanup() {
  await run('sc.exe', ['stop', 'WinDivert']);
  await run('sc.exe', ['delete', 'WinDivert']);
  await run('sc.exe', ['stop', 'WinDivert14']);
  await run('sc.exe', ['delete', 'WinDivert14']);
}

function waitExit(proc, ms = 3000) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    proc.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

function connectWithRetry(pipePath, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const s = net.connect(pipePath);
      s.once('connect', () => resolve(s));
      s.once('error', () => {
        s.destroy();
        if (Date.now() >= deadline) resolve(null);
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

async function runHelper({
  pipePath,
  zapretDir,
  spawn = (exe, args) => nodeSpawn(exe, args, { windowsHide: true, stdio: 'ignore', cwd: path.join(zapretDir, 'bin') }),
  verify = () => verifyManifest(zapretDir),
  cleanup = defaultCleanup,
  connectTimeoutMs = 10000,
}) {
  const winws = path.win32.join(zapretDir, 'bin', 'winws.exe');
  const sock = await connectWithRetry(pipePath, connectTimeoutMs);
  if (!sock) return { connected: false }; // приложения нет: тихо выходим, ничего не запуская

  let proc = null;
  const stoppedOnPurpose = new WeakSet();
  const send = (obj) => { if (!sock.destroyed) sock.write(JSON.stringify(obj) + '\n'); };

  async function stopProc() {
    if (!proc) return;
    const p = proc;
    proc = null;
    stoppedOnPurpose.add(p);
    const exited = waitExit(p);
    try { p.kill(); } catch { /* уже завершён */ }
    await exited;
  }

  async function handle(raw) {
    let cmd;
    try { cmd = validateHelperCommand(raw, { winws }); } catch (e) { send({ ok: false, error: e.message }); return; }

    if (cmd.cmd === 'start') {
      let v;
      try { v = verify(); } catch (e) { v = { ok: false, bad: [e.message] }; }
      if (!v.ok) { send({ ok: false, error: `Файлы zapret повреждены: ${v.bad.join(', ')}` }); return; }
      await stopProc(); // два winws одновременно не нужны
      try {
        const p = spawn(cmd.exe, cmd.args);
        proc = p;
        p.on('exit', (code) => {
          if (stoppedOnPurpose.has(p)) return;
          if (proc === p) proc = null;
          send({ ok: false, event: 'exited', code });
        });
        send({ ok: true, event: 'started', pid: p.pid });
      } catch (e) {
        send({ ok: false, error: `Не удалось запустить winws.exe: ${e.message}` });
      }
      return;
    }

    if (cmd.cmd === 'stop') {
      await stopProc();
      await cleanup();
      send({ ok: true, event: 'stopped' });
    }
  }

  return new Promise((resolve) => {
    let finished = false;
    let chain = Promise.resolve(); // команды выполняются строго по очереди

    // finish вызывается всегда через chain.then(finish): к этому моменту предыдущие команды уже выполнены.
    // Ждать chain внутри самой finish нельзя: она сама последнее звено цепочки и дождалась бы себя навсегда.
    const finish = async () => {
      if (finished) return;
      finished = true;
      await stopProc();
      await cleanup();
      try { sock.destroy(); } catch { /* уже закрыт */ }
      resolve({ connected: true });
    };

    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { send({ ok: false, error: 'Не удалось разобрать команду' }); continue; }
        if (msg && msg.cmd === 'quit') { chain = chain.then(finish); continue; }
        chain = chain.then(() => handle(msg)).catch((e) => send({ ok: false, error: e.message }));
      }
    });
    // Приложение закрылось или упало: останавливаем winws и выгружаем драйвер, сами не остаёмся висеть с правами администратора.
    sock.on('close', () => { chain = chain.then(finish); });
    sock.on('error', () => { chain = chain.then(finish); });
  });
}

module.exports = { runHelper, defaultCleanup };
