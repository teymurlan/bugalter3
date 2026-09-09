import { api, isDemoMode } from './api.js?v=18';
import { state } from './state.js?v=18';
import { escapeHtml } from './utils.js?v=18';
import { renderBooking } from './views/booking-v2.js?v=18';
import { renderOrders } from './views/orders.js?v=18';
import { renderProfile } from './views/profile.js?v=18';
import { renderAdmin } from './views/admin.js?v=18';

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
  nav.classList.toggle('admin-mode', adminMode);
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

function moveIndicator(button, retry = 0) {
  if (!button) return;
  requestAnimationFrame(() => {
    const navRect = nav.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if ((!navRect.width || !buttonRect.width) && retry < 4) {
      setTimeout(() => moveIndicator(button, retry + 1), 40);
      return;
    }
    const center = buttonRect.left - navRect.left + buttonRect.width / 2;
    nav.style.setProperty('--indicator-x', `${Math.round(center)}px`);
  });
}

function setActiveNav(route) {
  const visualRoute = route === 'booking' ? 'home' : route;
  let activeButton = null;
  nav.querySelectorAll('[data-route]').forEach((button) => {
    const active = button.dataset.route === visualRoute;
    button.classList.toggle('active', active);
    if (active) activeButton = button;
  });
  moveIndicator(activeButton);
}

function configureNavSync() {
  const sync = () => {
    if (root.querySelector('.home-hero') || root.querySelector('.booking-top')) setActiveNav('home');
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: false });

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(() => moveIndicator(nav.querySelector('.nav-item.active')));
    resizeObserver.observe(nav);
  } else {
    window.addEventListener('resize', () => moveIndicator(nav.querySelector('.nav-item.active')));
  }
}

function haptic() {
  try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
}

export function navigate(route, params = {}) {
  state.route = route;
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (route === 'home') {
    setActiveNav('home');
    const savedStep = Number(state.draft?.step || 0);
    state.draft.step = 0;
    renderBooking(root, navigate);
    state.draft.step = savedStep;
    return;
  }

  if (route === 'booking') {
    setActiveNav('home');
    if (!Number(state.draft?.step || 0)) {
      state.draft.step = 1;
      state.saveDraft();
    }
    return renderBooking(root, navigate);
  }

  setActiveNav(route);
  if (route === 'orders') return renderOrders(root, navigate, params);
  if (route === 'profile') return renderProfile(root, navigate);
  if (route === 'admin') return renderAdmin(root, navigate);
  return navigate('home');
}

async function start() {
  configureTelegram();
  configureFocusContext();
  configureAdminNav();
  configureNavSync();
  root.innerHTML = `<div class="loading"><div><div class="spinner"></div>Загружаем HOUSE CLEANING...</div></div>`;

  if (!tg?.initData && !isDemoMode) {
    root.innerHTML = `<section class="hero"><div class="brand"><div class="brand-mark">HC</div><div><div class="brand-title">HOUSE CLEANING</div><div class="brand-sub">Уборка квартир и домов</div></div></div><div class="hero-copy"><h1>Откройте в Telegram</h1><p>Приложение использует безопасную авторизацию Telegram Mini App.</p></div></section>`;
    return;
  }

  try {
    state.bootstrap = await api.bootstrap();
    await state.restorePhotos();
    nav.classList.remove('hidden');
    nav.querySelectorAll('[data-route]').forEach((button) => {
      button.onclick = () => {
        haptic();
        navigate(button.dataset.route);
      };
    });

    const startParam = tg?.initDataUnsafe?.start_param || '';
    if (!isDemoMode && startParam.startsWith('order_')) {
      const orderId = Number(startParam.slice(6));
      if (Number.isInteger(orderId)) return navigate('orders', { orderId });
    }

    const initialRoute = adminMode ? 'admin' : 'home';
    navigate(initialRoute);
    requestAnimationFrame(() => requestAnimationFrame(() => setActiveNav(initialRoute)));
  } catch (error) {
    root.innerHTML = `<div class="card pad" style="margin-top:60px"><h2>Не удалось открыть приложение</h2><p class="page-subtitle">${escapeHtml(error.message || 'Ошибка')}</p><button class="primary-btn" onclick="location.reload()">Попробовать снова</button></div>`;
  }
}

start();