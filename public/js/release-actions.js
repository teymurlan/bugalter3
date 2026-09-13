(() => {
  const root = document.querySelector('#app');
  if (!root) return;
  const tg = window.Telegram?.WebApp;
  let contactPromise = null;
  let queued = false;

  function headers(extra = {}) { return { 'X-Telegram-Init-Data': tg?.initData || '', ...extra }; }
  async function json(path, options = {}) { const response = await fetch(path, { ...options, headers: headers(options.headers || {}) }); const data = await response.json().catch(() => ({})); if (!response.ok || data?.ok === false) throw new Error(data?.error || 'Не удалось открыть Telegram'); return data; }
  function toast(text, error = false) { const node = document.querySelector('#toast'); if (!node) return; node.textContent = text; node.className = `toast show${error ? ' error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.className = 'toast'; }, 2600); }
  function contact() { if (!contactPromise) contactPromise = json('/api/manager-contact').catch((error) => { contactPromise = null; throw error; }); return contactPromise; }
  function cleanUsername(value) { const username = String(value || '').trim().replace(/^@/, ''); return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : ''; }
  function openTelegram(url) { if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank'); }

  async function openManager(button) {
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const data = await contact();
      const username = cleanUsername(data?.username);
      if (username) { button.disabled = false; openTelegram(`https://t.me/${username}`); return; }
      await json('/api/contact-manager-fallback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      toast('Кнопка личного чата отправлена в Telegram');
      button.disabled = false;
      setTimeout(() => tg?.close?.(), 300);
    } catch (error) { button.disabled = false; toast(error.message || 'Не удалось открыть менеджера', true); }
  }

  function scan() {
    root.querySelectorAll('[data-write],[data-pass-manager]').forEach((button) => {
      if (button.dataset.releaseManagerReady) return;
      button.dataset.releaseManagerReady = '1';
      button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); openManager(button); };
    });
  }
  function queue() { if (queued) return; queued = true; queueMicrotask(() => { queued = false; scan(); }); }
  new MutationObserver(queue).observe(root, { childList: true, subtree: true });
  queue();
})();
