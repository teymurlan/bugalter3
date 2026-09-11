(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') !== '1') return;

  const root = document.querySelector('#app');
  if (!root) return;

  const labels = {
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
    max: 'MAX',
    call: 'Звонок',
  };

  let orders = [];
  let loading = null;

  function authHeaders() {
    return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
  }

  async function loadOrders() {
    if (loading) return loading;
    loading = fetch('/api/demo-admin-orders', { headers: authHeaders() })
      .then(async (response) => response.ok ? response.json() : { orders: [] })
      .then((data) => {
        orders = Array.isArray(data?.orders) ? data.orders : [];
        return orders;
      })
      .catch(() => [])
      .finally(() => { loading = null; });
    return loading;
  }

  function methodLabel(order) {
    const key = String(order?.contact_method || order?.contactMethod || '').toLowerCase();
    return labels[key] || '';
  }

  function findOrder(number, clientId = '') {
    return orders.find((order) => String(order.order_number || '') === String(number || '')
      && (!clientId || String(order.client_telegram_id || '') === String(clientId)));
  }

  function decorateCards() {
    root.querySelectorAll('.admin-order').forEach((card) => {
      if (card.querySelector('[data-preferred-contact]')) return;
      const open = card.querySelector('[data-open-order]');
      if (!open) return;
      const order = findOrder(open.dataset.openOrder, open.dataset.clientId);
      const label = methodLabel(order);
      if (!label) return;
      const contact = card.querySelector('.admin-contact');
      const line = document.createElement('div');
      line.dataset.preferredContact = '1';
      line.className = 'admin-preferred-contact';
      line.innerHTML = `<span>Связаться:</span><strong>${label}</strong>`;
      contact?.insertAdjacentElement('afterend', line);
    });
  }

  function decorateDetail() {
    if (root.querySelector('[data-preferred-contact-detail]')) return;
    const title = root.querySelector('.admin-detail-title');
    const card = root.querySelector('.admin-detail-card');
    if (!title || !card) return;
    const order = findOrder(title.textContent.trim());
    const label = methodLabel(order);
    if (!label) return;
    const row = document.createElement('div');
    row.dataset.preferredContactDetail = '1';
    row.className = 'summary-row';
    row.innerHTML = `<span>Способ связи</span><strong>${label}</strong>`;
    card.appendChild(row);
  }

  async function decorate() {
    if (!orders.length) await loadOrders();
    decorateCards();
    decorateDetail();
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      decorate();
    });
  }).observe(root, { childList: true, subtree: true });

  decorate();
})();