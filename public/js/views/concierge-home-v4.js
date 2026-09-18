import { renderConciergeHome as renderBaseHome } from './concierge-home-v3.js?v=57';
import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatTime, money } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);

function headers() {
  return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
}

function statusInfo(status) {
  if (['NEW', 'REVIEW'].includes(status)) return { label: 'На проверке', cls: 'pending' };
  if (['CONFIRMED', 'CLEANER_ASSIGNED'].includes(status)) return { label: 'Подтверждена', cls: 'confirmed' };
  if (status === 'IN_PROGRESS') return { label: 'Уборка началась', cls: 'progress' };
  if (status === 'COMPLETED') return { label: 'Завершена', cls: 'completed' };
  if (status === 'CANCELLED') return { label: 'Отменена', cls: 'cancelled' };
  return { label: 'Заявка', cls: 'neutral' };
}

function shortOrderNumber(order) {
  const direct = Number(order?.display_number || order?.short_number || order?.id || 0);
  if (Number.isFinite(direct) && direct > 0) return `#${String(Math.trunc(direct)).padStart(3, '0')}`;
  const digits = String(order?.order_number || '').replace(/\D/g, '');
  const fallback = digits.slice(-3);
  return fallback ? `#${fallback.padStart(3, '0')}` : '#---';
}

function orderStart(order) {
  if (!order?.date) return Number.POSITIVE_INFINITY;
  const time = String(order.time || '00:00').slice(0, 5);
  const stamp = Date.parse(`${order.date}T${time}:00+03:00`);
  return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY;
}

