const test = require('node:test');
const assert = require('node:assert');
const r = require('../src/zapret-run');
const { pickStrategy } = require('../src/zapret');

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const MiB = 1024 * 1024;

// Поток, отдающий куски с задержкой; stallAfter: после стольких кусков read() зависает навсегда (как оборванное соединение).
function fakeFetch({ status = 206, chunks = 4, size = 512 * 1024, delay = 0, stallAfter = Infinity, record = {} } = {}) {
  return async (url, opts) => {
    record.url = url;
    record.opts = opts;
    let i = 0;
    return {
      status,
      body: {
        getReader: () => ({
          read: async () => {
            if (i >= stallAfter) return new Promise(() => {});
            if (i >= chunks) return { done: true };
            i++;
            if (delay) await sleep(delay);
            return { done: false, value: new Uint8Array(size) };
          },
          cancel: async () => { record.cancelled = true; },
        }),
      },
    };
  };
}

test('measureThroughput passes when the requested number of bytes arrives in time, and stops reading there', async () => {
  const rec = {};
  const res = await r.measureThroughput({ url: 'https://x.googlevideo.com/v', bytes: MiB, timeoutMs: 1000, fetchFn: fakeFetch({ chunks: 10, record: rec }) });
  assert.strictEqual(res.ok, true);
  assert.ok(res.bytes >= MiB && res.bytes < 3 * MiB, `read ${res.bytes}`);
  assert.strictEqual(rec.cancelled, true);
});

test('measureThroughput asks for exactly the first bytes with a Range header', async () => {
  const rec = {};
  await r.measureThroughput({ url: 'https://x.googlevideo.com/v', bytes: MiB, timeoutMs: 1000, fetchFn: fakeFetch({ record: rec }) });
  assert.strictEqual(rec.opts.headers.Range, `bytes=0-${MiB - 1}`);
  assert.ok(rec.opts.signal);
});

test('measureThroughput fails on a stalled connection within the timeout instead of hanging', async () => {
  const t0 = Date.now();
  const res = await r.measureThroughput({ url: 'u', bytes: 4 * MiB, timeoutMs: 150, fetchFn: fakeFetch({ stallAfter: 1, size: 100 * 1024 }) });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'timeout');
  assert.ok(Date.now() - t0 < 1000);
  assert.strictEqual(res.bytes, 100 * 1024); // сколько успело прийти до обрыва
});

test('measureThroughput fails when the data is too slow even though it keeps flowing', async () => {
  const res = await r.measureThroughput({ url: 'u', bytes: 4 * MiB, timeoutMs: 200, fetchFn: fakeFetch({ chunks: 100, size: 10 * 1024, delay: 40 }) });
  assert.strictEqual(res.ok, false);
});

test('measureThroughput fails on HTTP errors and on a network error without throwing', async () => {
  assert.strictEqual((await r.measureThroughput({ url: 'u', bytes: MiB, timeoutMs: 500, fetchFn: fakeFetch({ status: 403 }) })).ok, false);
  const boom = async () => { throw new Error('ECONNRESET'); };
  const res = await r.measureThroughput({ url: 'u', bytes: MiB, timeoutMs: 500, fetchFn: boom });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /ECONNRESET/);
});

test('measureThroughput passes for a file smaller than the probe when the server says it was delivered whole (Content-Range total)', async () => {
  const f = async () => ({
    status: 206,
    headers: { get: (h) => (h.toLowerCase() === 'content-range' ? 'bytes 0-433080/433081' : null) },
    body: { getReader: () => { let i = 0; return { read: async () => (i++ ? { done: true } : { done: false, value: new Uint8Array(433081) }), cancel: async () => {} }; } },
  });
  const res = await r.measureThroughput({ url: 'u', bytes: 2 * MiB, timeoutMs: 500, fetchFn: f });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.bytes, 433081);
});

test('measureThroughput still fails when the stream ends before the size the server announced', async () => {
  const f = async () => ({
    status: 206,
    headers: { get: (h) => (h.toLowerCase() === 'content-range' ? 'bytes 0-2097151/9000000' : null) },
    body: { getReader: () => { let i = 0; return { read: async () => (i++ ? { done: true } : { done: false, value: new Uint8Array(433081) }), cancel: async () => {} }; } },
  });
  assert.strictEqual((await r.measureThroughput({ url: 'u', bytes: 2 * MiB, timeoutMs: 500, fetchFn: f })).ok, false);
});

