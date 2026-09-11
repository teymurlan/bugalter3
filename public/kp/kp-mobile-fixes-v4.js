(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function parseNumber(value) {
    const match = String(value ?? '').match(/\d+/);
    return match ? Math.max(1, Math.floor(Number(match[0]) || 0)) : 0;
  }

  function syncFreshOutgoingNumber() {
    const outgoing = document.getElementById('outgoingNumber');
    const defaultNumber = parseNumber(state?.bootstrap?.defaults?.quote_number);
    if (!outgoing || !defaultNumber || state?.currentId) return;

    // Если в localStorage остался незавершённый тестовый черновик со старым
    // номером, сохраняем все введённые данные, но берём свежий серверный номер.
    const current = parseNumber(outgoing.value);
    if (current !== defaultNumber) {
      outgoing.value = String(defaultNumber);
      const badge = document.getElementById('quoteNumberBadge');
      if (badge) badge.textContent = `Исх. № ${defaultNumber}`;
      state.currentNumber = `Исх. № ${defaultNumber}`;
      state.lastSaved = null;
      outgoing.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

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
      // Telegram/iOS добавляет свою панель «Готово» над клавиатурой.
      // После открытия клавиатуры поднимаем только поле услуги в безопасную зону.
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
    for (let i = 0; i < 120 && !state?.bootstrap; i += 1) await sleep(25);
    syncFreshOutgoingNumber();
    keepServiceSearchVisible();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once: true });
  } else {
    install().catch(console.error);
  }
})();