async function loadOrders() {
  const local = await api.orders().catch(() => ({ orders: [] }));
  const localOrders = Array.isArray(local?.orders) ? local.orders : [];
  let stored = [];
  try {
    const response = await fetch('/api/demo-client-orders', { headers: headers(), cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      stored = Array.isArray(data?.orders) ? data.orders : [];
    }
  } catch {}
  const map = new Map();
  for (const item of [...localOrders, ...stored]) {
    const key = String(item.order_number || item.id || '');
    if (!key) continue;
    const previous = map.get(key) || {};
    map.set(key, { ...previous, ...item, id: previous.id || item.id });
  }
  return [...map.values()];
}

function recentOrders(list) {
  return [...list].sort((a, b) => {
    const created = String(b.created_at || b.updated_at || '').localeCompare(String(a.created_at || a.updated_at || ''));
    if (created) return created;
    return Number(b.id || 0) - Number(a.id || 0);
  }).slice(0, 3);
}

function upcomingSevenDays(list) {
  const now = Date.now() - 6 * 60 * 60 * 1000;
  const limit = Date.now() + 7 * 24 * 60 * 60 * 1000;
  return list
    .filter((order) => ACTIVE.has(order.status))
    .filter((order) => {
      const stamp = orderStart(order);
      return Number.isFinite(stamp) && stamp >= now && stamp <= limit;
    })
    .sort((a, b) => orderStart(a) - orderStart(b));
}

function compactOrderCard(order, { showPrice = false } = {}) {
  const status = statusInfo(order.status);
  const address = [order.city, order.address].filter(Boolean).join(', ');
  const price = Number(order.estimated_price || 0);
  return `<button class="hc-home-order-card-v54 status-${status.cls}" type="button" data-home-order="${escapeHtml(order.id)}">
    <span class="hc-home-order-top-v54"><b>Заказ ${escapeHtml(shortOrderNumber(order))}</b><em class="hc-home-status-v54 ${status.cls}">${escapeHtml(status.label)}</em></span>
    <strong>${escapeHtml(order.service_name || 'Уборка')}</strong>
    <span class="hc-home-order-meta-v54">${escapeHtml(formatDate(order.date))} · ${escapeHtml(formatTime(order.time))}${order.area ? ` · ${escapeHtml(String(order.area))} м²` : ''}</span>
    <span class="hc-home-order-address-v54">${escapeHtml(address || 'Адрес указан в заявке')}</span>
    ${showPrice && price > 0 ? `<span class="hc-home-order-price-v54">от ${escapeHtml(money(price))}</span>` : ''}
  </button>`;
}

function cleaningSummary(list) {
  const completed = list.filter((order) => order.status === 'COMPLETED').sort((a,b) => orderStart(b) - orderStart(a));
  const upcoming = list.filter((order) => ACTIVE.has(order.status) && orderStart(order) >= Date.now() - 6 * 60 * 60 * 1000).sort((a,b) => orderStart(a) - orderStart(b));
  const profile = state.bootstrap?.user || {};
  const planRemaining = Number(profile.cleanings_remaining ?? profile.remaining_cleanings ?? profile.subscription_remaining ?? 0);
  const last = completed[0] || null;
  const next = upcoming[0] || null;
  return {
    completed: completed.length,
    remaining: Number.isFinite(planRemaining) && planRemaining > 0 ? planRemaining : upcoming.length,
    remainingLabel: planRemaining > 0 ? 'По вашему графику' : 'Запланировано сейчас',
    last,
    next,
  };
}

function summarySection(list) {
  const summary = cleaningSummary(list);
  const lastText = summary.last ? `${formatDate(summary.last.date)} · ${formatTime(summary.last.time)}` : 'Ещё не было';
  const nextText = summary.next ? `${formatDate(summary.next.date)} · ${formatTime(summary.next.time)}` : 'Пока не запланирована';
  const nextMeta = summary.next ? [summary.next.service_name, summary.next.address].filter(Boolean).join(' · ') : 'Оформите новую уборку за пару минут';
  return `<section class="u7-summary">
    <div class="u7-summary-head"><h2>Мои уборки</h2><span>Всё важное сразу</span></div>
    <div class="u7-summary-grid">
      <div class="u7-summary-card"><small>Выполнено</small><strong>${summary.completed}</strong><span>завершённых уборок</span></div>
      <div class="u7-summary-card"><small>Осталось</small><strong>${summary.remaining}</strong><span>${escapeHtml(summary.remainingLabel)}</span></div>
      <div class="u7-summary-card"><small>Последняя</small><strong style="font-size:16px">${escapeHtml(lastText)}</strong><span>${summary.last ? escapeHtml(summary.last.service_name || 'Уборка') : 'История появится здесь'}</span></div>
      <div class="u7-summary-card"><small>Активные</small><strong>${summary.next ? '1+' : '0'}</strong><span>ближайшие заявки</span></div>
      <button class="u7-summary-card next" type="button" data-summary-next><small>Следующая уборка</small><strong>${escapeHtml(nextText)}</strong><span>${escapeHtml(nextMeta)}</span></button>
    </div>
  </section>`;
}

function buildHomeOrdersSection(orders) {
  const recent = recentOrders(orders);
  const upcoming = upcomingSevenDays(orders);
  return `${summarySection(orders)}<section class="cc-section hc-home-orders-section-v54">
    <div class="cc-section-head hc-home-section-head-v54"><div><h2>Последние заказы</h2><span>Статус и основные детали</span></div><button type="button" data-all-orders>Все заявки</button></div>
    <div class="hc-home-order-list-v54">${recent.length ? recent.map((order) => compactOrderCard(order, { showPrice: true })).join('') : '<div class="card hc-home-empty-v54">У вас пока нет оформленных заявок.</div>'}</div>
  </section>
  <section class="cc-section hc-home-week-section-v54">
    <div class="cc-section-head hc-home-section-head-v54"><div><h2>Ближайшие 7 дней</h2><span>${upcoming.length ? `Запланировано: ${upcoming.length}` : 'Запланированных уборок нет'}</span></div></div>
    <div class="hc-home-week-list-v54">${upcoming.length ? upcoming.slice(0, 4).map((order) => compactOrderCard(order)).join('') : '<div class="card hc-home-empty-v54">На ближайшие 7 дней уборок нет.</div>'}</div>
    ${upcoming.length > 4 ? `<button class="hc-home-more-v54" type="button" data-all-orders>Ещё ${upcoming.length - 4} в заявках</button>` : ''}
  </section>`;
}

export async function renderConciergeHome(root, navigate) {
  await renderBaseHome(root, navigate);
  if (!root.querySelector('.cc-home')) return;

  root.querySelector('[data-call]')?.remove();
  const manager = root.querySelector('[data-manager]');
  if (manager) manager.textContent = '✉️ Написать менеджеру';

  const faq = root.querySelector('[data-tool="faq"]');
  if (faq) faq.onclick = () => navigate('profile', { section: 'faq', from: 'home' });

  let orders = [];
  try { orders = await loadOrders(); } catch {}
  if (!root.querySelector('.cc-home')) return;

  const tools = root.querySelector('.cc-for-you-section');
  if (tools && !root.querySelector('.hc-home-orders-section-v54')) {
    tools.insertAdjacentHTML('beforebegin', buildHomeOrdersSection(orders));
    root.querySelectorAll('[data-home-order]').forEach((card) => {
      card.onclick = () => {
        const id = Number(card.dataset.homeOrder || 0);
        if (id) navigate('orders', { orderId: id, from: 'home' });
      };
    });
    root.querySelectorAll('[data-all-orders]').forEach((button) => {
      button.onclick = () => navigate('orders', { from: 'home' });
    });
    root.querySelector('[data-summary-next]')?.addEventListener('click', () => {
      const next = cleaningSummary(orders).next;
      if (next?.id) navigate('orders', { orderId: Number(next.id), from: 'home' });
      else navigate('booking');
    });
  }

  const contact = root.querySelector('.hc-home-contact');
  if (contact && !root.querySelector('[data-subscription-banner]')) {
    const banner = document.createElement('section');
    banner.className = 'card hc-subscription-banner';
    banner.dataset.subscriptionBanner = '1';
    banner.innerHTML = `<div class="hc-subscription-badge">АБОНЕМЕНТЫ</div><div><h3>Регулярная уборка — проще</h3><p>5 или 10 уборок с заранее согласованным графиком и без повторного оформления каждой заявки.</p></div><button type="button" class="hc-btn hc-btn-gold" data-open-subscriptions>Посмотреть абонементы</button>`;
    contact.insertAdjacentElement('beforebegin', banner);
    banner.querySelector('[data-open-subscriptions]').onclick = () => navigate('profile', { section: 'subscriptions', from: 'home' });
  }
}
