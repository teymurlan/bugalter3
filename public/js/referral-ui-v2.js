(() => {
  const root = document.querySelector('#app');
  if (!root) return;
  let linkCache = '';
  let statsCache = null;

  function headers() {
    return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
  }

  async function getJson(path) {
    const response = await fetch(path, { headers: headers() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`);
    return data;
  }

  async function load() {
    const [linkResult, statsResult] = await Promise.allSettled([
      linkCache ? Promise.resolve({ link: linkCache }) : getJson('/api/referral-link'),
      statsCache ? Promise.resolve(statsCache) : getJson('/api/referral-dashboard'),
    ]);
    if (linkResult.status === 'fulfilled') linkCache = String(linkResult.value?.link || linkCache || '');
    if (statsResult.status === 'fulfilled') statsCache = statsResult.value;
    return { link: linkCache, stats: statsCache };
  }

  function toast(text, error = false) {
    const node = document.querySelector('#toast');
    if (!node) return;
    node.textContent = text;
    node.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.className = 'toast'; }, 2600);
  }

  async function share() {
    if (!linkCache) await load();
    if (!linkCache) return toast('Не удалось подготовить ссылку', true);
    const text = [
      '🏠 HOUSE CLEANING',
      '',
      'Хочу порекомендовать тебе сервис уборки, которым пользуюсь сам.',
      '',
      'По моей персональной ссылке ты получишь скидку 15% на первую уборку.',
      '',
      'Выбрать услугу и оформить заявку можно прямо в Telegram 👇',
    ].join('\n');
    const url = `https://t.me/share/url?url=${encodeURIComponent(linkCache)}&text=${encodeURIComponent(text)}`;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, '_blank');
  }

  async function copyLink() {
    if (!linkCache) await load();
    if (!linkCache) return toast('Не удалось подготовить ссылку', true);
    try {
      await navigator.clipboard.writeText(linkCache);
      toast('Ссылка скопирована');
    } catch {
      toast('Не удалось скопировать ссылку', true);
    }
  }

  function statsCard(stats) {
    if (!stats) return '';
    const available = Number(stats.available_rewards || 0);
    return `<section class="card cc-ref-v2-stats" data-ref-v2-stats>
      <div><strong>${Number(stats.invited_count || 0)}</strong><span>Приглашено</span></div>
      <div><strong>${Number(stats.ordered_friends || 0)}</strong><span>Оформили уборку</span></div>
      <div><strong>${Number(stats.completed_friends || 0)}</strong><span>Успешно завершили</span></div>
      <div><strong>${available}</strong><span>Доступно скидок 15%</span></div>
    </section>`;
  }

  async function decorate() {
    const hero = root.querySelector('.cc-referral-hero');
    const actions = root.querySelector('.cc-ref-actions');
    if (!hero || !actions || root.querySelector('[data-ref-v2-ready]')) return;

    const marker = document.createElement('i');
    marker.dataset.refV2Ready = '1';
    marker.hidden = true;
    hero.appendChild(marker);

    root.querySelector('.cc-ref-code')?.remove();
    root.querySelector('[data-ref-live]')?.remove();

    hero.innerHTML = `<i data-ref-v2-ready hidden></i><span class="cc-referral-badge">15% + 15%</span><h2>Приглашайте друзей</h2><p>Друг получит 15% на первую уборку. После её успешного завершения вы получите 15% на следующую уборку.</p>`;

    const shareButton = actions.querySelector('[data-share]');
    const copyButton = actions.querySelector('[data-copy]');
    if (shareButton) {
      const clone = shareButton.cloneNode(true);
      clone.textContent = 'Поделиться приглашением';
      shareButton.replaceWith(clone);
      clone.onclick = share;
    }
    if (copyButton) {
      const clone = copyButton.cloneNode(true);
      clone.textContent = 'Скопировать ссылку';
      copyButton.replaceWith(clone);
      clone.onclick = copyLink;
    }

    const policy = root.querySelector('.cc-policy-note');
    if (policy) policy.innerHTML = '<strong>Как это работает:</strong> мы учитываем только успешно завершённую уборку друга. Отменённая заявка не приносит награду и не сжигает его скидку.';

    const data = await load();
    if (!root.contains(hero)) return;
    if (!root.querySelector('[data-ref-v2-stats]')) hero.insertAdjacentHTML('afterend', statsCard(data.stats));
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(); });
  }).observe(root, { childList: true, subtree: true });

  decorate();
})();
