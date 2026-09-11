(() => {
  const root = document.querySelector('#app');
  if (!root) return;

  function polish() {
    const profile = root.querySelector('.cc-profile-page');
    if (!profile) return;
    const meta = profile.querySelector('.cc-profile-copy span');
    if (meta && /·\s*ID\s*/i.test(meta.textContent || '')) {
      meta.textContent = String(meta.textContent || '').replace(/\s*·\s*ID\s*\d+\s*$/i, '').trim() || 'Telegram';
    }
    const note = profile.querySelector('.cc-profile-note span');
    if (note) note.textContent = 'История, скидки и помощь менеджера — всё в одном месте';
    const help = profile.querySelector('[data-menu="help"]');
    if (help) {
      const title = help.querySelector('strong');
      const subtitle = help.querySelector('small');
      if (title) title.textContent = 'Связаться с менеджером';
      if (subtitle) subtitle.textContent = 'Вопрос по заявке, услуге или абонементу';
    }
  }

  new MutationObserver(polish).observe(root, { childList: true, subtree: true });
  polish();
})();
