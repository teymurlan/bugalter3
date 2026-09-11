(() => {
  const root = document.querySelector('#app');
  if (!root) return;

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function polish() {
    const profile = root.querySelector('.cc-profile-page');
    if (!profile || profile.dataset.profilePolished === '1') return;

    // Mark before touching child nodes so our own DOM updates cannot
    // trigger an endless MutationObserver loop in Telegram WebView.
    profile.dataset.profilePolished = '1';

    const meta = profile.querySelector('.cc-profile-copy span');
    if (meta && /·\s*ID\s*/i.test(meta.textContent || '')) {
      const next = String(meta.textContent || '')
        .replace(/\s*·\s*ID\s*\d+\s*$/i, '')
        .trim() || 'Telegram';
      setText(meta, next);
    }

    setText(
      profile.querySelector('.cc-profile-note span'),
      'История, скидки и помощь менеджера — всё в одном месте',
    );

    const help = profile.querySelector('[data-menu="help"]');
    if (help) {
      setText(help.querySelector('strong'), 'Связаться с менеджером');
      setText(help.querySelector('small'), 'Вопрос по заявке, услуге или абонементу');
    }
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      polish();
    });
  });

  observer.observe(root, { childList: true, subtree: true });
  polish();
})();