test('measureThroughput fails when the stream ends before enough bytes', async () => {
  const res = await r.measureThroughput({ url: 'u', bytes: 4 * MiB, timeoutMs: 500, fetchFn: fakeFetch({ chunks: 2 }) });
  assert.strictEqual(res.ok, false);
});

const TARGETS = [{ name: 'discord', url: 'https://discord.com' }, { name: 'youtube', url: 'https://www.youtube.com' }];
const reachable = async () => ({ status: 404 });

test('checkAll without a video url checks only the hosts', async () => {
  assert.deepStrictEqual(await r.checkAll({ targets: TARGETS, fetchFn: reachable, timeoutMs: 100 }), { passed: 2, total: 2, failed: [] });
});

test('checkAll counts a stalled video as a failure even when every host answers (the case the old check missed)', async () => {
  const measure = async () => ({ ok: false, bytes: 0, reason: 'timeout' });
  const res = await r.checkAll({ targets: TARGETS, fetchFn: reachable, timeoutMs: 100, videoUrl: 'https://x.googlevideo.com/v', measure });
  assert.deepStrictEqual(res, { passed: 2, total: 3, failed: ['video-download'] });
});

test('checkAll passes everything when hosts answer and the video downloads', async () => {
  const measure = async () => ({ ok: true, bytes: MiB });
  const res = await r.checkAll({ targets: TARGETS, fetchFn: reachable, timeoutMs: 100, videoUrl: 'https://x.googlevideo.com/v', measure });
  assert.deepStrictEqual(res, { passed: 3, total: 3, failed: [] });
});

test('parseDirectUrl picks the googlevideo url and ignores warnings and other lines', () => {
  const out = [
    'WARNING: [youtube] No supported JavaScript runtime could be found.',
    'https://rr5---sn-aj5goc-5x.googlevideo.com/videoplayback?expire=1&itag=134&source=youtube',
    'https://rr5---sn-aj5goc-5x.googlevideo.com/videoplayback?expire=1&itag=140',
  ].join('\r\n');
  assert.strictEqual(r.parseDirectUrl(out), 'https://rr5---sn-aj5goc-5x.googlevideo.com/videoplayback?expire=1&itag=134&source=youtube');
});

test('parseDirectUrl refuses anything that is not an https googlevideo url', () => {
  for (const bad of ['', 'ERROR: boom', 'http://x.googlevideo.com/videoplayback?a=1', 'https://evil.example.com/videoplayback?a=1', 'https://googlevideo.com.evil.ru/videoplayback?a=1']) {
    assert.strictEqual(r.parseDirectUrl(bad), null, bad);
  }
});

const nic = (...names) => Object.fromEntries(names.map((n) => [n, [{ address: '10.0.0.1', internal: false }]]));

test('detectVpn names a VPN-like adapter and ignores ordinary ones', () => {
  assert.strictEqual(r.detectVpn(nic('Ethernet', 'tun0')), 'tun0');
  assert.strictEqual(r.detectVpn(nic('Wi-Fi', 'WireGuard Tunnel')), 'WireGuard Tunnel');
  assert.strictEqual(r.detectVpn(nic('Ethernet', 'Happ')), 'Happ');
  assert.strictEqual(r.detectVpn(nic('Ethernet 2', 'Wi-Fi', 'vEthernet (WSL)', 'Loopback Pseudo-Interface 1')), null);
});

test('pickStrategy reports every attempt with its check result so the log shows what was tried', async () => {
  const attempts = [];
  const results = { general: { passed: 1, total: 3, failed: ['video-download', 'discord'] }, 'general (ALT)': { passed: 3, total: 3, failed: [] } };
  let current;
  await pickStrategy({
    names: ['general', 'general (ALT)'], preferred: '',
    start: async (n) => { current = n; }, stop: async () => {}, wait: async () => {},
    check: async () => results[current], onProgress: () => {}, isCancelled: () => false,
    onAttempt: (a) => attempts.push(a),
  });
  assert.deepStrictEqual(attempts.map((a) => [a.name, a.passed, a.total]), [['general', 1, 3], ['general (ALT)', 3, 3]]);
  assert.deepStrictEqual(attempts[0].failed, ['video-download', 'discord']);
});
