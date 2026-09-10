(() => {
  const params = new URLSearchParams(window.location.search || '');
  const session = params.get('s') || '';
  const nativeFetch = window.fetch.bind(window);

  window.fetch = function hcKpFetch(input, init = {}) {
    try {
      const url = typeof input === 'string' ? new URL(input, window.location.href) : new URL(input.url, window.location.href);
      if (session && url.origin === window.location.origin && url.pathname.startsWith('/api/kp/')) {
        const headers = new Headers(init.headers || (typeof input === 'string' ? undefined : input.headers) || {});
        headers.set('X-KP-Session', session);
        if (typeof input === 'string') return nativeFetch(input, { ...init, headers });
        return nativeFetch(new Request(input, { ...init, headers }));
      }
    } catch {}
    return nativeFetch(input, init);
  };

  window.__HC_KP_BUILD__ = '21';
  window.__HC_KP_SESSION__ = Boolean(session);

  window.addEventListener('DOMContentLoaded', () => {
    const gateText = document.getElementById('gateText');
    if (!gateText) return;
    const marker = document.createElement('small');
    marker.textContent = ' · v21';
    marker.style.cssText = 'display:block;margin-top:10px;font-size:11px;opacity:.45';
    gateText.appendChild(marker);

    setTimeout(() => {
      const gate = document.getElementById('gate');
      const app = document.getElementById('app');
      if (!gate || !app || gate.classList.contains('hidden') || !app.classList.contains('hidden')) return;
      const current = document.getElementById('gateText');
      if (!current) return;
      current.textContent = session
        ? 'Подключение к КП занимает слишком много времени. Нажмите «Повторить».'
        : 'Откройте КП через новую кнопку после команды /kp.';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Повторить';
      btn.style.cssText = 'display:block;margin:16px auto 0;padding:12px 20px;border-radius:12px;border:1px solid #d5ae4c;background:#17140d;color:#f2cf72;font-weight:800';
      btn.onclick = () => window.location.reload();
      current.appendChild(btn);
    }, 9000);
  }, { once: true });
})();
