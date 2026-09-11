(() => {
  const root = document.querySelector('#app');
  if (!root) return;
  let running = false;
  const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);

  function headers() {
    return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
  }

  async function getJson(path) {
    const response = await fetch(path, { headers: headers() });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  function orderStamp(order) {
    if (!order?.date) return Number.POSITIVE_INFINITY;
    const time = String(order.time || '00:00').slice(0, 5);
    const stamp = Date.parse(`${order.date}T${time}:00+03:00`);
    return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY;
  }

  function nearestActive(orders) {
    const active = (orders || []).filter((item) => ACTIVE.has(item.status));
    return active.sort((a, b) => orderStamp(a) - orderStamp(b))[0] || null;
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

  function reviewTip() {
    return `<div class="card cc-personal-tip hc-smart-tip"><span class="cc-tip-icon">★</span><div><strong>Как прошла уборка?</strong><p>Оцените работу команды — это займёт меньше минуты.</p></div><button type="button" data-smart-review>Оставить отзыв</button></div>`;
  }

  function benefitTip(percent) {
    return `<div class="card cc-personal-tip hc-smart-tip"><span class="cc-tip-icon">%</span><div><strong>У вас доступна скидка ${percent}%</strong><p>Она автоматически применится к следующей подходящей заявке.</p></div><button type="button" data-smart-order>Заказать со скидкой</button></div>`;
  }

  function pendingTip() {
    return `<div class="card cc-personal-tip hc-smart-tip"><span class="cc-tip-icon">…</span><div><strong>Заявка на рассмотрении</strong><p>Менеджер проверит детали и подтвердит заявку. Все данные уже сохранены.</p></div><button type="button" data-smart-open>Посмотреть заявку</button></div>`;
  }

  function progressTip() {
    return `<div class="card cc-personal-tip hc-smart-tip"><span class="cc-tip-icon">✓</span><div><strong>Уборка выполняется</strong><p>Текущий статус и детали заказа доступны в заявке.</p></div><button type="button" data-smart-open>Открыть заявку</button></div>`;
  }

  function polishHeading(current) {
    const section = current?.closest('.cc-section');
    const head = section?.querySelector('.cc-section-head');
    const title = head?.querySelector('h2');
    const subtitle = head?.querySelector('span');
    if (title) title.textContent = 'Полезно сейчас';
    if (subtitle) subtitle.textContent = 'По текущей ситуации';
  }

  function bindOpen() {
    root.querySelector('[data-smart-open]')?.addEventListener('click', () => root.querySelector('.cc-next-card')?.click());
  }

  async function decorate() {
    if (running) return;
    const home = root.querySelector('.cc-home');
    const current = root.querySelector('.cc-personal-tip');
    if (!home || !current) return;
    polishHeading(current);
    if (current.dataset.smartProcessed === '1') return;

    running = true;
    try {
      const [ordersData, benefitsData] = await Promise.all([
        getJson('/api/demo-client-orders'),
        getJson('/api/client-benefits'),
      ]);
      if (!root.contains(current)) return;
      const orders = ordersData?.orders || [];
      const active = nearestActive(orders);

      if (active?.status === 'NEW' || active?.status === 'REVIEW') {
        current.outerHTML = pendingTip();
        bindOpen();
        return;
      }

      if (active?.status === 'IN_PROGRESS') {
        current.outerHTML = progressTip();
        bindOpen();
        return;
      }

      // Для подтверждённой ближайшей уборки сохраняем штатный полезный блок:
      // подготовка, оставшееся время и связь с менеджером важнее старых отзывов/скидок.
      if (active) {
        current.dataset.smartProcessed = '1';
        return;
      }

      const unreviewed = await findUnreviewedCompleted(orders);
      if (!root.contains(current)) return;
      if (unreviewed) {
        current.outerHTML = reviewTip();
        root.querySelector('[data-smart-review]')?.addEventListener('click', () => {
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
