import { api, isDemoMode } from './api.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { renderBooking } from './views/booking-v2.js?v=29';
import { renderConciergeHome } from './views/concierge-home-v3.js?v=29';
import { renderConciergeOrders } from './views/concierge-orders-v4.js?v=29';
import { renderConciergeProfile } from './views/concierge-profile-v3.js?v=29';
import { renderAdmin } from './views/admin-v4.js?v=29';

const tg = window.Telegram?.WebApp;
const root = document.querySelector('#app');
const nav = document.querySelector('#bottom-nav');
const focusContext = document.querySelector('#focus-context');
const query = new URLSearchParams(window.location.search);
const adminMode = query.get('admin') === '1';
const reviewOrderParam = String(query.get('review') || '').trim();
const openParam = String(query.get('open') || '').trim().toLowerCase();
const DEMO_ORDERS_KEY = 'hc-demo-orders-v2';
const PROFILE_CACHE_KEY = 'hc-client-profile-v1';
let lastNavRoute = '';
let lastNavAt = 0;

function configureTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.('#05090c');
  tg.setBackgroundColor?.('#05090c');
  tg.setBottomBarColor?.('#070c10');
  tg.disableVerticalSwipes?.();
}

function configureAdminMode() {
  document.body.classList.toggle('client-concierge', !adminMode);
  document.body.classList.toggle('admin-ops-mode', adminMode);
  if (adminMode) nav?.classList.add('hidden');
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
      focusContext.classList.add('hidden');
    }, 100);
  });
}

function releaseFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
    try { active.blur(); } catch {}
  }
  document.body.classList.remove('keyboard-open');
  focusContext?.classList.remove('show');
  focusContext?.classList.add('hidden');
}

function moveIndicator(button, retry = 0) {
  if (adminMode || !button || !nav) return;
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
  if (adminMode || !nav) return;
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
  if (adminMode || !nav) return;
  const sync = () => {
    const booking = Boolean(root.querySelector('.booking-top'));
    document.body.classList.toggle('booking-flow', booking);
    if (booking) setActiveNav('home');
  };
  new MutationObserver(sync).observe(root, { childList: true, subtree: false });
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => moveIndicator(nav.querySelector('.nav-item.active'))).observe(nav);
  } else {
    window.addEventListener('resize', () => moveIndicator(nav.querySelector('.nav-item.active')));
  }
}

function haptic() {
  try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
}

function configureClientNav() {
  if (adminMode || !nav) return;
  nav.classList.remove('hidden');

  const buttonFromEvent = (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-route]') : null;
    return target && nav.contains(target) ? target : null;
  };

  const go = (button, event) => {
    const route = String(button?.dataset?.route || '');
    if (!['home', 'orders', 'profile'].includes(route)) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    releaseFocus();
    lastNavRoute = route;
    lastNavAt = Date.now();
    haptic();
    navigate(route);
    return true;
  };

  nav.addEventListener('pointerup', (event) => {
    const button = buttonFromEvent(event);
    if (button) go(button, event);
  }, true);

  nav.addEventListener('click', (event) => {
    const button = buttonFromEvent(event);
    if (!button) return;
    const route = String(button.dataset.route || '');
    event.preventDefault();
    event.stopPropagation();
    if (route === lastNavRoute && Date.now() - lastNavAt < 650) return;
    go(button, event);
  }, true);
}

async function hydrateClientProfile() {
  if (adminMode) return;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null'); } catch {}
  if (cached && typeof cached === 'object') state.bootstrap.user = { ...(state.bootstrap?.user || {}), ...cached };
  if (!tg?.initData) return;
  try {
    const response = await fetch('/api/client-profile', { headers: { 'X-Telegram-Init-Data': tg.initData } });
    if (!response.ok) return;
    const data = await response.json();
    if (!data?.profile) return;
    state.bootstrap.user = { ...(state.bootstrap?.user || {}), ...data.profile };
    try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data.profile)); } catch {}
  } catch (error) {
    console.warn('Profile hydrate skipped', error);
  }
}

async function syncOwnDemoOrders() {
  if (!isDemoMode || !tg?.initData || adminMode) return;
  let local = [];
  try { local = JSON.parse(localStorage.getItem(DEMO_ORDERS_KEY) || '[]'); } catch {}
  if (!Array.isArray(local)) local = [];
  try {
    const response = await fetch('/api/demo-client-orders', { headers: { 'X-Telegram-Init-Data': tg.initData } });
    if (!response.ok) return;
    const data = await response.json();
    const stored = Array.isArray(data?.orders) ? data.orders : [];
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
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  if (route === 'admin') return renderAdmin(root, navigate);
  if (route === 'home') {
    document.body.classList.remove('booking-flow');
    setActiveNav('home');
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
  configureAdminMode();
  configureNavSync();
  root.innerHTML = `<div class="loading"><div><div class="spinner"></div>Загружаем HOUSE CLEANING...</div></div>`;

  if (!tg?.initData && !isDemoMode) {
    root.innerHTML = `<section class="hero"><div class="brand"><div class="brand-mark">HC</div><div><div class="brand-title">HOUSE CLEANING</div><div class="brand-sub">Уборка квартир и домов</div></div></div><div class="hero-copy"><h1>Откройте в Telegram</h1><p>Приложение использует безопасную авторизацию Telegram Mini App.</p></div></section>`;
    return;
  }

  try {
    state.bootstrap = await api.bootstrap();
    await Promise.all([hydrateClientProfile(), syncOwnDemoOrders(), state.restorePhotos()]);
    configureClientNav();

    if (!adminMode && openParam === 'referral') {
      return navigate('profile', { section: 'referral' });
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
