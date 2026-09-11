(() => {
  const root = document.querySelector('#app');
  if (!root) return;
  let benefits = null;
  let loading = null;

  function headers() {
    return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
  }

  async function loadBenefits(force = false) {
    if (benefits && !force) return benefits;
    if (loading) return loading;
    loading = fetch('/api/client-benefits', { headers: headers() })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        benefits = data?.ok === false ? null : data;
        window.HCBenefits = benefits;
        return benefits;
      })
      .catch(() => null)
      .finally(() => { loading = null; });
    return loading;
  }

  function selectedPercent() {
    return Math.max(0, Number(benefits?.selected_percent || 0));
  }

  function typeLabel() {
    if (benefits?.selected_type === 'loyalty') return 'Скидка по программе лояльности';
    if (benefits?.selected_type === 'referral_friend') return 'Скидка по приглашению друга';
    if (benefits?.selected_type === 'referral_reward') return 'Реферальная скидка';
    return 'Скидка';
  }

  function parseMoney(text) {
    const digits = String(text || '').replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  }

  function rub(value) {
    return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`;
  }

  function applyAmount(node, host) {
    const percent = selectedPercent();
    if (!node || !host || !percent) return;
    if (node.dataset.benefitFinal && node.textContent === node.dataset.benefitFinal) return;
    const before = parseMoney(node.textContent);
    if (!before) return;
    const amount = Math.round(before * percent / 100);
    const after = Math.max(0, before - amount);
    const finalText = `от ${rub(after)}`;
    node.dataset.benefitFinal = finalText;
    node.dataset.benefitBase = String(before);
    node.textContent = finalText;

    let line = host.querySelector(':scope > .hc-benefit-line');
    if (!line) {
      line = document.createElement('div');
      line.className = 'hc-benefit-line';
      host.appendChild(line);
    }
    line.innerHTML = `<div><span>До скидки</span><b>${rub(before)}</b></div><div><span>${escapeHtml(typeLabel())} ${percent}%</span><b>−${rub(amount)}</b></div>`;
  }

  function decoratePrices() {
    if (!benefits || !selectedPercent()) return;
    const estimateStrong = root.querySelector('.hc-estimate-top strong');
    if (estimateStrong) applyAmount(estimateStrong, estimateStrong.closest('.hc-estimate-card'));

    const reviewPrice = root.querySelector('.price-card .price');
    if (reviewPrice) applyAmount(reviewPrice, reviewPrice.closest('.price-card'));

    const calcPrice = root.querySelector('.cc-calc-total strong');
    if (calcPrice) applyAmount(calcPrice, calcPrice.closest('.cc-calc-total'));
  }

  async function decorateOrderDetail() {
    const head = root.querySelector('.cc-detail-head h1');
    if (!head || root.querySelector('[data-order-benefit]')) return;
    const number = String(head.textContent || '').trim();
    if (!/^HC-[A-Za-z0-9._-]+$/i.test(number)) return;
    try {
      const response = await fetch(`/api/demo-client-order?order=${encodeURIComponent(number)}`, { headers: headers() });
      if (!response.ok) return;
      const order = (await response.json())?.order;
      const percent = Number(order?.discount_percent || 0);
      const before = Number(order?.price_before_discount || 0);
      const after = Number(order?.estimated_price || 0);
      if (!percent || !before || !after) return;
      const amount = Number(order?.discount_amount || Math.max(0, before - after));
      const label = order.discount_type === 'loyalty' ? 'Лояльность' : order.discount_type === 'referral_friend' ? 'По приглашению друга' : 'Реферальная скидка';
      const card = document.createElement('div');
      card.dataset.orderBenefit = '1';
      card.className = 'card hc-order-benefit';
      card.innerHTML = `<div><span>Стоимость до скидки</span><strong>${rub(before)}</strong></div><div><span>${escapeHtml(label)} · ${percent}%</span><strong class="minus">−${rub(amount)}</strong></div><div class="total"><span>Предварительная стоимость</span><strong>от ${rub(after)}</strong></div>`;
      const anchor = root.querySelector('.cc-policy-note') || root.querySelector('.cc-gallery-title');
      anchor?.insertAdjacentElement('beforebegin', card);
    } catch { /* optional enhancement */ }
  }

  async function decorateProfileBenefit() {
    const loyalty = root.querySelector('.cc-loyalty-card');
    if (!loyalty || root.querySelector('[data-active-benefit]') || !benefits) return;
    const percent = selectedPercent();
    if (!percent) return;
    const note = document.createElement('div');
    note.dataset.activeBenefit = '1';
    note.className = 'hc-active-benefit';
    note.innerHTML = `<span>Сейчас выгоднее</span><strong>${escapeHtml(typeLabel())} · ${percent}%</strong>`;
    loyalty.insertAdjacentElement('afterend', note);
  }

  async function scan() {
    if (!benefits) await loadBenefits();
    decoratePrices();
    decorateOrderDetail();
    decorateProfileBenefit();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }).observe(root, { childList: true, subtree: true, characterData: true });

  loadBenefits().then(scan);
})();
