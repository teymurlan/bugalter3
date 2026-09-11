import { api, isDemoMode } from './api.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { renderBooking } from './views/booking-v2.js?v=24';
import { renderConciergeHome } from './views/concierge-home.js?v=24';
import { renderConciergeOrders } from './views/concierge-orders.js?v=24';
import { renderConciergeProfile } from './views/concierge-profile.js?v=25';
import { renderAdmin } from './views/admin-v2.js?v=24';

const tg = window.Telegram?.WebApp;
const root = document.querySelector('#app');
const nav = document.querySelector('#bottom-nav');
const focusContext = document.querySelector('#focus-context');
const query = new URLSearchParams(window.location.search);
const adminMode = query.get('admin') === '1';
const reviewOrderParam = String(query.get('review') || '').trim();
const DEMO_ORDERS_KEY = 'hc-demo-orders-v2';

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
  document.body.classList.toggle('client-concierge', !adminMode);
  document.body.classList.toggle('admin-ops-mode', adminMode);
  if (adminMode) nav.classList.add('hidden');
}

function configureFocusContext() {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    if (target.type === 'file' || target.type === 'range' || target.type === 'date') return;
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

function releaseFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
    try { active.blur(); } catch {}
  }
  focusContext.classList.remove('show');
  focusContext.classList.add('hidden');
}

function moveIndicator(button, retry = 0) {
  if (adminMode || !button) return;
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
  if (adminMode) return;
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
  if (adminMode) return;
  const sync = () => {
    const booking = Boolean(root.querySelector('.booking-top'));
    document.body.classList.toggle('booking-flow', booking);
    if (root.querySelector('.cc-home') || root.querySelector('.home-hero') || booking) setActiveNav('home');
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

async function syncOwnDemoOrders() {
  if (!isDemoMode || !tg?.initData || adminMode) return;
  let local = [];
  try { local = JSON.parse(localStorage.getItem(DEMO_ORDERS_KEY) || '[]'); }
  catch { local = []; }
  if (!Array.isArray(local)) local = [];

  try {
    const response = await fetch('/api/demo-client-orders', {
      headers: { 'X-Telegram-Init-Data': tg.initData },
    });
    if (!response.ok) return;
    const data = await response.json();
    const stored = Array.isArray(data?.orders) ? data.orders : [];
    if (!stored.length) return;

    const byNumber = new Map(local.map((item) => [String(item.order_number || ''), item]));
    let nextId = local.reduce((max, item) => Math.max(max, Number(item.id || 0)), 0) + 1;
    for (const server of stored) {
      const number = String(server.order_number || '');
      if (!number) continue;
      const existing = byNumber.get(number);
      if (existing) Object.assign(existing, server, { id: existing.id });
      else {
        const item = { ...server, id: Number(server.id || 0) || nextId++ };
        local.push(item);
        byNumber.set(number, item);
      }
    }
    local.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify(local));
  } catch (error) {
    console.warn('Own order sync skipped', error);
  }
}

export function navigate(route, params = {}) {
  if (adminMode && route !== 'admin') route = 'admin';
  if (route !== 'booking') releaseFocus();
  state.route = route;
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (route === 'admin') return renderAdmin(root, navigate);

  if (route === 'home') {
    setActiveNav('home');
    document.body.classList.remove('booking-flow');
    return renderConciergeHome(root, navigate);
  }

  if (route === 'booking') {
    setActiveNav('home');
    if (!Number(state.draft?.step || 0)) {
      state.draft.step = 1;
      state.saveDraft();
    }
    return renderBooking(root, navigate);
  }

  document.body.classList.remove('booking-flow');
  setActiveNav(route);
  if (route === 'orders') return renderConciergeOrders(root, navigate, params);
  if (route === 'profile') return renderConciergeProfile(root, navigate, params);
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
    await syncOwnDemoOrders();
    await state.restorePhotos();

    if (!adminMode) {
      nav.classList.remove('hidden');
      nav.querySelectorAll('[data-route]').forEach((button) => {
        button.onpointerdown = () => releaseFocus();
        button.onclick = () => {
          haptic();
          navigate(button.dataset.route);
        };
      });
    } else {
      nav.classList.add('hidden');
    }

    if (!adminMode && reviewOrderParam) {
      const data = await api.orders();
      const order = (data?.orders || []).find((item) => String(item.order_number || '') === reviewOrderParam);
      if (order?.id) return navigate('orders', { orderId: Number(order.id) });
    }

    const startParam = tg?.initDataUnsafe?.start_param || '';
    if (!adminMode && !isDemoMode && startParam.startsWith('order_')) {
      const orderId = Number(startParam.slice(6));
      if (Number.isInteger(orderId)) return navigate('orders', { orderId });
    }

    const initialRoute = adminMode ? 'admin' : 'home';
    navigate(initialRoute);
    if (!adminMode) requestAnimationFrame(() => requestAnimationFrame(() => setActiveNav(initialRoute)));
  } catch (error) {
    root.innerHTML = `<div class="card pad" style="margin-top:60px"><h2>Не удалось открыть приложение</h2><p class="page-subtitle">${escapeHtml(error.message || 'Ошибка')}</p><button class="primary-btn" onclick="location.reload()">Попробовать снова</button></div>`;
  }
}

start();
