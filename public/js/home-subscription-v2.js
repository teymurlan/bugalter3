(() => {
  const root = document.querySelector('#app');
  if (!root) return;
  let queued = false;

  const visual = `
    <div class="hc-subscription-visual" aria-hidden="true">
      <svg viewBox="0 0 220 150" role="img">
        <defs>
          <linearGradient id="passGold" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#f7da85"/>
            <stop offset="1" stop-color="#c99a36"/>
          </linearGradient>
          <linearGradient id="passDark" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#18242b"/>
            <stop offset="1" stop-color="#0a1116"/>
          </linearGradient>
        </defs>
        <circle cx="170" cy="28" r="34" fill="#f2c85f" opacity=".08"/>
        <rect x="42" y="34" width="120" height="82" rx="19" fill="url(#passDark)" stroke="#4c4431"/>
        <rect x="58" y="50" width="120" height="82" rx="19" fill="url(#passDark)" stroke="#665634"/>
        <rect x="73" y="66" width="120" height="70" rx="18" fill="url(#passGold)" opacity=".96"/>
        <text x="92" y="91" fill="#16120a" font-size="13" font-family="-apple-system,BlinkMacSystemFont,Arial" font-weight="800">HOUSE CLEANING</text>
        <text x="92" y="113" fill="#16120a" font-size="24" font-family="-apple-system,BlinkMacSystemFont,Arial" font-weight="900">5 / 10</text>
        <path d="M37 24l4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8Z" fill="#f7d879"/>
        <path d="M188 35l2.8 5.6 5.6 2.8-5.6 2.8-2.8 5.6-2.8-5.6-5.6-2.8 5.6-2.8 2.8-5.6Z" fill="#f7d879" opacity=".9"/>
      </svg>
    </div>`;

  function upgrade() {
    const banner = root.querySelector('[data-subscription-banner]');
    if (!banner || banner.dataset.subscriptionV2 === '1') return;
    const button = banner.querySelector('[data-open-subscriptions]');
    banner.dataset.subscriptionV2 = '1';
    banner.classList.add('hc-subscription-banner-v2');
    banner.innerHTML = `
      <div class="hc-subscription-copy">
        <div class="hc-subscription-badge">АБОНЕМЕНТЫ 5 / 10 УБОРОК</div>
        <h3>Регулярная уборка без повторных оформлений</h3>
        <p>Заранее согласуйте график и выберите удобный формат на 5 или 10 уборок. Менеджер подберёт подходящий вариант.</p>
        <div data-subscription-action></div>
      </div>
      ${visual}`;
    if (button) {
      button.textContent = 'Подробнее об абонементах';
      const slot = banner.querySelector('[data-subscription-action]');
      slot?.replaceWith(button);
    }
    const target = root.querySelector('.cc-for-you-section');
    if (target && banner.nextElementSibling !== target) target.insertAdjacentElement('beforebegin', banner);
  }

  function queue() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      upgrade();
    });
  }

  new MutationObserver(queue).observe(root, { childList: true, subtree: false });
  queue();
})();
