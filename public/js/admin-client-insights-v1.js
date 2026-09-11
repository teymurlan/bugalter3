(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') !== '1') return;
  const root = document.querySelector('#app');
  if (!root) return;

  function headers() {
    return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
  }

  async function getJson(path) {
    const response = await fetch(path, { headers: headers() });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function decorate() {
    const shell = root.querySelector('.ops-detail-shell');
    const chatButton = shell?.querySelector('[data-chat-client]');
    if (!shell || !chatButton || shell.querySelector('[data-client-insights]')) return;
    const clientId = String(chatButton.dataset.chatClient || '').trim();
    if (!/^\d+$/.test(clientId)) return;

    const placeholder = document.createElement('section');
    placeholder.dataset.clientInsights = '1';
    placeholder.className = 'ops-client-insights loading-state';
    placeholder.innerHTML = '<span>Загружаем сервисную историю…</span>';
    const progress = shell.querySelector('.ops-client-progress');
    progress?.insertAdjacentElement('afterend', placeholder);

    const [refData, reviewsData, allRefData] = await Promise.all([
      getJson(`/api/demo-admin-referral?user=${encodeURIComponent(clientId)}`),
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
    const available = Number(refData?.available_rewards ?? refData?.available_referral_rewards ?? 0);
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
      <div class="ops-client-insight-foot"><span>Отзывов клиента</span><strong>${reviews.length}</strong></div>`;
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(); });
  }).observe(root, { childList: true, subtree: true });
  decorate();
})();
