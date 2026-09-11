(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function keepServiceSearchVisible() {
    const search = document.getElementById('kpServiceSearch');
    if (!search || search.dataset.keyboardVisibilityFix === '1') return Boolean(search);
    search.dataset.keyboardVisibilityFix = '1';

    const bringIntoView = () => {
      const wrap = search.closest('.kp-service-search-wrap') || search;
      try {
        wrap.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      } catch {
        try { wrap.scrollIntoView(false); } catch {}
      }
    };

    search.addEventListener('focus', () => {
      // Telegram/iOS adds its own input accessory bar above the keyboard.
      // Re-center only this field after the keyboard has had time to open.
      setTimeout(bringIntoView, 180);
      setTimeout(bringIntoView, 420);
    });

    search.addEventListener('input', () => {
      if (document.activeElement === search) setTimeout(bringIntoView, 40);
    });

    return true;
  }

  async function install() {
    for (let i = 0; i < 160 && !document.getElementById('kpServiceSearch'); i += 1) await sleep(25);
    keepServiceSearchVisible();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once: true });
  } else {
    install().catch(console.error);
  }
})();
