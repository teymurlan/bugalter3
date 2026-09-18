(() => {
  const params = new URLSearchParams(location.search);
  const mode = params.get('admin') === '1' ? 'admin' : params.get('staff') === '1' ? 'staff' : 'client';
  const key = `hc-ultra7-theme-${mode}`;
  const allowed = new Set(['light','dark','blue']);

  function fallback() {
    if (mode === 'admin') return 'light';
    try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
  }

  function read() {
    try {
      const saved = localStorage.getItem(key);
      return allowed.has(saved) ? saved : fallback();
    } catch { return fallback(); }
  }

  function palette(theme) {
    if (theme === 'dark') return { bg:'#0b1016', header:'#0b1016', bottom:'#121922' };
    if (theme === 'blue') return { bg:'#eef5ff', header:'#eef5ff', bottom:'#ffffff' };
    return { bg:'#f4f7fb', header:'#f4f7fb', bottom:'#ffffff' };
  }

  function apply(theme, persist = true) {
    const next = allowed.has(theme) ? theme : fallback();
    document.documentElement.dataset.hcTheme = next;
    if (document.body) document.body.dataset.hcTheme = next;
    if (persist) { try { localStorage.setItem(key, next); } catch {} }
    const p = palette(next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', p.header);
    try {
      const tg = window.Telegram?.WebApp;
      tg?.setHeaderColor?.(p.header);
      tg?.setBackgroundColor?.(p.bg);
      tg?.setBottomBarColor?.(p.bottom);
    } catch {}
    window.dispatchEvent(new CustomEvent('hc:theme', { detail: { theme: next, mode } }));
    return next;
  }

  const current = apply(read(), false);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply(current, false), { once:true });

  window.HCUltraTheme = {
    mode,
    get: () => document.documentElement.dataset.hcTheme || read(),
    set: (theme) => apply(theme, true),
    options: [
      { id:'light', label:'Светлая' },
      { id:'dark', label:'Тёмная' },
      { id:'blue', label:'Синяя' },
    ],
  };
})();