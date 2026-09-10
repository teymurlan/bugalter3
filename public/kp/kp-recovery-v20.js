(() => {
  const VERSION = '20';

  function telegramInitData() {
    return window.Telegram?.WebApp?.initData || '';
  }

  async function fetchBootstrap(timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`/api/kp/bootstrap?v=${VERSION}&t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'X-Telegram-Init-Data': telegramInitData() },
        signal: controller.signal,
      });
      let data = null;
      try { data = await response.json(); } catch {}
      if (!response.ok || !data?.ok) throw new Error(data?.error || `Ошибка ${response.status}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function applyBootstrap(data) {
    state.bootstrap = data;
    state.currentId = null;
    state.currentNumber = data.defaults?.quote_number || 'Исх. № 15';
    state.lastSaved = null;

    gate.classList.add('hidden');
    app.classList.remove('hidden');
    gateText.textContent = 'Доступ подтверждён';

    const badge = document.getElementById('quoteNumberBadge');
    if (badge) badge.textContent = state.currentNumber;
    const outgoing = document.getElementById('outgoingNumber');
    const match = String(state.currentNumber).match(/\d+/);
    if (outgoing && match) outgoing.value = match[0];

    if (fields.issue_date) fields.issue_date.value = data.defaults?.issue_date || '';
    if (fields.valid_days) fields.valid_days.value = data.defaults?.valid_days || 14;
    if (fields.client_name) fields.client_name.value = '';
    if (fields.client_company) fields.client_company.value = '';
    if (fields.address) fields.address.value = '';
    if (fields.object_type) fields.object_type.value = data.defaults?.object_type || 'Коммерческое помещение';
    if (fields.area) fields.area.value = '';
    if (fields.title) fields.title.value = data.defaults?.title || 'Коммерческое предложение на оказание клининговых услуг';
    if (fields.discount_percent) fields.discount_percent.value = '0';
    if (fields.prepayment_percent) fields.prepayment_percent.value = '0';
    if (fields.duration) fields.duration.value = data.defaults?.duration || '1–2 дня';
    if (fields.vat_label) fields.vat_label.value = data.defaults?.vat_label || 'Без НДС';
    if (fields.payment_terms) fields.payment_terms.value = '';
    if (fields.notes) fields.notes.value = '';
    state.items = [];

    try { renderPresets(); } catch {}
    try { renderItems(); } catch {}
    try { updateTotals(); } catch {}
    try { window.__hcSyncEquipmentChooser?.(); } catch {}

    // История не должна блокировать сам генератор.
    Promise.race([
      Promise.resolve().then(() => loadHistory()),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]).catch(() => {});
  }

  function showRecovery(error) {
    gate.classList.remove('hidden');
    app.classList.add('hidden');
    gateText.innerHTML = '';

    const text = document.createElement('span');
    text.textContent = error?.name === 'AbortError'
      ? 'Сервер не ответил вовремя. Нажмите «Повторить».'
      : (error?.message || 'Не удалось проверить доступ администратора.');
    gateText.appendChild(text);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Повторить';
    button.style.cssText = 'display:block;margin:18px auto 0;padding:12px 22px;border-radius:12px;border:1px solid #d5ae4c;background:#17140d;color:#f2cf72;font-weight:800;font-size:15px';
    button.onclick = () => {
      button.disabled = true;
      text.textContent = 'Проверяем доступ…';
      fetchBootstrap(7000).then(applyBootstrap).catch(showRecovery);
    };
    gateText.appendChild(button);
  }

  async function recoverIfNeeded() {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    if (state.bootstrap || !app.classList.contains('hidden')) return;
    try {
      const data = await fetchBootstrap();
      applyBootstrap(data);
    } catch (error) {
      showRecovery(error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => recoverIfNeeded().catch(showRecovery), { once: true });
  } else {
    recoverIfNeeded().catch(showRecovery);
  }
})();
