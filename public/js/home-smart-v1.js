(() => {
  const root = document.querySelector('#app');
  if (!root) return;
  let running = false;

  function headers() {
    return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
  }

  async function getJson(path) {
    const response = await fetch(path, { headers: headers() });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function findUnreviewedCompleted(orders) {
    const completed = (orders || []).filter((item) => item.status === 'COMPLETED').sort((a,b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))).slice(0, 5);
    for (const order of completed) {
      const number = String(order.order_number || '');
      if (!number) continue;
      const data = await getJson(`/api/demo-review?order=${encodeURIComponent(number)}`);
      if (data && !data.review) return order;
    }
    return null;
  }

  function reviewTip(order) {
    return `<div class="card cc-personal-tip hc-smart-tip"><span class="cc-tip-icon">★</span><div><strong>Как прошла уборка?</strong><p>Оцените работу команды — это займёт меньше минуты.</p></div><button type="button" data-smart-review>Оставить отзыв</button></div>`;
  }

  function benefitTip(percent) {
    return `<div class="card cc-personal-tip hc-smart-tip"><span class="cc-tip-icon">%</span><div><strong>У вас доступна скидка ${percent}%</strong><p>Она автоматически применится к следующей подходящей заявке.</p></div><button type="button" data-smart-order>Заказать со скидкой</button></div>`;
  }

  async function decorate() {
    if (running) return;
    const home = root.querySelector('.cc-home');
    const current = root.querySelector('.cc-personal-tip');
    if (!home || !current || current.dataset.smartProcessed === '1') return;
    running = true;
    try {
      const [ordersData, benefitsData] = await Promise.all([
        getJson('/api/demo-client-orders'),
        getJson('/api/client-benefits'),
      ]);
      if (!root.contains(current)) return;
      const unreviewed = await findUnreviewedCompleted(ordersData?.orders || []);
      if (!root.contains(current)) return;

      if (unreviewed) {
        current.outerHTML = reviewTip(unreviewed);
        const button = root.querySelector('[data-smart-review]');
        button?.addEventListener('click', () => {
          const url = new URL(window.location.href);
          url.searchParams.set('review', unreviewed.order_number);
          url.searchParams.set('demo', '1');
          window.location.href = url.toString();
        });
        return;
      }

      const referral = Math.max(0, Number(benefitsData?.referral_percent || 0));
      if (referral > 0) {
        current.outerHTML = benefitTip(referral);
        root.querySelector('[data-smart-order]')?.addEventListener('click', () => root.querySelector('[data-new-order]')?.click());
        return;
      }

      current.dataset.smartProcessed = '1';
    } finally {
      running = false;
    }
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(); });
  }).observe(root, { childList: true, subtree: true });

  decorate();
})();
