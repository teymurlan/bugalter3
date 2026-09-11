(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') !== '1') return;
  const root = document.querySelector('#app');
  if (!root) return;
  let ordersCache = null;

  function headers() {
    return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
  }

  async function getJson(path) {
    const response = await fetch(path, { headers: headers() });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function adminOrders() {
    if (ordersCache) return ordersCache;
    const data = await getJson('/api/demo-admin-orders');
    ordersCache = Array.isArray(data?.orders) ? data.orders : [];
    return ordersCache;
  }

  function money(value) {
    return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`;
  }

  function discountName(type) {
    if (type === 'loyalty') return 'Программа лояльности';
    if (type === 'referral_friend') return 'Скидка по приглашению друга';
    if (type === 'referral_reward') return 'Реферальная награда';
    return 'Скидка';
  }

  async function decorateOrderDiscount() {
    const shell = root.querySelector('.ops-detail-shell');
    if (!shell || shell.querySelector('[data-admin-detail-discount]')) return;
    const number = String(shell.querySelector('.ops-detail-head span')?.textContent || '').trim();
    if (!/^HC-[A-Za-z0-9._-]+$/i.test(number)) return;
    const orders = await adminOrders();
    if (!root.contains(shell)) return;
    const order = orders.find((item) => String(item.order_number || '') === number);
    const percent = Number(order?.discount_percent || 0);
    const before = Number(order?.price_before_discount || 0);
    const after = Number(order?.estimated_price || 0);
    if (!percent || !before || !after) return;
    const amount = Number(order.discount_amount || Math.max(0, before - after));
    const card = document.createElement('section');
    card.dataset.adminDetailDiscount = '1';
    card.className = 'ops-detail-discount card';
    card.innerHTML = `
      <div><span>Стоимость до скидки</span><strong>${money(before)}</strong></div>
      <div><span>${escapeHtml(discountName(order.discount_type))} · ${percent}%</span><strong class="minus">−${money(amount)}</strong></div>
      <div class="total"><span>Предварительная стоимость</span><strong>от ${money(after)}</strong></div>`;
    shell.querySelector('.ops-detail-card')?.insertAdjacentElement('afterend', card);
  }

  async function decorateClientInsights() {
    const shell = root.querySelector('.ops-detail-shell');
    const progress = shell?.querySelector('.ops-client-progress');
    const chatButton = shell?.querySelector('[data-chat-client]');
    if (!shell || !progress || !chatButton || shell.querySelector('[data-client-insights]')) return;
    const clientId = String(chatButton.dataset.chatClient || '').trim();
    if (!/^\d+$/.test(clientId)) return;

    const placeholder = document.createElement('section');
    placeholder.dataset.clientInsights = '1';
    placeholder.className = 'ops-client-insights loading-state';
    placeholder.innerHTML = '<span>Загружаем сервисную историю…</span>';
    progress.insertAdjacentElement('afterend', placeholder);

    const [refData, reviewsData, allRefData] = await Promise.all([
      getJson(`/api/demo-admin-benefits?user=${encodeURIComponent(clientId)}`),
      getJson('/api/demo-admin-reviews'),
      getJson('/api/demo-admin-referrals'),
    ]);
    if (!root.contains(placeholder)) return;

    const reviews = (reviewsData?.reviews || []).filter((item) => String(item.client_telegram_id) === clientId);
    const invites = (allRefData?.referrals || []).filter((item) => String(item.inviter_id) === clientId);
    const completedFriends = invites.filter((item) => item.completed).length;
    const average = reviews.length
      ? (reviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / reviews.length).toFixed(1)
      : '—';
    const available = Number(refData?.available_referral_rewards || 0);
    const reserved = Number(refData?.reserved_referral_rewards || 0);
    const friendDiscount = Number(refData?.friend_discount_percent || 0);

    placeholder.classList.remove('loading-state');
    placeholder.innerHTML = `
      <div class="ops-client-insight-head"><div><span>Сервисная история</span><strong>Рефералы и отзывы</strong></div>${friendDiscount ? `<b>Другу доступно ${friendDiscount}%</b>` : ''}</div>
      <div class="ops-client-insight-grid">
        <div><strong>${invites.length}</strong><span>Приглашено друзей</span></div>
        <div><strong>${completedFriends}</strong><span>Успешных рекомендаций</span></div>
        <div><strong>${available}</strong><span>Доступно скидок 15%</span></div>
        <div><strong>${average}${average !== '—' ? ' ★' : ''}</strong><span>Средняя оценка</span></div>
      </div>
      <div class="ops-client-insight-foot"><span>${reserved ? `Зарезервировано скидок: ${reserved} · Отзывов клиента` : 'Отзывов клиента'}</span><strong>${reviews.length}</strong></div>`;
  }

  async function decorate() {
    await Promise.all([decorateOrderDiscount(), decorateClientInsights()]);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char] || char));
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(); });
  }).observe(root, { childList: true, subtree: true });
  decorate();
})();
