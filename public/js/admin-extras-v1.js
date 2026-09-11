(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') !== '1') return;
  const root = document.querySelector('#app');
  if (!root) return;

  let extraSection = '';
  let reviewFilter = 'all';
  let reviews = [];
  let referrals = [];
  let orders = [];

  function headers() {
    return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
  }

  async function getJson(path) {
    const response = await fetch(path, { headers: headers() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`);
    return data;
  }

  function toast(text, error = false) {
    const node = document.querySelector('#toast');
    if (!node) return;
    node.textContent = text;
    node.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.className = 'toast'; }, 2500);
  }

  function setHeader(title, subtitle) {
    const header = root.querySelector('.ops-header');
    if (!header) return;
    const h1 = header.querySelector('h1');
    const p = header.querySelector('p');
    if (h1) h1.textContent = title;
    if (p) p.textContent = subtitle;
  }

  function injectNav() {
    const nav = root.querySelector('.ops-nav');
    if (!nav) return;
    if (!nav.querySelector('[data-admin-extra="reviews"]')) {
      const reviewsButton = document.createElement('button');
      reviewsButton.type = 'button';
      reviewsButton.dataset.adminExtra = 'reviews';
      reviewsButton.innerHTML = '<span>★</span><small>Отзывы</small>';
      nav.appendChild(reviewsButton);
      reviewsButton.onclick = () => openExtra('reviews');
    }
    if (!nav.querySelector('[data-admin-extra="referrals"]')) {
      const referralsButton = document.createElement('button');
      referralsButton.type = 'button';
      referralsButton.dataset.adminExtra = 'referrals';
      referralsButton.innerHTML = '<span>↗</span><small>Рефералы</small>';
      nav.appendChild(referralsButton);
      referralsButton.onclick = () => openExtra('referrals');
    }
    nav.querySelectorAll('[data-admin-section]').forEach((button) => {
      if (button.dataset.extraBound) return;
      button.dataset.extraBound = '1';
      button.addEventListener('click', () => { extraSection = ''; });
    });
    updateNavState();
  }

  function updateNavState() {
    const nav = root.querySelector('.ops-nav');
    if (!nav) return;
    nav.querySelectorAll('button').forEach((button) => {
      if (button.dataset.adminExtra) button.classList.toggle('active', button.dataset.adminExtra === extraSection);
      else if (extraSection) button.classList.remove('active');
    });
  }

  async function openExtra(name) {
    extraSection = name;
    updateNavState();
    const content = root.querySelector('.ops-content');
    if (!content) return;
    content.innerHTML = '<div class="loading"><div><div class="spinner"></div>Загружаем данные...</div></div>';
    try {
      if (name === 'reviews') {
        setHeader('Отзывы', 'Оценки клиентов после завершённых уборок.');
        const data = await getJson('/api/demo-admin-reviews');
        reviews = Array.isArray(data.reviews) ? data.reviews : [];
        drawReviews(content);
      } else {
        setHeader('Рефералы', 'Кто кого пригласил и на каком этапе находится рекомендация.');
        const data = await getJson('/api/demo-admin-referrals');
        referrals = Array.isArray(data.referrals) ? data.referrals : [];
        drawReferrals(content);
      }
    } catch (error) {
      content.innerHTML = `<div class="ops-empty card"><strong>Не удалось загрузить раздел</strong><span>${escapeHtml(error.message || 'Ошибка')}</span></div>`;
    }
  }

  function drawReviews(content) {
    const visible = reviewFilter === 'all' ? reviews : reviews.filter((item) => Number(item.rating) === Number(reviewFilter));
    const average = reviews.length ? (reviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / reviews.length).toFixed(1) : '—';
    content.innerHTML = `
      <section class="ops-extra-stats">
        <div><span>Всего отзывов</span><strong>${reviews.length}</strong></div>
        <div><span>Средняя оценка</span><strong>${average}${average !== '—' ? ' ★' : ''}</strong></div>
        <div><span>5 звёзд</span><strong>${reviews.filter((item) => Number(item.rating) === 5).length}</strong></div>
      </section>
      <div class="ops-review-filters">${['all',5,4,3,2,1].map((value) => `<button type="button" class="${String(reviewFilter) === String(value) ? 'active' : ''}" data-review-filter="${value}">${value === 'all' ? 'Все' : `${value}★`}</button>`).join('')}</div>
      <div class="ops-review-list">${visible.length ? visible.map(reviewCard).join('') : '<div class="ops-empty card"><strong>Отзывов по этому фильтру нет</strong></div>'}</div>`;
    content.querySelectorAll('[data-review-filter]').forEach((button) => button.onclick = () => {
      reviewFilter = button.dataset.reviewFilter;
      drawReviews(content);
    });
    loadReviewPhotos(content);
  }

  function reviewCard(review) {
    const rating = Math.max(1, Math.min(5, Number(review.rating || 0)));
    const count = Array.isArray(review.photo_file_ids) ? review.photo_file_ids.length : 0;
    return `<article class="card ops-review-card">
      <div class="ops-review-head"><div><strong>${'★'.repeat(rating)}<span>${'★'.repeat(5-rating)}</span></strong><small>${escapeHtml(formatDateTime(review.created_at))}</small></div><b>${rating}/5</b></div>
      <div class="ops-review-client"><strong>${escapeHtml(review.customer_name || 'Клиент')}</strong><span>${escapeHtml(review.order_number || '')}</span></div>
      ${review.text ? `<p>${escapeHtml(review.text)}</p>` : '<p class="muted">Без текстового комментария</p>'}
      ${count ? `<div class="ops-review-photos">${Array.from({length:count},(_,index)=>`<button type="button" class="loading" data-review-photo data-user="${escapeHtml(review.client_telegram_id)}" data-order="${escapeHtml(review.order_number)}" data-index="${index}"><span>${index+1}</span></button>`).join('')}</div>` : ''}
    </article>`;
  }

  async function loadReviewPhotos(content) {
    const buttons = [...content.querySelectorAll('[data-review-photo]')];
    await Promise.all(buttons.map(async (button) => {
      try {
        const q = new URLSearchParams({ user: button.dataset.user, order: button.dataset.order, index: button.dataset.index });
        const response = await fetch(`/api/demo-admin-review-photo?${q}`, { headers: headers() });
        if (!response.ok) throw new Error();
        const url = URL.createObjectURL(await response.blob());
        button.classList.remove('loading');
        button.innerHTML = `<img src="${url}" alt="Фото к отзыву">`;
        button.onclick = () => openPhoto(url);
      } catch {
        button.classList.remove('loading');
        button.classList.add('error');
        button.textContent = 'Нет фото';
      }
    }));
  }

  function drawReferrals(content) {
    const ordered = referrals.filter((item) => item.order_created).length;
    const completed = referrals.filter((item) => item.completed).length;
    const rewarded = referrals.filter((item) => item.inviter_rewarded).length;
    content.innerHTML = `
      <section class="ops-extra-stats four">
        <div><span>Приглашено</span><strong>${referrals.length}</strong></div>
        <div><span>Оформили</span><strong>${ordered}</strong></div>
        <div><span>Завершили</span><strong>${completed}</strong></div>
        <div><span>Награждено</span><strong>${rewarded}</strong></div>
      </section>
      <div class="ops-ref-list">${referrals.length ? referrals.map(referralCard).join('') : '<div class="ops-empty card"><strong>Приглашений пока нет</strong></div>'}</div>`;
  }

  function referralCard(item) {
    const steps = [
      ['Перешёл по ссылке', true],
      ['Оформил заявку', item.order_created],
      ['Заявка подтверждена', item.order_confirmed],
      ['Уборка завершена', item.completed],
      ['15% начислены пригласившему', item.inviter_rewarded],
    ];
    return `<article class="card ops-ref-card">
      <div class="ops-ref-people"><div><span>Пригласил</span><strong>${escapeHtml(item.inviter_name || `ID ${item.inviter_id}`)}</strong></div><b>→</b><div><span>Друг</span><strong>${escapeHtml(item.friend_name || `ID ${item.friend_id}`)}</strong></div></div>
      <div class="ops-ref-date">${escapeHtml(formatDateTime(item.registered_at))}</div>
      <div class="ops-ref-steps">${steps.map(([label,done])=>`<div class="${done?'done':''}"><i>${done?'✓':'·'}</i><span>${escapeHtml(label)}</span></div>`).join('')}</div>
      <div class="ops-ref-foot"><span>Доступно наград у пригласившего</span><strong>${Number(item.inviter_rewards_available || 0)} × 15%</strong></div>
    </article>`;
  }

  async function decorateDiscounts() {
    const cards = [...root.querySelectorAll('.ops-order-card')];
    if (!cards.length) return;
    if (!orders.length) {
      try { orders = (await getJson('/api/demo-admin-orders')).orders || []; } catch { return; }
    }
    cards.forEach((card) => {
      if (card.querySelector('[data-admin-discount]')) return;
      const number = String(card.querySelector('.ops-order-head span')?.textContent || '').trim();
      const order = orders.find((item) => String(item.order_number) === number);
      const percent = Number(order?.discount_percent || 0);
      if (!percent) return;
      const line = document.createElement('div');
      line.dataset.adminDiscount = '1';
      line.className = 'ops-order-discount';
      const type = order.discount_type === 'loyalty' ? 'Лояльность' : order.discount_type === 'referral_friend' ? 'Друг пригласил' : 'Реферальная';
      line.innerHTML = `<span>Скидка</span><strong>${escapeHtml(type)} · ${percent}%</strong>`;
      card.querySelector('.ops-order-line')?.insertAdjacentElement('beforebegin', line);
    });
  }

  function openPhoto(url) {
    const overlay = document.createElement('div');
    overlay.className = 'admin-lightbox';
    overlay.innerHTML = `<div class="admin-lightbox-top"><button type="button">×</button></div><div class="admin-lightbox-stage"><img src="${url}" alt="Фото к отзыву"></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('button').onclick = () => overlay.remove();
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
  }

  function formatDateTime(value) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(date).replace(',', ' ·');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char] || char));
  }

  let queued = false;
  function scan() {
    injectNav();
    if (!extraSection) decorateDiscounts();
  }
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }).observe(root, { childList: true, subtree: true });

  scan();
})();
