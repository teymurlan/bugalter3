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
  const referralCache = new Map();

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

  function loyaltyDiscount(clientId) {
    const completed = orders.filter((order) => String(order.client_telegram_id || '') === String(clientId || '') && order.status === 'COMPLETED').length;
    return completed >= 10 ? 10 : completed >= 3 ? 5 : 0;
  }

  async function referralFor(clientId) {
    const key = String(clientId || '');
    if (!key) return null;
    if (referralCache.has(key)) return referralCache.get(key);
    const promise = fetch(`/api/demo-admin-referral?user=${encodeURIComponent(key)}`, { headers: authHeaders() })
      .then(async (response) => response.ok ? response.json() : null)
      .catch(() => null);
    referralCache.set(key, promise);
    return promise;
  }

  function addReferralBadge(container, data, detail = false) {
    if (!container || container.querySelector(detail ? '[data-referral-detail]' : '[data-referral-badge]')) return;
    const discount = Number(data?.available_discount_percent || 0);
    if (discount <= 0) return;
    const badge = document.createElement('div');
    if (detail) {
      badge.dataset.referralDetail = '1';
      badge.className = 'summary-row admin-referral-detail';
      badge.innerHTML = `<span>Реферальная скидка</span><strong>${discount}% доступно</strong>`;
      container.appendChild(badge);
    } else {
      badge.dataset.referralBadge = '1';
      badge.className = 'admin-referral-badge';
      badge.textContent = `Реферальная скидка ${discount}%`;
      container.appendChild(badge);
    }
  }

  function addLoyaltyBadge(container, clientId, detail = false) {
    if (!container || container.querySelector(detail ? '[data-loyalty-detail]' : '[data-loyalty-badge]')) return;
    const discount = loyaltyDiscount(clientId);
    if (discount <= 0) return;
    const badge = document.createElement('div');
    if (detail) {
      badge.dataset.loyaltyDetail = '1';
      badge.className = 'summary-row admin-loyalty-detail';
      badge.innerHTML = `<span>Скидка по лояльности</span><strong>${discount}%</strong>`;
      container.appendChild(badge);
    } else {
      badge.dataset.loyaltyBadge = '1';
      badge.className = 'admin-loyalty-badge';
      badge.textContent = `Лояльность ${discount}%`;
      container.appendChild(badge);
    }
  }

  async function decorateCards() {
    const cards = [...root.querySelectorAll('.admin-order')];
    await Promise.all(cards.map(async (card) => {
      const open = card.querySelector('[data-open-order]');
      if (!open) return;
      const order = findOrder(open.dataset.openOrder, open.dataset.clientId);
      if (!order) return;

      if (!card.querySelector('[data-preferred-contact]')) {
        const label = methodLabel(order);
        if (label) {
          const contact = card.querySelector('.admin-contact');
          const line = document.createElement('div');
          line.dataset.preferredContact = '1';
          line.className = 'admin-preferred-contact';
          line.innerHTML = `<span>Связаться:</span><strong>${label}</strong>`;
          contact?.insertAdjacentElement('afterend', line);
        }
      }

      addLoyaltyBadge(card, order.client_telegram_id, false);
      if (!card.querySelector('[data-referral-badge]')) {
        const referral = await referralFor(order.client_telegram_id);
        addReferralBadge(card, referral, false);
      }
    }));
  }

  async function decorateDetail() {
    const title = root.querySelector('.admin-detail-title');
    const card = root.querySelector('.admin-detail-card');
    if (!title || !card) return;
    const order = findOrder(title.textContent.trim());
    if (!order) return;

    if (!root.querySelector('[data-preferred-contact-detail]')) {
      const label = methodLabel(order);
      if (label) {
        const row = document.createElement('div');
        row.dataset.preferredContactDetail = '1';
        row.className = 'summary-row';
        row.innerHTML = `<span>Способ связи</span><strong>${label}</strong>`;
        card.appendChild(row);
      }
    }

    addLoyaltyBadge(card, order.client_telegram_id, true);
    if (!root.querySelector('[data-referral-detail]')) {
      const referral = await referralFor(order.client_telegram_id);
      addReferralBadge(card, referral, true);
    }
  }

  async function decorate() {
    if (!orders.length) await loadOrders();
    await Promise.all([decorateCards(), decorateDetail()]);
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