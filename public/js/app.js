import { api, isDemoMode } from './api.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { renderBooking } from './views/booking-v2.js';
import { renderOrders } from './views/orders.js';
import { renderProfile } from './views/profile.js';
import { renderAdmin } from './views/admin.js';

const tg = window.Telegram?.WebApp;
const root = document.querySelector('#app');
const nav = document.querySelector('#bottom-nav');
const focusContext = document.querySelector('#focus-context');
const query = new URLSearchParams(window.location.search);
const adminMode = query.get('admin') === '1';

function configureTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.('#05090c');
  tg.setBackgroundColor?.('#05090c');
  tg.setBottomBarColor?.('#070c10');
  tg.disableVerticalSwipes?.();
}

function configureAdminNav() {
  if (!adminMode || nav.querySelector('[data-route="admin"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nav-item';
  button.dataset.route = 'admin';
  button.innerHTML = '<span class="nav-icon">◆</span><span>Админ</span>';
  nav.appendChild(button);
  nav.classList.add('four-items');
}

function configureFocusContext() {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    if (target.type === 'file' || target.type === 'range') return;
    const label = target.dataset.label
      || target.closest('.field')?.querySelector('label')?.textContent?.trim()
      || target.getAttribute('aria-label')
      || '';
    if (!label) return;
    focusContext.textContent = `Сейчас вводите: ${label}`;
    focusContext.classList.remove('hidden');
    requestAnimationFrame(() => focusContext.classList.add('show'));
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
      focusContext.classList.remove('show');
      setTimeout(() => focusContext.classList.add('hidden'), 180);
    }, 80);
  });
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
  if (route === 'admin') return renderAdmin(root, navigate);
  return renderBooking(root, navigate);
}

async function start() {
  configureTelegram();
  configureFocusContext();
  configureAdminNav();
  root.innerHTML = `<div class="loading"><div><div class="spinner"></div>Загружаем HOUSE CLEANING...</div></div>`;

  if (!tg?.initData && !isDemoMode) {
    root.innerHTML = `<section class="hero"><div class="brand"><div class="brand-mark">HC</div><div><div class="brand-title">HOUSE CLEANING</div><div class="brand-sub">Уборка квартир и домов</div></div></div><div class="hero-copy"><h1>Откройте в Telegram</h1><p>Приложение использует безопасную авторизацию Telegram Mini App.</p></div></section>`;
    return;
  }

  try {
    state.bootstrap = await api.bootstrap();
    await state.restorePhotos();
    nav.classList.remove('hidden');
    nav.querySelectorAll('[data-route]').forEach((button) => button.onclick = () => navigate(button.dataset.route));

    const startParam = tg?.initDataUnsafe?.start_param || '';
    if (!isDemoMode && startParam.startsWith('order_')) {
      const orderId = Number(startParam.slice(6));
      if (Number.isInteger(orderId)) return navigate('orders', { orderId });
    }
    navigate(adminMode ? 'admin' : 'booking');
  } catch (error) {
    root.innerHTML = `<div class="card pad" style="margin-top:60px"><h2>Не удалось открыть приложение</h2><p class="page-subtitle">${escapeHtml(error.message || 'Ошибка')}</p><button class="primary-btn" onclick="location.reload()">Попробовать снова</button></div>`;
  }
}

start();
