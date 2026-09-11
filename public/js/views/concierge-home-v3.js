import { renderConciergeHome as renderBaseHome } from './concierge-home-v2.js?v=29';

function headers() {
  return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
}

async function openDirectManager() {
  try {
    const response = await fetch('/api/manager-contact', { headers: headers() });
    if (response.ok) {
      const data = await response.json();
      const id = Number(data?.telegram_id || 0);
      if (id) {
        window.location.href = `tg://user?id=${id}`;
        return;
      }
    }
  } catch {}
}

export async function renderConciergeHome(root, navigate) {
  await renderBaseHome(root, navigate);
  const button = root.querySelector('[data-manager]');
  if (button) button.onclick = openDirectManager;
}
