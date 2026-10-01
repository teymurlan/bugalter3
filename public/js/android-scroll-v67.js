(() => {
  const tg = window.Telegram?.WebApp;
  const platform = String(tg?.platform || '').toLowerCase();
  const ua = String(navigator.userAgent || '');
  const isAndroid = platform === 'android' || /android/i.test(ua);
  if (!isAndroid) return;

  const root = document.documentElement;
  root.classList.add('hc-android-scroll');

  const apply = () => {
    try { tg?.enableVerticalSwipes?.(); } catch {}
    try {
      root.style.setProperty('overflow-y', 'auto', 'important');
      root.style.setProperty('height', 'auto', 'important');
      root.style.setProperty('touch-action', 'pan-y', 'important');
      document.body?.style.setProperty('overflow-y', 'auto', 'important');
      document.body?.style.setProperty('height', 'auto', 'important');
      document.body?.style.setProperty('touch-action', 'pan-y', 'important');
      document.body?.style.setProperty('position', 'relative', 'important');
    } catch {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }

  window.addEventListener('hc:route-rendered', apply);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) apply();
  });
  try { tg?.onEvent?.('viewportChanged', apply); } catch {}

  setTimeout(apply, 250);
  setTimeout(apply, 1200);
})();
