(() => {
  const params = new URLSearchParams(window.location.search || '');
  const session = params.get('s') || '';
  const nativeFetch = window.fetch.bind(window);

  window.__HC_KP_BUILD__ = '23';
  window.__HC_KP_SESSION__ = Boolean(session);

  window.fetch = function hcKpFetch(input, init = {}) {
    try {
      const url = typeof input === 'string'
        ? new URL(input, window.location.href)
        : new URL(input.url, window.location.href);
      if (session && url.origin === window.location.origin && url.pathname.startsWith('/api/kp/')) {
        const headers = new Headers(init.headers || (typeof input === 'string' ? undefined : input.headers) || {});
        headers.set('X-KP-Session', session);
        if (typeof input === 'string') return nativeFetch(input, { ...init, headers, cache: 'no-store' });
        return nativeFetch(new Request(input, { ...init, headers, cache: 'no-store' }));
      }
    } catch {}
    return nativeFetch(input, init);
  };

  window.addEventListener('DOMContentLoaded', () => {
    const gateText = document.getElementById('gateText');
    if (!gateText) return;

    const marker = document.createElement('small');
    marker.textContent = 'v23';
    marker.style.cssText = 'display:block;margin-top:10px;font-size:11px;opacity:.42';
    gateText.appendChild(marker);

    if (!session) {
      setTimeout(() => {
        const gate = document.getElementById('gate');
        const app = document.getElementById('app');
        if (!gate || !app || gate.classList.contains('hidden') || !app.classList.contains('hidden')) return;
        gateText.innerHTML = 'Эта кнопка КП устарела. Закройте окно и нажмите «Коммерческие предложения» в новом меню бота после /start.';
      }, 2500);
      return;
    }

    setTimeout(() => {
      const gate = document.getElementById('gate');
      const app = document.getElementById('app');
      if (!gate || !app || gate.classList.contains('hidden') || !app.classList.contains('hidden')) return;
      gateText.innerHTML = '';
      const text = document.createElement('span');
      text.textContent = 'Не удалось открыть КП. Повторите вход из меню бота.';
      gateText.appendChild(text);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Повторить';
      button.style.cssText = 'display:block;margin:16px auto 0;padding:12px 22px;border-radius:12px;border:1px solid #d5ae4c;background:#17140d;color:#f2cf72;font-weight:800';
      button.onclick = () => window.location.reload();
      gateText.appendChild(button);
    }, 8000);
  }, { once: true });
})();
