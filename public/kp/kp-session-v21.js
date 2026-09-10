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

  window.__HC_KP_BUILD__ = '22';
  window.__HC_KP_SESSION__ = Boolean(session);

  window.addEventListener('DOMContentLoaded', () => {
    const gateText = document.getElementById('gateText');
    if (!gateText) return;

    const marker = document.createElement('small');
    marker.textContent = 'v22';
    marker.style.cssText = 'display:block;margin-top:10px;font-size:11px;opacity:.45';
    gateText.appendChild(marker);

    // Старую неподписанную кнопку больше не оставляем висеть на проверке.
    if (!session) {
      setTimeout(() => {
        const gate = document.getElementById('gate');
        const app = document.getElementById('app');
        if (!gate || !app || gate.classList.contains('hidden') || !app.classList.contains('hidden')) return;
        gateText.innerHTML = '';
        const text = document.createElement('span');
        text.textContent = 'Эта кнопка устарела. Отправьте боту /kp или /menu и откройте новую кнопку «Открыть КП».';
        gateText.appendChild(text);
      }, 1200);
      return;
    }

    setTimeout(() => {
      const gate = document.getElementById('gate');
      const app = document.getElementById('app');
      if (!gate || !app || gate.classList.contains('hidden') || !app.classList.contains('hidden')) return;
      gateText.innerHTML = '';
      const text = document.createElement('span');
      text.textContent = 'Не удалось открыть КП. Нажмите «Повторить».';
      gateText.appendChild(text);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Повторить';
      btn.style.cssText = 'display:block;margin:16px auto 0;padding:12px 20px;border-radius:12px;border:1px solid #d5ae4c;background:#17140d;color:#f2cf72;font-weight:800';
      btn.onclick = () => window.location.reload();
      gateText.appendChild(btn);
    }, 7000);
  }, { once: true });
})();
