(() => {
  const GENERATION = 'v66-final-launch';
  const KEY = 'hc-clean-start-generation';
  const DRAFT_KEY = 'hc-booking-draft-v2';
  try {
    const current = localStorage.getItem(KEY);
    if (current === GENERATION) return;

    // Final pre-launch cleanup: remove only unfinished booking data.
    // Keep theme, notification preferences and other client UI settings.
    localStorage.removeItem(DRAFT_KEY);
    localStorage.setItem(KEY, GENERATION);
    window.__HC_CLEAN_START_PENDING = true;

    if ('indexedDB' in window) {
      try { indexedDB.deleteDatabase('house-cleaning-mini-app'); } catch {}
    }
  } catch {}
})();
