// Работает и в окне (глобальные функции), и в Node (module.exports) для тестов.
(function (root) {
  const PLATFORMS = [
    { name: 'YouTube', color: '#ff0033', hosts: ['youtube.com', 'youtu.be'] },
    { name: 'ВКонтакте', color: '#0077ff', hosts: ['vk.com', 'vkvideo.ru', 'vk.ru'] },
    { name: 'Rutube', color: '#14192b', hosts: ['rutube.ru'] },
    { name: 'Одноклассники', color: '#ee8208', hosts: ['ok.ru'] },
    { name: 'Instagram', color: '#e1306c', hosts: ['instagram.com'] },
    { name: 'TikTok', color: '#17181f', hosts: ['tiktok.com'] },
    { name: 'Telegram', color: '#2aabee', hosts: ['t.me', 'telegram.org'] },
  ];
  const FALLBACK = '#6a6e7c';

  function detectPlatform(url) {
    let host;
    try { host = new URL(String(url).trim()).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
    // Совпадение по границе домена: notyoutube.com и youtube.com.evil.ru не считаются YouTube.
    const hit = PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith('.' + h)));
    return hit ? { name: hit.name, color: hit.color } : { name: host, color: FALLBACK };
  }

  function shortLink(url) {
    const s = String(url).trim().replace(/^https?:\/\/(www\.)?/i, '');
    return s.length > 38 ? s.slice(0, 37) + '…' : s;
  }

  const api = { detectPlatform, shortLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
