import { api } from './api.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { renderBooking } from './views/booking.js';
import { renderOrders } from './views/orders.js';
import { renderProfile } from './views/profile.js';

const tg = window.Telegram?.WebApp;
const root = document.querySelector('#app');
const nav = document.querySelector('#bottom-nav');

function configureTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.('#05090c');
  tg.setBackgroundColor?.('#05090c');
  tg.setBottomBarColor?.('#070c10');
  tg.disableVerticalSwipes?.();
}

function setActiveNav(route) {
  nav.querySelectorAll('[data-route]').forEach((button) => button.classList.toggle('active', button.dataset.route === route));
}

export function navigate(route, params = {}) {
  state.route = route;
  setActiveNav(route);
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (route === 'orders') return renderOrders(root, navigate, params);
  if (route === 'profile') return renderProfile(root, navigate);
  return renderBooking(root, navigate);
}

async function start() {
  configureTelegram();
  root.innerHTML = `<div class="loading"><div><div class="spinner"></div>Загружаем HOUSE CLEANING...</div></div>`;

  if (!tg?.initData) {
    root.innerHTML = `<section class="hero"><div class="brand"><div class="brand-mark">HC</div><div><div class="brand-title">HOUSE CLEANING</div><div class="brand-sub">Уборка квартир и домов</div></div></div><div class="hero-copy"><h1>Откройте в Telegram</h1><p>Это приложение использует безопасную авторизацию Telegram Mini App.</p></div></section><div class="card pad"><p class="page-subtitle">Откройте приложение через кнопку в боте HOUSE CLEANING. В обычном браузере авторизация отключена.</p></div>`;
    return;
  }

  try {
    state.bootstrap = await api.bootstrap();
    await state.restorePhotos();
    nav.classList.remove('hidden');
    nav.querySelectorAll('[data-route]').forEach((button) => button.onclick = () => navigate(button.dataset.route));

    const startParam = tg.initDataUnsafe?.start_param || '';
    if (startParam.startsWith('order_')) {
      const orderId = Number(startParam.slice(6));
      if (Number.isInteger(orderId)) return navigate('orders', { orderId });
    }
    navigate('booking');
  } catch (error) {
    root.innerHTML = `<div class="card pad" style="margin-top:60px"><h2>Не удалось открыть приложение</h2><p class="page-subtitle">${escapeHtml(error.message || 'Ошибка авторизации')}</p><button class="primary-btn" onclick="location.reload()">Попробовать снова</button></div>`;
  }
}

start();
