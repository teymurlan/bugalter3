(() => {
  const hash = String(window.location.hash || '').replace(/^#/, '');
  const launch = new URLSearchParams(hash);
  const initData = launch.get('tgWebAppData') || '';

  function postEvent(eventType, eventData = {}) {
    try {
      if (window.TelegramWebviewProxy && typeof window.TelegramWebviewProxy.postEvent === 'function') {
        window.TelegramWebviewProxy.postEvent(eventType, JSON.stringify(eventData));
        return true;
      }
    } catch {}

    try {
      if (window.external && typeof window.external.notify === 'function') {
        window.external.notify(JSON.stringify({ eventType, eventData }));
        return true;
      }
    } catch {}

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(JSON.stringify({ eventType, eventData }), '*');
        return true;
      }
    } catch {}

    return false;
  }

  window.Telegram = window.Telegram || {};

  if (!window.Telegram.WebApp) {
    window.Telegram.WebApp = {
      initData,
      initDataUnsafe: {},
      version: launch.get('tgWebAppVersion') || '',
      platform: launch.get('tgWebAppPlatform') || '',
      ready() { postEvent('web_app_ready', {}); },
      expand() { postEvent('web_app_expand', {}); },
      setHeaderColor() {},
      setBackgroundColor() {},
    };
  } else if (!window.Telegram.WebApp.initData && initData) {
    try { window.Telegram.WebApp.initData = initData; } catch {}
  }

  try { window.Telegram.WebApp.ready(); } catch { postEvent('web_app_ready', {}); }
  try { window.Telegram.WebApp.expand(); } catch { postEvent('web_app_expand', {}); }

  window.__HC_KP_TELEGRAM_FALLBACK__ = { initDataAvailable: Boolean(initData), postEvent };
})();
