import { renderConciergeHome as renderBaseHome } from './concierge-home-v2.js?v=29';
import { state } from '../state.js';
import { showToast } from '../utils.js';

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

  const username = String(state.bootstrap?.config?.managerUsername || '').replace(/^@/, '');
  if (!username) return showToast('Контакт менеджера пока не настроен', true);
  const url = `https://t.me/${username}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

export async function renderConciergeHome(root, navigate) {
  await renderBaseHome(root, navigate);
  const button = root.querySelector('[data-manager]');
  if (button) button.onclick = openDirectManager;
}
