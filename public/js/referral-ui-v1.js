(() => {
  const root = document.querySelector('#app');
  if (!root) return;

  function headers() {
    return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
  }

  async function loadStats() {
    try {
      const response = await fetch('/api/referral', { headers: headers() });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  async function decorate() {
    const hero = root.querySelector('.cc-referral-hero');
    const code = root.querySelector('.cc-ref-code');
    if (!hero || !code || root.querySelector('[data-ref-live]')) return;

    const stats = await loadStats();
    if (!stats || !root.contains(hero) || root.querySelector('[data-ref-live]')) return;

    const wrap = document.createElement('section');
    wrap.dataset.refLive = '1';
    wrap.className = 'card cc-ref-live';
    const available = Number(stats.available_rewards || 0);
    const friendDiscount = Number(stats.friend_discount_percent || 0);
    wrap.innerHTML = `
      <div class="cc-ref-live-grid">
        <div><strong>${Number(stats.invited_count || 0)}</strong><span>приглашено</span></div>
        <div><strong>${Number(stats.completed_friends || 0)}</strong><span>завершили уборку</span></div>
        <div><strong>${available}</strong><span>наград доступно</span></div>
      </div>
      ${friendDiscount > 0 ? '<div class="cc-ref-live-note"><b>15% на первую уборку</b><span>Вы пришли по рекомендации. Менеджер учтёт скидку при подтверждении.</span></div>' : ''}
      ${available > 0 ? `<div class="cc-ref-live-note"><b>${available > 1 ? `${available} скидки по 15%` : 'Скидка 15% доступна'}</b><span>Она учитывается менеджером на следующей подходящей уборке.</span></div>` : ''}`;
    code.insertAdjacentElement('afterend', wrap);
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