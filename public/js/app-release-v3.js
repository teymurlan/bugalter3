const params = new URLSearchParams(window.location.search);
const adminMode = params.get('admin') === '1';
const staffMode = params.get('staff') === '1';
const tg = window.Telegram?.WebApp;

function ensureStyle(id, href) {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadSpecialStyles() {
  ensureStyle('hc-admin-mobile-style', '/admin-mobile-v1.css?v=44');
  if (staffMode) ensureStyle('hc-staff-style', '/staff-v1.css?v=44');
}

function configureLightApp() {
  try {
    tg?.ready?.();
    tg?.expand?.();
    tg?.setHeaderColor?.('#f6f8fb');
    tg?.setBackgroundColor?.('#f6f8fb');
    tg?.setBottomBarColor?.('#ffffff');
    tg?.disableVerticalSwipes?.();
  } catch {}
}

function showFatal(error) {
  const root = document.querySelector('#app');
  if (!root) return;
  root.innerHTML = '<div class="hc-staff-error"><h2>Не удалось открыть приложение</h2><p data-error-message></p><button type="button" data-retry>Повторить</button></div>';
  const message = root.querySelector('[data-error-message]');
  if (message) message.textContent = String(error?.message || 'Попробуйте ещё раз');
  root.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
}

async function startSpecialMode() {
  const root = document.querySelector('#app');
  const nav = document.querySelector('#bottom-nav');
  if (!root) return;
  nav?.classList.add('hidden');
  loadSpecialStyles();
  configureLightApp();
  if (adminMode) {
    const [{ renderAdmin }, { installAdminPolish }] = await Promise.all([
      import('./views/admin-v6.js?v=44'),
      import('./admin-v6-polish.js?v=44'),
    ]);
    await renderAdmin(root, () => {});
    installAdminPolish(root);
    return;
  }
  const { renderStaffPortal } = await import('./views/staff-v1.js?v=44');
  return renderStaffPortal(root);
}

if (adminMode || staffMode) {
  startSpecialMode().catch(showFatal);
} else {
  import('./app-release-v2.js?v=51');
}
