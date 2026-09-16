(() => {
  const GENERATION = 'v45-clean-launch';
  const KEY = 'hc-clean-start-generation';
  try {
    if (localStorage.getItem(KEY) === GENERATION) return;
    localStorage.clear();
    localStorage.setItem(KEY, 'pending');
    window.__HC_CLEAN_START_PENDING = true;
    if ('indexedDB' in window) {
      try { indexedDB.deleteDatabase('house-cleaning-mini-app'); } catch {}
    }
  } catch {}
})();
