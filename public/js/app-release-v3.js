const params = new URLSearchParams(window.location.search);
const adminMode = params.get('admin') === '1';
const staffMode = params.get('staff') === '1';
const tg = window.Telegram?.WebApp;

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

async function startSpecialMode() {
  const root = document.querySelector('#app');
  const nav = document.querySelector('#bottom-nav');
  if (!root) return;
  nav?.classList.add('hidden');
  configureLightApp();
  if (adminMode) {
    const { renderAdmin } = await import('./views/admin-v6.js?v=36');
    return renderAdmin(root, () => {});
  }
  const { renderStaffPortal } = await import('./views/staff-v1.js?v=36');
  return renderStaffPortal(root);
}

if (adminMode || staffMode) {
  startSpecialMode().catch((error) => {
    const root = document.querySelector('#app');
    if (root) root.innerHTML = `<div class="hc-staff-error"><h2>Не удалось открыть приложение</h2><p>${String(error?.message || 'Попробуйте ещё раз')}</p><button onclick="location.reload()">Повторить</button></div>`;
  });
} else {
  import('./app-release-v2.js?v=35');
}
