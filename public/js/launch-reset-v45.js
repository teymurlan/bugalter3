(() => {
  const GENERATION = 'v45-clean-launch';
  const KEY = 'hc-clean-start-generation';
  try {
    const current = localStorage.getItem(KEY);
    if (current === GENERATION) return;

    // Older builds left this marker as "pending" forever. That caused the
    // whole local draft to be erased every time Telegram reopened the Mini App.
    // Treat an existing pending marker as an already completed one-time reset.
    if (current === 'pending') {
      localStorage.setItem(KEY, GENERATION);
      return;
    }

    localStorage.clear();
    localStorage.setItem(KEY, GENERATION);
    window.__HC_CLEAN_START_PENDING = true;
    if ('indexedDB' in window) {
      try { indexedDB.deleteDatabase('house-cleaning-mini-app'); } catch {}
    }
  } catch {}
})();
