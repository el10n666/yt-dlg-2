const crypto = require('node:crypto');
const net = require('node:net');

// Связь приложения с привилегированным помощником. Приложение открывает именованный канал со случайным именем,
// запускает помощника с правами администратора и ждёт, пока он подключится. Подключение принимается одно: второе отклоняется.

function createSession({ launch, connectTimeoutMs = 60000, replyTimeoutMs = 15000 }) {
  const pipe = `\\\\.\\pipe\\yt-dlg-2-${crypto.randomBytes(12).toString('hex')}`;
  let server = null;
  let sock = null;
  const waiting = [];
  const exitListeners = [];

  const session = {
    pipe,
    get alive() { return Boolean(sock && !sock.destroyed); },
    onExit(cb) { exitListeners.push(cb); },

    async open() {
      let connected;
      const gotSocket = new Promise((resolve) => { connected = resolve; });
      server = net.createServer((s) => {
        if (sock) { s.destroy(); return; } // только один помощник
        sock = s;
        let buf = '';
        s.on('data', (d) => {
          buf += d.toString('utf8');
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            let msg;
            try { msg = JSON.parse(buf.slice(0, i)); } catch { msg = null; }
            buf = buf.slice(i + 1);
            if (!msg) continue;
            if (msg.event === 'exited') { for (const cb of exitListeners) cb(msg); continue; }
            const w = waiting.shift();
            if (w) w.resolve(msg);
          }
        });
        s.on('close', () => {
          for (const w of waiting.splice(0)) w.reject(new Error('Помощник zapret завершился'));
        });
        connected();
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });

      let timer;
      try {
        await launch({ pipe });
        await Promise.race([
          gotSocket,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Помощник zapret не подключился (timeout)')), connectTimeoutMs); }),
        ]);
      } catch (e) {
        await session.close();
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },

    request(msg) {
      if (!session.alive) return Promise.reject(new Error('Помощник zapret не запущен (not open)'));
      return new Promise((resolve, reject) => {
        const entry = {};
        const timer = setTimeout(() => {
          const i = waiting.indexOf(entry);
          if (i >= 0) waiting.splice(i, 1);
          reject(new Error('Помощник zapret не ответил'));
        }, replyTimeoutMs);
        entry.resolve = (m) => { clearTimeout(timer); resolve(m); };
        entry.reject = (e) => { clearTimeout(timer); reject(e); };
        waiting.push(entry);
        sock.write(JSON.stringify(msg) + '\n');
      });
    },

    async close() {
      if (sock && !sock.destroyed) {
        try { sock.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch { /* канал уже закрыт */ }
        sock.end();
      }
      sock = null;
      if (server) await new Promise((r) => server.close(() => r()));
      server = null;
    },
  };
  return session;
}

module.exports = { createSession };
