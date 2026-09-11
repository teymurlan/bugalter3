(() => {
  const root = document.querySelector('#app');
  if (!root) return;

  const tg = window.Telegram?.WebApp;
  const managerSelectors = '[data-manager],[data-chat],[data-contact-chat]';
  const callSelectors = '[data-call],[data-contact-call]';
  const clientChatSelector = '[data-chat-client]';
  const clientCache = new Map();
  let managerPromise = null;
  let scanQueued = false;

  function headers(extra = {}) {
    return { 'X-Telegram-Init-Data': tg?.initData || '', ...extra };
  }

  function notify(message, error = false) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  async function json(path, options = {}) {
    const response = await fetch(path, { ...options, headers: headers(options.headers || {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`);
    return data;
  }

  function cleanPhone(value) {
    const phone = String(value || '').trim().replace(/[^+\d]/g, '');
    return /^\+?\d{7,15}$/.test(phone) ? phone : '';
  }

  function cleanUsername(value) {
    const username = String(value || '').trim().replace(/^@/, '');
    return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : '';
  }

  function managerContact() {
    if (!managerPromise) {
      managerPromise = json('/api/manager-contact').catch((error) => {
        managerPromise = null;
        throw error;
      });
    }
    return managerPromise;
  }

  function clientContact(id) {
    const key = String(id || '');
    if (!clientCache.has(key)) {
      clientCache.set(key, json(`/api/admin-client-contact?user=${encodeURIComponent(key)}`).catch((error) => {
        clientCache.delete(key);
        throw error;
      }));
    }
    return clientCache.get(key);
  }

  function makeAnchor(source, href, telegram = false) {
    if (!source?.isConnected) return null;
    const anchor = document.createElement('a');
    anchor.className = source.className;
    anchor.innerHTML = source.innerHTML;
    anchor.href = href;
    anchor.dataset.contactV30 = 'ready';
    anchor.setAttribute('role', 'button');
    anchor.setAttribute('draggable', 'false');
    if (telegram) {
      anchor.addEventListener('click', (event) => {
        if (!tg?.openTelegramLink) return;
        event.preventDefault();
        tg.openTelegramLink(href);
      });
    }
    source.replaceWith(anchor);
    return anchor;
  }

  function isolateButton(source) {
    if (!source?.isConnected) return null;
    const replacement = source.cloneNode(true);
    replacement.dataset.contactV30 = 'pending';
    source.replaceWith(replacement);
    return replacement;
  }

  async function fallback(button, path, body) {
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await json(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      notify('Кнопка для личного чата отправлена в Telegram');
      try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
      setTimeout(() => tg?.close?.(), 250);
    } catch (error) {
      button.disabled = false;
      notify(error.message || 'Не удалось открыть Telegram', true);
    }
  }

  function upgradePhone(source) {
    if (source.dataset.contactV30) return;
    const button = isolateButton(source);
    if (!button) return;
    const directPhone = cleanPhone(button.dataset.call || '');
    if (directPhone) {
      makeAnchor(button, `tel:${directPhone}`);
      return;
    }
    managerContact().then((contact) => {
      if (!button.isConnected) return;
      const phone = cleanPhone(contact?.phone);
      if (!phone) {
        button.dataset.contactV30 = 'ready';
        button.disabled = false;
        button.onclick = () => notify('Номер телефона менеджера не настроен', true);
        return;
      }
      makeAnchor(button, `tel:${phone}`);
    }).catch(() => {
      if (!button.isConnected) return;
      button.dataset.contactV30 = 'ready';
      button.disabled = false;
      button.onclick = () => notify('Не удалось получить номер менеджера', true);
    });
  }

  function upgradeManagerChat(source) {
    if (source.dataset.contactV30) return;
    const button = isolateButton(source);
    if (!button) return;
    button.disabled = true;
    managerContact().then((contact) => {
      if (!button.isConnected) return;
      const username = cleanUsername(contact?.username);
      if (username) {
        makeAnchor(button, `https://t.me/${username}`, true);
        return;
      }
      button.dataset.contactV30 = 'ready';
      button.disabled = false;
      button.onclick = () => fallback(button, '/api/contact-manager-fallback', {});
    }).catch((error) => {
      if (!button.isConnected) return;
      button.dataset.contactV30 = 'ready';
      button.disabled = false;
      button.onclick = () => notify(error.message || 'Не удалось получить контакт менеджера', true);
    });
  }

  function upgradeClientChat(source) {
    if (source.dataset.contactV30) return;
    const id = String(source.dataset.chatClient || '').trim();
    const button = isolateButton(source);
    if (!button) return;
    button.disabled = true;
    if (!/^\d+$/.test(id)) {
      button.dataset.contactV30 = 'ready';
      button.disabled = false;
      button.onclick = () => notify('Telegram ID клиента не найден', true);
      return;
    }
    clientContact(id).then((contact) => {
      if (!button.isConnected) return;
      const username = cleanUsername(contact?.username);
      if (username) {
        makeAnchor(button, `https://t.me/${username}`, true);
        return;
      }
      button.dataset.contactV30 = 'ready';
      button.disabled = false;
      button.onclick = () => fallback(button, '/api/admin-client-chat-fallback', { client_telegram_id: Number(id) });
    }).catch((error) => {
      if (!button.isConnected) return;
      button.dataset.contactV30 = 'ready';
      button.disabled = false;
      button.onclick = () => notify(error.message || 'Не удалось получить Telegram клиента', true);
    });
  }

  function scan() {
    root.querySelectorAll(callSelectors).forEach(upgradePhone);
    root.querySelectorAll(managerSelectors).forEach(upgradeManagerChat);
    root.querySelectorAll(clientChatSelector).forEach(upgradeClientChat);
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(() => {
      scanQueued = false;
      scan();
    });
  }

  new MutationObserver(queueScan).observe(root, { childList: true, subtree: true });
  managerContact().catch(() => null).finally(queueScan);
  queueScan();
})();
