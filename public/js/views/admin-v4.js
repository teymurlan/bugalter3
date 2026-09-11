import { api } from '../api.js';
import { escapeHtml, formatDate, formatTime, modal, money, showToast } from '../utils.js';

const CAPACITY = 300;
const PENDING = new Set(['NEW', 'REVIEW']);
const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);

let section = 'overview';
let orderFilter = 'all';
let orderSearch = '';
let customDate = '';
let clientSearch = '';
let reviewSearch = '';
let reviewSort = 'newest';
let reviewRating = 'all';
let referralSearch = '';
let reportPeriod = 'today';
let orders = [];
let reviews = [];
let referrals = [];
let loadedReviews = false;
let loadedReferrals = false;

function headers(extra = {}) {
  return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '', ...extra };
}

async function getJson(path) {
  const response = await fetch(path, { headers: headers() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`);
  return data;
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`);
  return data;
}

export async function renderAdmin(root, navigate) {
  document.body.classList.add('admin-ops-mode');
  root.innerHTML = loading('Загружаем панель...');
  try {
    orders = Array.isArray((await api.adminOrders())?.orders) ? (await api.adminOrders()).orders : [];
  } catch (error) {
    // Повторяем только один раз, если первый ответ пришёл без массива из-за старого кеша.
    try { orders = Array.isArray((await api.adminOrders())?.orders) ? (await api.adminOrders()).orders : []; }
    catch {
      root.innerHTML = `<div class="ops-error"><h2>Не удалось открыть панель</h2><p>${escapeHtml(error.message || 'Ошибка')}</p><button class="hc-btn hc-btn-blue" data-retry>Повторить</button></div>`;
      root.querySelector('[data-retry]').onclick = () => renderAdmin(root, navigate);
      return;
    }
  }
  renderSection(root, navigate);
}

async function refreshOrders() {
  const data = await api.adminOrders();
  orders = Array.isArray(data?.orders) ? data.orders : [];
}

async function switchSection(root, navigate, next) {
  section = next;
  if (section === 'reviews' && !loadedReviews) {
    root.innerHTML = shell(loading('Загружаем отзывы...'));
    try {
      reviews = Array.isArray((await getJson('/api/demo-admin-reviews'))?.reviews) ? (await getJson('/api/demo-admin-reviews')).reviews : [];
      loadedReviews = true;
    } catch (error) { showToast(error.message || 'Не удалось загрузить отзывы', true); }
  }
  if (section === 'referrals' && !loadedReferrals) {
    root.innerHTML = shell(loading('Загружаем рефералы...'));
    try {
      referrals = Array.isArray((await getJson('/api/demo-admin-referrals'))?.referrals) ? (await getJson('/api/demo-admin-referrals')).referrals : [];
      loadedReferrals = true;
    } catch (error) { showToast(error.message || 'Не удалось загрузить рефералы', true); }
  }
  renderSection(root, navigate);
}

function renderSection(root, navigate) {
  const content = section === 'orders' ? ordersView()
    : section === 'clients' ? clientsView()
      : section === 'reviews' ? reviewsView()
        : section === 'referrals' ? referralsView()
          : overviewView();
  root.innerHTML = shell(content);
  bindShell(root, navigate);
  if (section === 'overview') bindOverview(root, navigate);
  if (section === 'orders') bindOrders(root, navigate);
  if (section === 'clients') bindClients(root, navigate);
  if (section === 'reviews') bindReviews(root, navigate);
  if (section === 'referrals') bindReferrals(root, navigate);
}

function shell(content) {
  return `<div class="ops-shell hc-admin-v4"><header class="ops-header"><div><span class="ops-kicker">HOUSE CLEANING · УПРАВЛЕНИЕ</span><h1>${escapeHtml(sectionTitle())}</h1><p>${escapeHtml(sectionSubtitle())}</p></div><button class="ops-refresh" type="button" data-refresh aria-label="Обновить">↻</button></header><main class="ops-content">${content}</main>${adminNav()}</div>`;
}

function sectionTitle() {
  return ({ overview: 'Обзор', orders: 'Заказы', clients: 'Клиенты', reviews: 'Отзывы', referrals: 'Рефералы' })[section] || 'Обзор';
}
function sectionSubtitle() {
  return ({
    overview: 'Ближайшие уборки, загрузка и отчёт по услугам.',
    orders: 'Поиск, фильтры, статусы и быстрые действия.',
    clients: 'Клиенты и история их уборок.',
    reviews: 'Оценки и обратная связь после уборок.',
    referrals: 'Переходы, заявки, завершения и начисленные скидки.',
  })[section] || '';
}

function navIcon(name) {
  const map = {
    overview: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
    orders: '<svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v14H5V5a2 2 0 0 1 2-2Z"/><path d="M15 3v5h4M8 12h8M8 16h8"/></svg>',
    clients: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.5-4 2.6-6 6-6s5.5 2 6 6M14 15c3.2.1 5 1.8 5.5 5"/></svg>',
    reviews: '<svg viewBox="0 0 24 24"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9L12 3Z"/></svg>',
    referrals: '<svg viewBox="0 0 24 24"><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13"/><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5L12 7Zm0 0h3.5A2.5 2.5 0 1 0 13 4.5L12 7Z"/></svg>',
  };
  return map[name] || '';
}

function adminNav() {
  const labels = { overview: 'Обзор', orders: 'Заказы', clients: 'Клиенты', reviews: 'Отзывы', referrals: 'Рефералы' };
  return `<nav class="ops-nav hc-admin-nav" aria-label="Навигация администратора">${Object.keys(labels).map((id) => `<button type="button" class="${section === id ? 'active' : ''}" data-admin-section="${id}"><span class="hc-admin-nav-icon">${navIcon(id)}</span><small>${labels[id]}</small></button>`).join('')}</nav>`;
}

function bindShell(root, navigate) {
  root.querySelector('[data-refresh]').onclick = async () => {
    try {
      await refreshOrders();
      if (section === 'reviews') { reviews = (await getJson('/api/demo-admin-reviews')).reviews || []; loadedReviews = true; }
      if (section === 'referrals') { referrals = (await getJson('/api/demo-admin-referrals')).referrals || []; loadedReferrals = true; }
      renderSection(root, navigate);
    } catch (error) { showToast(error.message || 'Не удалось обновить', true); }
  };
  root.querySelectorAll('[data-admin-section]').forEach((button) => button.onclick = () => switchSection(root, navigate, button.dataset.adminSection));
}

function overviewView() {
  const days = [daySummary(0, 'Сегодня'), daySummary(1, 'Завтра'), daySummary(2, 'Послезавтра')];
  const today = days[0].date;
  const todayOrders = orders.filter((order) => order.date === today && order.status !== 'CANCELLED').sort(sortOrders);
  const attention = orders.filter((order) => PENDING.has(order.status)).sort(sortOrders).slice(0, 8);
  return `<section class="ops-stats">${stat('На подтверждение', orders.filter((o) => PENDING.has(o.status)).length, 'attention')}${stat('Сегодня', todayOrders.length, '')}${stat('В работе', todayOrders.filter((o) => o.status === 'IN_PROGRESS').length, 'progress')}${stat('Завершено сегодня', todayOrders.filter((o) => o.status === 'COMPLETED').length, 'ok')}</section>
    <div class="ops-title-row"><div><h2>Сегодня, завтра, послезавтра</h2><p>Количество уборок и загрузка по площади.</p></div></div>
    <section class="hc-admin-days">${days.map(dayCard).join('')}</section>
    ${serviceReport()}
    <div class="ops-title-row"><div><h2>На подтверждение</h2><p>Новые заявки всегда наверху.</p></div><span>${attention.length}</span></div>
    <section class="ops-attention-list">${attention.length ? attention.map(attentionCard).join('') : '<div class="ops-empty card"><strong>Новых заявок нет</strong><span>Сейчас всё обработано.</span></div>'}</section>
    <div class="ops-title-row"><div><h2>Сегодня по времени</h2><p>${escapeHtml(formatDate(today))}</p></div><span>${todayOrders.length}</span></div>
    <section class="ops-today-list">${todayOrders.length ? todayOrders.map(scheduleRow).join('') : '<div class="ops-empty card"><strong>На сегодня уборок нет</strong></div>'}</section>`;
}

function daySummary(offset, label) {
  const date = moscowIso(offset);
  const list = orders.filter((order) => order.date === date && order.status !== 'CANCELLED');
  const used = list.filter((order) => order.status !== 'COMPLETED').reduce((sum, order) => sum + Math.max(0, Number(order.area || 0)), 0);
  return { label, date, count: list.length, used, pct: Math.min(100, Math.round((used / CAPACITY) * 100)), free: Math.max(0, CAPACITY - used) };
}
function dayCard(day) {
  const cls = day.pct >= 100 ? 'full' : day.pct >= 86 ? 'hot' : day.pct >= 61 ? 'busy' : 'calm';
  return `<button class="card hc-day-card ${cls}" type="button" data-day-date="${day.date}"><div class="hc-day-top"><span>${day.label}</span><b>${escapeHtml(formatDate(day.date))}</b></div><strong>${day.count} ${plural(day.count, 'уборка', 'уборки', 'уборок')}</strong><div class="hc-day-load"><span>${day.used} / ${CAPACITY} м²</span><b>${day.pct}%</b></div><div class="hc-day-track"><i style="width:${day.pct}%"></i></div><small>${day.used >= CAPACITY ? 'День полностью загружен' : `Свободно ${day.free} м²`}</small></button>`;
}
function stat(label, value, cls = '') { return `<div class="ops-stat ${cls}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`; }

function serviceReport() {
  const relevant = reportOrders();
  const counts = { general: 0, maintenance: 0, renovation: 0, commercial: 0, other: 0 };
  for (const order of relevant) counts[serviceKind(order)] += 1;
  const cards = [
    ['Генеральная', counts.general], ['Поддерживающая', counts.maintenance], ['После ремонта', counts.renovation], ['Коммерческая', counts.commercial],
  ];
  if (counts.other) cards.push(['Другие', counts.other]);
  const labels = [['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['dayafter', 'Послезавтра'], ['week', '7 дней'], ['month', 'Месяц']];
  return `<section class="hc-service-report card"><div class="hc-report-head"><div><span>Отчёт по уборкам</span><strong>${relevant.length} ${plural(relevant.length, 'уборка', 'уборки', 'уборок')}</strong></div></div><div class="hc-report-periods">${labels.map(([id, label]) => `<button type="button" class="${reportPeriod === id ? 'active' : ''}" data-report-period="${id}">${label}</button>`).join('')}</div><div class="hc-report-grid">${cards.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join('')}</div></section>`;
}

function reportOrders() {
  const currentMonth = moscowIso(0).slice(0, 7);
  return orders.filter((order) => {
    if (order.status === 'CANCELLED') return false;
    if (reportPeriod === 'today') return order.date === moscowIso(0);
    if (reportPeriod === 'tomorrow') return order.date === moscowIso(1);
    if (reportPeriod === 'dayafter') return order.date === moscowIso(2);
    if (reportPeriod === 'week') return order.date >= moscowIso(0) && order.date <= moscowIso(6);
    if (reportPeriod === 'month') return String(order.date || '').startsWith(currentMonth);
    return true;
  });
}

function serviceKind(order) {
  const id = Number(order.service_id || 0);
  if (id === 1) return 'general';
  if (id === 2) return 'maintenance';
  if (id === 3) return 'renovation';
  if (id === 4) return 'commercial';
  const text = String(order.service_name || '').toLowerCase();
  if (text.includes('генераль')) return 'general';
  if (text.includes('поддерж')) return 'maintenance';
  if (text.includes('ремонт')) return 'renovation';
  if (text.includes('коммер')) return 'commercial';
  return 'other';
}

function attentionCard(order) {
  return `<article class="ops-attention card"><div class="ops-attention-top"><div><span>${escapeHtml(order.order_number || '')}</span><strong>${escapeHtml(order.customer_name || 'Клиент')}</strong></div><b>${escapeHtml(ageLabel(order))}</b></div><div class="ops-mini-meta">${escapeHtml(order.service_name || 'Уборка')} · ${escapeHtml(String(order.area || 0))} м² · ${escapeHtml(formatDate(order.date))} ${escapeHtml(formatTime(order.time))}</div><div class="ops-quick-actions hc-admin-actions"><button class="hc-btn hc-btn-gold" type="button" data-open-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Открыть</button><button class="hc-btn hc-btn-blue" type="button" data-chat-client="${escapeHtml(order.client_telegram_id)}">✉️ Написать</button>${order.phone ? `<button class="hc-btn hc-btn-green" type="button" data-call="${escapeHtml(order.phone)}">📞 Позвонить</button>` : ''}<button class="hc-btn hc-btn-green" type="button" data-confirm="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">✓ Подтвердить</button></div></article>`;
}

function scheduleRow(order) {
  const status = publicStatus(order.status);
  return `<button class="ops-schedule-row card status-${status.cls}" type="button" data-open-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}"><time>${escapeHtml(formatTime(order.time))}</time><span><strong>${escapeHtml(order.customer_name || 'Клиент')}</strong><small>${escapeHtml(order.service_name || 'Уборка')} · ${escapeHtml(String(order.area || 0))} м²</small></span><em class="status-${status.cls}">${escapeHtml(status.label)}</em></button>`;
}

function bindOverview(root, navigate) {
  root.querySelectorAll('[data-day-date]').forEach((button) => button.onclick = () => { customDate = button.dataset.dayDate; orderFilter = 'date'; switchSection(root, navigate, 'orders'); });
  root.querySelectorAll('[data-report-period]').forEach((button) => button.onclick = () => { reportPeriod = button.dataset.reportPeriod; renderSection(root, navigate); });
  bindOrderButtons(root, navigate);
}

function ordersView() {
  const visible = filteredAdminOrders();
  const activeFilter = orderSearch.trim() || orderFilter !== 'all' || customDate;
  const countText = activeFilter ? (visible.length ? `Найдено: ${visible.length}` : 'Ничего не найдено') : `Всего заявок: ${orders.length}`;
  const filters = [['all', 'Все'], ['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['dayafter', 'Послезавтра'], ['new', 'На подтверждение'], ['progress', 'Уборка началась'], ['confirmed', 'Подтверждённые'], ['completed', 'Завершённые'], ['cancelled', 'Отменённые']];
  return `<section class="hc-admin-search-panel card"><div class="ops-search hc-admin-search"><span class="hc-search-icon">⌕</span><input type="search" data-order-search value="${escapeHtml(orderSearch)}" placeholder="Номер, имя, телефон, адрес или услуга"><span class="hc-search-count">${escapeHtml(countText)}</span></div><div class="ops-filters hc-scroll-chips hc-admin-filter-chips">${filters.map(([id, label]) => `<button type="button" class="${orderFilter === id && !customDate ? 'active filter-${id}' : `filter-${id}`}" data-order-filter="${id}">${label}</button>`).join('')}</div><div class="hc-admin-date-filter"><label>Точная дата<input type="date" data-custom-date value="${escapeHtml(customDate)}"></label>${activeFilter ? '<button class="hc-btn hc-btn-ghost" type="button" data-reset-filter>Сбросить</button>' : ''}</div></section><div class="ops-order-list hc-admin-order-list">${visible.length ? visible.map(orderCard).join('') : '<div class="ops-empty card"><strong>Ничего не найдено</strong><span>Измените запрос или фильтр.</span></div>'}</div>`;
}

function filteredAdminOrders() {
  const dateByFilter = orderFilter === 'today' ? moscowIso(0) : orderFilter === 'tomorrow' ? moscowIso(1) : orderFilter === 'dayafter' ? moscowIso(2) : customDate || '';
  const statusMap = { new: ['NEW', 'REVIEW'], confirmed: ['CONFIRMED', 'CLEANER_ASSIGNED'], progress: ['IN_PROGRESS'], completed: ['COMPLETED'], cancelled: ['CANCELLED'] };
  const statuses = statusMap[orderFilter] || null;
  const query = orderSearch.trim().toLowerCase();
  return orders.filter((order) => {
    if (dateByFilter && order.date !== dateByFilter) return false;
    if (statuses && !statuses.includes(order.status)) return false;
    if (!query) return true;
    return [order.order_number, order.customer_name, order.phone, order.profile_phone2, order.address, order.city, order.profile_locality, order.profile_street, order.service_name, order.username, order.telegram_username]
      .some((value) => String(value || '').toLowerCase().includes(query));
  }).sort(sortOrders);
}

function sortOrders(a, b) {
  const priority = (order) => order.status === 'IN_PROGRESS' ? 0
    : PENDING.has(order.status) ? 1
      : ['CONFIRMED', 'CLEANER_ASSIGNED'].includes(order.status) ? 2
        : order.status === 'CANCELLED' ? 3
          : order.status === 'COMPLETED' ? 4 : 3;
  const diff = priority(a) - priority(b);
  if (diff) return diff;
  if (a.status === 'COMPLETED' && b.status === 'COMPLETED') return orderStart(b) - orderStart(a);
  return orderStart(a) - orderStart(b) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

function orderStart(order) {
  if (!order?.date) return Number.POSITIVE_INFINITY;
  const stamp = Date.parse(`${order.date}T${String(order.time || '00:00').slice(0, 5)}:00+03:00`);
  return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY;
}

function orderCard(order) {
  const status = publicStatus(order.status);
  const price = Number(order.estimated_price || 0);
  const photos = Math.max(Number(order.photo_count || 0), Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0);
  const badges = [];
  if (photos) badges.push(`Фото ${photos}`);
  if (Number(order.discount_percent || 0)) badges.push(`Скидка ${order.discount_percent}%`);
  if (order.comment) badges.push('Комментарий');
  if (String(order.discount_type || '').startsWith('referral')) badges.push('Реферал');
  return `<article class="ops-order-card card hc-admin-order-card status-${status.cls}"><div class="ops-order-head"><div><span>${escapeHtml(order.order_number || '')}</span><strong>${escapeHtml(order.customer_name || 'Клиент')}</strong></div><em class="status-${status.cls}">${escapeHtml(status.label)}</em></div><div class="ops-order-service">${escapeHtml(order.service_name || 'Уборка')}</div><div class="hc-admin-order-main"><div><span>Дата</span><strong>${escapeHtml(formatDate(order.date))} · ${escapeHtml(formatTime(order.time))}</strong></div><div><span>Площадь</span><strong>${escapeHtml(String(order.area || 0))} м²</strong></div><div><span>Телефон</span><strong>${escapeHtml(order.phone || '—')}</strong></div>${order.status !== 'COMPLETED' && price ? `<div><span>Предварительно</span><strong>от ${money(price)}</strong></div>` : ''}</div><div class="ops-order-line">${escapeHtml([order.city, order.address].filter(Boolean).join(', ') || 'Адрес не указан')}</div>${badges.length ? `<div class="hc-admin-badges">${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}</div>` : ''}<div class="ops-card-actions hc-admin-actions"><button class="hc-btn hc-btn-gold" type="button" data-open-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Открыть</button><button class="hc-btn hc-btn-blue" type="button" data-chat-client="${escapeHtml(order.client_telegram_id)}">✉️ Написать</button>${order.phone ? `<button class="hc-btn hc-btn-green" type="button" data-call="${escapeHtml(order.phone)}">📞 Позвонить</button>` : ''}${PENDING.has(order.status) ? `<button class="hc-btn hc-btn-green" type="button" data-confirm="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">✓ Подтвердить</button>` : ''}</div></article>`;
}

function bindOrders(root, navigate) {
  const input = root.querySelector('[data-order-search]');
  if (input) input.oninput = () => {
    orderSearch = input.value;
    renderSection(root, navigate);
    const next = root.querySelector('[data-order-search]');
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  };
  root.querySelectorAll('[data-order-filter]').forEach((button) => button.onclick = () => { customDate = ''; orderFilter = button.dataset.orderFilter; renderSection(root, navigate); });
  root.querySelector('[data-custom-date]')?.addEventListener('change', (event) => { customDate = event.target.value; orderFilter = customDate ? 'date' : 'all'; renderSection(root, navigate); });
  root.querySelector('[data-reset-filter]')?.addEventListener('click', () => { orderSearch = ''; customDate = ''; orderFilter = 'all'; renderSection(root, navigate); });
  bindOrderButtons(root, navigate);
}

function bindOrderButtons(root, navigate) {
  root.querySelectorAll('[data-open-order]').forEach((button) => button.onclick = () => {
    const order = findOrder(button.dataset.client, button.dataset.openOrder);
    if (order) renderOrderDetail(root, navigate, order);
  });
  root.querySelectorAll('[data-chat-client]').forEach((button) => button.onclick = () => openClientChat(button.dataset.chatClient));
  root.querySelectorAll('[data-call]').forEach((button) => button.onclick = () => callPhone(button.dataset.call));
  root.querySelectorAll('[data-template]').forEach((button) => button.onclick = async () => {
    const order = findOrder(button.dataset.client, button.dataset.order);
    if (order) await sendTemplate(button, order, button.dataset.template);
  });
  root.querySelectorAll('[data-confirm]').forEach((button) => button.onclick = async () => {
    const order = findOrder(button.dataset.client, button.dataset.confirm);
    if (!order) return;
    const approved = await modal({ title: 'Подтвердить заявку?', text: `${order.order_number} будет подтверждена.`, confirmText: 'Подтвердить', cancelText: 'Назад' });
    if (!approved) return;
    button.disabled = true;
    try {
      await api.adminSetStatus(order, 'CONFIRMED');
      await refreshOrders();
      showToast('Заявка подтверждена');
      renderSection(root, navigate);
    } catch (error) { button.disabled = false; showToast(error.message || 'Не удалось подтвердить', true); }
  });
}

async function renderOrderDetail(root, navigate, order) {
  const status = publicStatus(order.status);
  const photos = Math.max(Number(order.photo_count || 0), Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0);
  const price = Number(order.estimated_price || 0);
  root.innerHTML = `<div class="ops-detail-shell hc-admin-detail"><button class="ops-sticky-back hc-fixed-back" type="button" data-back>← Назад</button><header class="ops-detail-head hc-subpage-offset"><div><span>${escapeHtml(order.order_number || '')}</span><h1>${escapeHtml(order.customer_name || 'Клиент')}</h1></div><em class="status-${status.cls}">${escapeHtml(status.label)}</em></header>
    <div class="card ops-detail-card">${detail('Телефон', order.phone || '—')}${order.profile_phone2 ? detail('Доп. телефон', order.profile_phone2) : ''}${detail('Способ связи', contactMethod(order.contact_method) || 'Не выбран')}${detail('Уборка', order.service_name || '—')}${detail('Площадь', `${order.area || 0} м²`)}${detail('Дата', formatDate(order.date))}${detail('Время', formatTime(order.time))}${detail('Адрес', [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : ''].filter(Boolean).join(', '))}${detail('Доп. услуги', Array.isArray(order.addon_names) && order.addon_names.length ? order.addon_names.join(', ') : 'Нет')}${order.status !== 'COMPLETED' && price ? detail('Предварительная стоимость', `от ${money(price)}`) : ''}</div>
    <div class="hc-admin-contact-row"><button class="hc-btn hc-btn-blue" type="button" data-chat-client="${escapeHtml(order.client_telegram_id)}">✉️ Написать клиенту</button>${order.phone ? `<button class="hc-btn hc-btn-green" type="button" data-call="${escapeHtml(order.phone)}">📞 Позвонить</button>` : ''}</div>
    <div class="ops-title-row"><div><h2>Быстрые сообщения</h2><p>Готовые сообщения клиенту.</p></div></div><div class="ops-template-grid hc-template-grid"><button class="hc-btn hc-btn-gold" type="button" data-template="need_details">Уточнить детали</button><button class="hc-btn hc-btn-blue" type="button" data-template="need_photos">Попросить фото</button><button class="hc-btn hc-btn-green" type="button" data-template="reminder">Напомнить</button><button class="hc-btn hc-btn-blue" type="button" data-template="manager_callback">Связаться</button></div>
    <div class="card ops-admin-note"><label>Внутренняя заметка</label><textarea data-admin-note maxlength="1200" placeholder="Заметка видна только администраторам">${escapeHtml(order.admin_note || '')}</textarea><div><small>Клиент заметку не видит.</small><button class="hc-btn hc-btn-gold" type="button" data-save-note>Сохранить</button></div></div>
    <div class="ops-title-row"><div><h2>Фото объекта</h2><p>${photos ? `${photos} фото` : 'Нет фото'}</p></div></div><div class="admin-photo-grid" data-admin-photo-grid>${photos ? Array.from({ length: photos }, (_, index) => `<button type="button" class="admin-photo-tile loading" data-photo-index="${index}"><span>${index + 1}</span></button>`).join('') : '<div class="ops-empty card"><strong>Фото не прикреплены</strong></div>'}</div>
    <div class="card ops-status-box hc-status-box"><label>Статус заявки</label><select data-status>${statusOptions(order.status)}</select></div></div>`;

  root.querySelector('[data-back]').onclick = () => { section = 'orders'; renderSection(root, navigate); };
  root.querySelector('[data-chat-client]').onclick = () => openClientChat(order.client_telegram_id);
  root.querySelector('[data-call]')?.addEventListener('click', () => callPhone(order.phone));
  root.querySelectorAll('[data-template]').forEach((button) => button.onclick = () => sendTemplate(button, order, button.dataset.template));
  root.querySelector('[data-save-note]').onclick = async () => {
    const button = root.querySelector('[data-save-note]');
    button.disabled = true;
    try {
      const data = await postJson('/api/demo-admin-note', { client_telegram_id: order.client_telegram_id, order_number: order.order_number, note: root.querySelector('[data-admin-note]').value });
      order.admin_note = data?.order?.admin_note || '';
      showToast('Заметка сохранена');
    } catch (error) { showToast(error.message || 'Не удалось сохранить заметку', true); }
    finally { button.disabled = false; }
  };
  const select = root.querySelector('[data-status]');
  select.onchange = async () => {
    const next = select.value;
    const current = normalizedStatus(order.status);
    if (next === current) return;
    if (['CONFIRMED', 'CANCELLED', 'COMPLETED'].includes(next)) {
      const labels = { CONFIRMED: 'подтвердить', CANCELLED: 'отменить', COMPLETED: 'завершить' };
      const approved = await modal({ title: `Точно ${labels[next]} заявку?`, text: next === 'COMPLETED' ? 'Клиент получит одно сообщение о завершении с кнопками заявки и отзыва.' : 'Статус будет изменён сразу.', confirmText: 'Да', cancelText: 'Назад', danger: next === 'CANCELLED' });
      if (!approved) { select.value = current; return; }
    }
    select.disabled = true;
    try {
      await api.adminSetStatus(order, next);
      await refreshOrders();
      showToast('Статус обновлён');
      section = 'orders';
      renderSection(root, navigate);
    } catch (error) {
      select.disabled = false;
      select.value = current;
      showToast(error.message || 'Не удалось изменить статус', true);
    }
  };
  if (photos) loadPhotos(root, order, photos);
}

function normalizedStatus(status) { return status === 'CLEANER_ASSIGNED' ? 'CONFIRMED' : status; }
function statusOptions(currentRaw) {
  const current = normalizedStatus(currentRaw);
  return [['NEW', 'Новая'], ['REVIEW', 'На проверке'], ['CONFIRMED', 'Подтверждена'], ['IN_PROGRESS', 'Уборка началась'], ['COMPLETED', 'Завершена'], ['CANCELLED', 'Отменена']]
    .map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
}

function clientsView() {
  const query = clientSearch.trim().toLowerCase();
  const clients = aggregateClients(orders).filter((client) => !query || [client.name, client.phone, client.phone2, client.id].some((value) => String(value || '').toLowerCase().includes(query)))
    .sort((a, b) => b.completed - a.completed || b.orders.length - a.orders.length);
  const countText = query ? (clients.length ? `Найдено: ${clients.length}` : 'Ничего не найдено') : `Клиентов: ${clients.length}`;
  return `<div class="ops-search hc-admin-search hc-client-admin-search"><span class="hc-search-icon">⌕</span><input type="search" data-client-search value="${escapeHtml(clientSearch)}" placeholder="Имя, телефон или Telegram ID"><span class="hc-search-count">${escapeHtml(countText)}</span></div><div class="ops-client-list">${clients.length ? clients.map(clientCard).join('') : '<div class="ops-empty card"><strong>Клиенты не найдены</strong></div>'}</div>`;
}
function clientCard(client) {
  const discount = client.completed >= 10 ? 10 : client.completed >= 3 ? 5 : 0;
  return `<button class="ops-client-card card" type="button" data-client-card="${escapeHtml(client.id)}"><div class="ops-client-avatar">${escapeHtml((client.name || 'К').charAt(0).toUpperCase())}</div><span><strong>${escapeHtml(client.name || 'Клиент')}</strong><small>${escapeHtml(client.phone || '')}</small><em>${client.orders.length} ${plural(client.orders.length, 'заявка', 'заявки', 'заявок')} · ${client.completed} завершено</em></span><b>${discount ? `${discount}%` : '›'}</b></button>`;
}
function bindClients(root, navigate) {
  const input = root.querySelector('[data-client-search]');
  if (input) input.oninput = () => { clientSearch = input.value; renderSection(root, navigate); const next = root.querySelector('[data-client-search]'); if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); } };
  root.querySelectorAll('[data-client-card]').forEach((button) => button.onclick = () => {
    const client = aggregateClients(orders).find((item) => String(item.id) === String(button.dataset.clientCard));
    if (client) renderClientDetail(root, navigate, client);
  });
}
function renderClientDetail(root, navigate, client) {
  const discount = client.completed >= 10 ? 10 : client.completed >= 3 ? 5 : 0;
  root.innerHTML = `<div class="ops-detail-shell hc-admin-detail"><button class="ops-sticky-back hc-fixed-back" type="button" data-back>← Назад</button><header class="ops-detail-head hc-subpage-offset"><div><span>КАРТОЧКА КЛИЕНТА</span><h1>${escapeHtml(client.name || 'Клиент')}</h1></div></header><section class="ops-client-stats">${stat('Всего заявок', client.orders.length)}${stat('Завершено', client.completed, 'ok')}${stat('Отменено', client.cancelled, 'muted')}${stat('Скидка', `${discount}%`, discount ? 'attention' : '')}</section><div class="card ops-detail-card">${detail('Основной телефон', client.phone || '—')}${client.phone2 ? detail('Доп. телефон', client.phone2) : ''}${detail('Telegram ID', client.id)}</div><div class="hc-admin-contact-row"><button class="hc-btn hc-btn-blue" type="button" data-chat-client="${escapeHtml(client.id)}">✉️ Написать клиенту</button>${client.phone ? `<button class="hc-btn hc-btn-green" type="button" data-call="${escapeHtml(client.phone)}">📞 Позвонить</button>` : ''}</div><div class="ops-title-row"><div><h2>История</h2><p>Завершённые уборки находятся в конце.</p></div></div><div class="ops-order-list hc-admin-order-list">${client.orders.sort(sortOrders).map(orderCard).join('')}</div></div>`;
  root.querySelector('[data-back]').onclick = () => { section = 'clients'; renderSection(root, navigate); };
  bindOrderButtons(root, navigate);
}

function reviewsView() {
  const query = reviewSearch.trim().toLowerCase();
  let visible = reviews.filter((review) => {
    if (reviewRating !== 'all' && Number(review.rating) !== Number(reviewRating)) return false;
    if (reviewSort === 'positive' && Number(review.rating) < 4) return false;
    if (reviewSort === 'negative' && Number(review.rating) > 3) return false;
    if (!query) return true;
    return [review.customer_name, review.order_number, review.text].some((value) => String(value || '').toLowerCase().includes(query));
  });
  visible = visible.sort((a, b) => {
    if (reviewSort === 'oldest') return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    if (reviewSort === 'positive') return Number(b.rating || 0) - Number(a.rating || 0) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    if (reviewSort === 'negative') return Number(a.rating || 0) - Number(b.rating || 0) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  const average = reviews.length ? (reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length).toFixed(1) : '—';
  const countText = query || reviewRating !== 'all' || reviewSort !== 'newest' ? (visible.length ? `Найдено: ${visible.length}` : 'Ничего не найдено') : `Всего отзывов: ${reviews.length}`;
  return `<section class="ops-extra-stats"><div><span>Всего</span><strong>${reviews.length}</strong></div><div><span>Средняя оценка</span><strong>${average}${average !== '—' ? ' ★' : ''}</strong></div><div><span>Положительных</span><strong>${reviews.filter((r) => Number(r.rating) >= 4).length}</strong></div></section><section class="hc-review-controls card"><div class="ops-search hc-admin-search"><span class="hc-search-icon">⌕</span><input type="search" data-review-search value="${escapeHtml(reviewSearch)}" placeholder="Имя, заявка или текст отзыва"><span class="hc-search-count">${escapeHtml(countText)}</span></div><div class="hc-review-sort"><button class="${reviewSort === 'newest' ? 'active' : ''}" data-review-sort="newest">Сначала новые</button><button class="${reviewSort === 'oldest' ? 'active' : ''}" data-review-sort="oldest">Сначала старые</button><button class="${reviewSort === 'positive' ? 'active' : ''}" data-review-sort="positive">Положительные</button><button class="${reviewSort === 'negative' ? 'active' : ''}" data-review-sort="negative">Негативные</button></div><div class="ops-review-filters hc-scroll-chips">${['all', 5, 4, 3, 2, 1].map((value) => `<button type="button" class="${String(reviewRating) === String(value) ? 'active' : ''}" data-review-rating="${value}">${value === 'all' ? 'Все оценки' : `${value}★`}</button>`).join('')}</div></section><div class="ops-review-list">${visible.length ? visible.map(reviewCard).join('') : '<div class="ops-empty card"><strong>Отзывов по фильтру нет</strong></div>'}</div>`;
}
function reviewCard(review) {
  const rating = Math.max(1, Math.min(5, Number(review.rating || 0)));
  const count = Array.isArray(review.photo_file_ids) ? review.photo_file_ids.length : 0;
  return `<article class="card ops-review-card"><div class="ops-review-head"><div><strong>${'★'.repeat(rating)}<span>${'★'.repeat(5 - rating)}</span></strong><small>${escapeHtml(formatDateTime(review.created_at))}</small></div><b>${rating}/5</b></div><div class="ops-review-client"><strong>${escapeHtml(review.customer_name || 'Клиент')}</strong><span>${escapeHtml(review.order_number || '')}</span></div>${review.text ? `<p>${escapeHtml(review.text)}</p>` : '<p class="muted">Без текстового комментария</p>'}<div class="ops-review-photo-label">Фото: ${count ? count : 'нет'}</div>${count ? `<div class="ops-review-photos">${Array.from({ length: count }, (_, index) => `<button type="button" class="loading" data-review-photo data-user="${escapeHtml(review.client_telegram_id)}" data-order="${escapeHtml(review.order_number)}" data-index="${index}"><span>${index + 1}</span></button>`).join('')}</div>` : ''}</article>`;
}
function bindReviews(root, navigate) {
  const input = root.querySelector('[data-review-search]');
  if (input) input.oninput = () => { reviewSearch = input.value; renderSection(root, navigate); const next = root.querySelector('[data-review-search]'); if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); } };
  root.querySelectorAll('[data-review-sort]').forEach((button) => button.onclick = () => { reviewSort = button.dataset.reviewSort; renderSection(root, navigate); });
  root.querySelectorAll('[data-review-rating]').forEach((button) => button.onclick = () => { reviewRating = button.dataset.reviewRating; renderSection(root, navigate); });
  loadReviewPhotos(root);
}

async function loadReviewPhotos(root) {
  await Promise.all([...root.querySelectorAll('[data-review-photo]')].map(async (button) => {
    try {
      const query = new URLSearchParams({ user: button.dataset.user, order: button.dataset.order, index: button.dataset.index });
      const response = await fetch(`/api/demo-admin-review-photo?${query}`, { headers: headers() });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      button.classList.remove('loading');
      button.innerHTML = `<img src="${url}" alt="Фото к отзыву">`;
      button.onclick = () => openSinglePhoto(url);
    } catch { button.classList.remove('loading'); button.textContent = 'Недоступно'; }
  }));
}

function referralsView() {
  const query = referralSearch.trim().toLowerCase();
  const visible = referrals.filter((item) => !query || [item.inviter_name, item.friend_name, item.inviter_id, item.friend_id, item.friend_username].some((value) => String(value || '').toLowerCase().includes(query)));
  const completed = referrals.filter((item) => item.completed).length;
  return `<section class="ops-extra-stats four"><div><span>Перешли</span><strong>${referrals.length}</strong></div><div><span>Приняли условия</span><strong>${referrals.filter((item) => item.consent_accepted_at).length}</strong></div><div><span>Оформили</span><strong>${referrals.filter((item) => item.order_created).length}</strong></div><div><span>Завершили</span><strong>${completed}</strong></div></section><div class="ops-search hc-admin-search"><span class="hc-search-icon">⌕</span><input type="search" data-ref-search value="${escapeHtml(referralSearch)}" placeholder="Имя, Telegram ID или приглашавший"><span class="hc-search-count">${query ? (visible.length ? `Найдено: ${visible.length}` : 'Ничего не найдено') : `Всего: ${referrals.length}`}</span></div><div class="ops-ref-list">${visible.length ? visible.map(referralCard).join('') : '<div class="ops-empty card"><strong>Рефералы не найдены</strong></div>'}</div>`;
}
function referralCard(item) {
  const stages = [
    ['Перешёл по ссылке', true],
    ['Принял условия', Boolean(item.consent_accepted_at)],
    ['Оформил заявку', Boolean(item.order_created)],
    ['Заявка подтверждена', Boolean(item.order_confirmed)],
    ['Уборка завершена', Boolean(item.completed)],
    ['15% начислены', Boolean(item.inviter_rewarded)],
  ];
  return `<article class="card ops-ref-card"><div class="ops-ref-people"><div><span>Пригласил</span><strong>${escapeHtml(item.inviter_name || `ID ${item.inviter_id}`)}</strong></div><b>→</b><div><span>Друг</span><strong>${escapeHtml(item.friend_name || `ID ${item.friend_id}`)}</strong></div></div><div class="ops-ref-date">${escapeHtml(formatDateTime(item.registered_at || item.started_at))}</div><div class="ops-ref-steps">${stages.map(([label, done]) => `<div class="${done ? 'done' : ''}"><i>${done ? '✓' : '·'}</i><span>${escapeHtml(label)}</span></div>`).join('')}</div><div class="ops-ref-foot"><span>Доступно пригласившему</span><strong>${Number(item.inviter_rewards_available || 0)} × 15%</strong></div></article>`;
}
function bindReferrals(root, navigate) {
  const input = root.querySelector('[data-ref-search]');
  if (input) input.oninput = () => { referralSearch = input.value; renderSection(root, navigate); const next = root.querySelector('[data-ref-search]'); if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); } };
}

async function sendTemplate(button, order, template) {
  button.disabled = true;
  try { await postJson('/api/demo-admin-message', { client_telegram_id: order.client_telegram_id, order_number: order.order_number, template }); showToast('Сообщение отправлено'); }
  catch (error) { showToast(error.message || 'Не удалось отправить сообщение', true); }
  finally { button.disabled = false; }
}

function openClientChat(id) {
  if (!id) return showToast('Telegram ID клиента не найден', true);
  window.location.href = `tg://user?id=${encodeURIComponent(String(id))}`;
}
function callPhone(phone) {
  const clean = String(phone || '').replace(/[^+\d]/g, '');
  if (clean) window.location.href = `tel:${clean}`;
}

async function loadPhotos(root, order, count) {
  for (let index = 0; index < count; index += 1) {
    const tile = root.querySelector(`[data-photo-index="${index}"]`);
    if (!tile) continue;
    try {
      const query = new URLSearchParams({ user: String(order.client_telegram_id), order: String(order.order_number), index: String(index) });
      const response = await fetch(`/api/demo-admin-photo?${query}`, { headers: headers() });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      tile.classList.remove('loading');
      tile.innerHTML = `<img src="${url}" alt="Фото ${index + 1}"><span>${index + 1}</span>`;
      tile.onclick = () => openSinglePhoto(url);
    } catch { tile.classList.remove('loading'); tile.innerHTML = '<span>Недоступно</span>'; }
  }
}
function openSinglePhoto(url) {
  const overlay = document.createElement('div');
  overlay.className = 'admin-lightbox';
  overlay.innerHTML = `<div class="admin-lightbox-top"><button type="button">×</button></div><div class="admin-lightbox-stage"><img src="${url}" alt="Фото"></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('button').onclick = () => overlay.remove();
  overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
}

function aggregateClients(list) {
  const map = new Map();
  for (const order of list) {
    const id = String(order.client_telegram_id || '');
    if (!id) continue;
    if (!map.has(id)) map.set(id, { id, name: order.customer_name || 'Клиент', phone: order.phone || '', phone2: order.profile_phone2 || '', orders: [], completed: 0, cancelled: 0 });
    const client = map.get(id);
    client.orders.push(order);
    if (order.status === 'COMPLETED') client.completed += 1;
    if (order.status === 'CANCELLED') client.cancelled += 1;
    if (order.customer_name) client.name = order.customer_name;
    if (order.phone) client.phone = order.phone;
    if (order.profile_phone2) client.phone2 = order.profile_phone2;
  }
  return [...map.values()];
}

function detail(label, value) { return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? '—'))}</strong></div>`; }
function publicStatus(status) {
  if (PENDING.has(status)) return { label: 'На подтверждение', cls: 'pending' };
  if (['CONFIRMED', 'CLEANER_ASSIGNED'].includes(status)) return { label: 'Подтверждена', cls: 'confirmed' };
  if (status === 'IN_PROGRESS') return { label: 'Уборка началась', cls: 'progress' };
  if (status === 'COMPLETED') return { label: 'Завершена', cls: 'completed' };
  if (status === 'CANCELLED') return { label: 'Отменена', cls: 'cancelled' };
  return { label: 'Заявка', cls: 'neutral' };
}
function contactMethod(value) { return ({ telegram: 'Telegram', whatsapp: 'WhatsApp', max: 'MAX', call: 'Звонок' })[String(value || '').toLowerCase()] || ''; }
function findOrder(clientId, number) { return orders.find((order) => String(order.client_telegram_id) === String(clientId) && String(order.order_number) === String(number)); }
function ageMinutes(order) { const stamp = Date.parse(order.created_at || ''); return Number.isFinite(stamp) ? Math.max(0, Math.floor((Date.now() - stamp) / 60000)) : 0; }
function ageLabel(order) { const minutes = ageMinutes(order); return minutes >= 60 ? `${Math.floor(minutes / 60)} ч` : `${minutes} мин`; }
function moscowIso(offset = 0) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + offset * 86400000));
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function formatDateTime(value) { const date = new Date(value || ''); if (!Number.isFinite(date.getTime())) return '—'; return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date).replace(',', ' ·'); }
function plural(number, one, few, many) { const value = Math.abs(Number(number)) % 100; const digit = value % 10; if (value > 10 && value < 20) return many; if (digit === 1) return one; if (digit >= 2 && digit <= 4) return few; return many; }
function loading(text) { return `<div class="loading"><div><div class="spinner"></div>${escapeHtml(text)}</div></div>`; }
