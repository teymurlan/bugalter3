import { api, canSelfCancel, hoursUntilOrder } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatTime, modal, money, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
const MANAGER_PHONE = '+79992107977';
let currentFilter = 'all';
let currentQuery = '';

function headers() { return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' }; }

async function fetchStoredOrders() {
  try {
    const response = await fetch('/api/demo-client-orders', { headers: headers() });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.orders) ? data.orders : [];
  } catch { return []; }
}

async function fetchStoredOrder(orderNumber) {
  try {
    const response = await fetch(`/api/demo-client-order?order=${encodeURIComponent(orderNumber)}`, { headers: headers() });
    if (!response.ok) return null;
    return (await response.json()).order || null;
  } catch { return null; }
}

function mergeOrders(localOrders, storedOrders) {
  const map = new Map();
  for (const item of [...localOrders, ...storedOrders]) {
    const key = String(item.order_number || item.id || '');
    const previous = map.get(key) || {};
    map.set(key, { ...previous, ...item, id: previous.id || item.id });
  }
  return [...map.values()].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function managerUsername() {
  return String(state.bootstrap?.config?.managerUsername || state.bootstrap?.config?.botUsername || '').replace(/^@/, '');
}
function openManager(order) {
  const username = managerUsername();
  if (!username) return showToast('Контакт менеджера пока не настроен', true);
  const number = order?.order_number || '';
  const url = `https://t.me/${username}${number ? `?start=manager_${encodeURIComponent(number)}` : ''}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank');
}
function callManager() { window.location.href = `tel:${MANAGER_PHONE}`; }

function statusInfo(status) {
  if (status === 'NEW' || status === 'REVIEW') return { label: 'На проверке', cls: 'pending' };
  if (status === 'CONFIRMED' || status === 'CLEANER_ASSIGNED') return { label: 'Подтверждена', cls: 'confirmed' };
  if (status === 'IN_PROGRESS') return { label: 'Уборка началась', cls: 'progress' };
  if (status === 'COMPLETED') return { label: 'Завершена', cls: 'completed' };
  if (status === 'CANCELLED') return { label: 'Отменена', cls: 'cancelled' };
  return { label: 'Заявка', cls: 'neutral' };
}

function contactMethodLabel(value) {
  return ({ telegram: 'Telegram', whatsapp: 'WhatsApp', max: 'MAX', call: 'Звонок' })[String(value || '').toLowerCase()] || 'Не выбран';
}

function filterMatch(order) {
  if (currentFilter === 'active' && !ACTIVE.has(order.status)) return false;
  if (currentFilter === 'pending' && !['NEW', 'REVIEW'].includes(order.status)) return false;
  if (currentFilter === 'confirmed' && !['CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS'].includes(order.status)) return false;
  if (currentFilter === 'completed' && order.status !== 'COMPLETED') return false;
  if (currentFilter === 'cancelled' && order.status !== 'CANCELLED') return false;
  const q = currentQuery.trim().toLowerCase();
  if (!q) return true;
  return [order.order_number, order.address, order.city, order.service_name, formatDate(order.date)].some((value) => String(value || '').toLowerCase().includes(q));
}

function filterCount(orders, id) {
  if (id === 'all') return orders.length;
  if (id === 'active') return orders.filter((o) => ACTIVE.has(o.status)).length;
  if (id === 'pending') return orders.filter((o) => ['NEW', 'REVIEW'].includes(o.status)).length;
  if (id === 'confirmed') return orders.filter((o) => ['CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS'].includes(o.status)).length;
  if (id === 'completed') return orders.filter((o) => o.status === 'COMPLETED').length;
  return orders.filter((o) => o.status === 'CANCELLED').length;
}

function whenLabel(order) {
  if (!order?.date) return '';
  const today = isoDay(0);
  const tomorrow = isoDay(1);
  if (order.date === today) return `Сегодня · ${formatTime(order.time)}`;
  if (order.date === tomorrow) return `Завтра · ${formatTime(order.time)}`;
  return `${formatDate(order.date)} · ${formatTime(order.time)}`;
}

function orderCard(order) {
  const status = statusInfo(order.status);
  const address = [order.city, order.address].filter(Boolean).join(', ');
  const price = Number(order.estimated_price || 0);
  return `<article class="card cc-order-card hc-order-card status-${status.cls}" data-order-id="${escapeHtml(order.id)}">
    <div class="cc-order-topline"><span class="cc-order-number">${escapeHtml(order.order_number || `#${order.id}`)}</span><span class="cc-status-pill hc-status ${status.cls}">${escapeHtml(status.label)}</span></div>
    <div class="cc-order-service">${escapeHtml(order.service_name || 'Уборка')}</div>
    <div class="hc-order-when">${escapeHtml(whenLabel(order))}</div>
    <div class="hc-order-address">${escapeHtml(address || 'Адрес указан в заявке')}</div>
    <div class="hc-order-footer"><span>${escapeHtml(String(order.area || 0))} м²</span>${price > 0 ? `<strong>от ${escapeHtml(money(price))}</strong>` : '<strong>После оценки</strong>'}</div>
    <button class="hc-btn hc-btn-blue hc-order-more" type="button" data-open>Подробнее</button>
  </article>`;
}

function renderList(root, navigate, orders) {
  const visible = orders.filter(filterMatch);
  const searchText = currentQuery.trim() ? (visible.length ? `Найдено: ${visible.length}` : 'Ничего не найдено') : `Всего заявок: ${orders.length}`;
  root.innerHTML = `<section class="cc-orders-head"><span class="cc-kicker">HOUSE CLEANING</span><h1 class="page-title">Мои заявки</h1><p class="page-subtitle">Следите за статусом и деталями ваших уборок.</p></section>
    <div class="hc-client-search"><input type="search" value="${escapeHtml(currentQuery)}" data-order-search placeholder="Найти заявку"><span data-search-count>${escapeHtml(searchText)}</span></div>
    <div class="cc-filter-row hc-scroll-chips" role="tablist">${[
      ['all','Все'],['active','Активные'],['pending','Ожидают'],['confirmed','Подтверждённые'],['completed','Завершённые'],['cancelled','Отменённые'],
    ].map(([id,label]) => `<button class="cc-filter ${currentFilter === id ? 'active' : ''}" type="button" data-filter="${id}">${label}<b>${filterCount(orders,id)}</b></button>`).join('')}</div>
    <div class="cc-order-list">${visible.length ? visible.map(orderCard).join('') : '<div class="card cc-order-empty">По текущему фильтру заявок нет.</div>'}</div>`;

  const input = root.querySelector('[data-order-search]');
  input.oninput = () => {
    currentQuery = input.value;
    renderList(root, navigate, orders);
    const next = root.querySelector('[data-order-search]');
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  };
  root.querySelectorAll('[data-filter]').forEach((button) => button.onclick = () => { currentFilter = button.dataset.filter; renderList(root, navigate, orders); });
  root.querySelectorAll('[data-order-id]').forEach((card) => {
    const open = () => navigate('orders', { orderId: Number(card.dataset.orderId) });
    card.querySelector('[data-open]').onclick = (event) => { event.stopPropagation(); open(); };
    card.onclick = (event) => { if (!event.target.closest('button')) open(); };
  });
}

export async function renderConciergeOrders(root, navigate, params = {}) {
  if (params.orderId) return renderOrderDetails(root, navigate, params.orderId);
  root.innerHTML = `<section class="cc-orders-head"><span class="cc-kicker">HOUSE CLEANING</span><h1 class="page-title">Мои заявки</h1><p class="page-subtitle">Загружаем заявки...</p></section><div class="loading"><div><div class="spinner"></div>Проверяем данные...</div></div>`;
  try {
    const [local, stored] = await Promise.all([api.orders(), fetchStoredOrders()]);
    renderList(root, navigate, mergeOrders(Array.isArray(local?.orders) ? local.orders : [], stored));
  } catch (error) {
    root.innerHTML = `<section class="cc-orders-head"><h1 class="page-title">Мои заявки</h1></section><div class="card cc-order-empty">${escapeHtml(error.message || 'Не удалось загрузить заявки')}</div>`;
  }
}

function timeline(status) {
  if (status === 'CANCELLED') return `<div class="cc-status-timeline cancelled"><div class="cc-cancelled-mark">×</div><div><strong>Заявка отменена</strong><span>При необходимости оформите новую уборку.</span></div></div>`;
  const steps = ['Заявка создана', 'Подтверждена', 'Уборка началась', 'Завершена'];
  const index = status === 'COMPLETED' ? 3 : status === 'IN_PROGRESS' ? 2 : ['CONFIRMED','CLEANER_ASSIGNED'].includes(status) ? 1 : 0;
  return `<div class="cc-status-timeline hc-timeline state-${statusInfo(status).cls}"><div class="cc-timeline-line"><i style="width:${index ? Math.round(index / 3 * 100) : 0}%"></i></div>${steps.map((label, step) => `<div class="cc-timeline-step ${step <= index ? 'done' : ''} ${step === index ? 'current' : ''}"><span>${step < index ? '✓' : step + 1}</span><small>${escapeHtml(label)}</small></div>`).join('')}</div>`;
}

async function renderOrderDetails(root, navigate, id) {
  try {
    const localData = await api.order(id);
    const stored = localData.order?.order_number ? await fetchStoredOrder(localData.order.order_number) : null;
    const order = stored ? { ...localData.order, ...stored, id: localData.order.id } : localData.order;
    const status = statusInfo(order.status);
    const addons = (order.addon_ids || []).map((addonId) => (state.bootstrap?.services || []).find((item) => Number(item.id) === Number(addonId))).filter(Boolean);
    const photoCount = Math.max(Number(order.photo_count || 0), Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0);
    const availablePhotos = Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0;
    const selfCancel = canSelfCancel(order);
    const hours = hoursUntilOrder(order);
    const urgent = ACTIVE.has(order.status) && Number.isFinite(hours) && hours < 24;
    const before = Number(order.price_before_discount || 0);
    const price = Number(order.estimated_price || 0);
    const discount = Number(order.discount_percent || 0);

    root.innerHTML = `<button class="cc-back hc-fixed-back" type="button" data-back>← Назад</button>
      <section class="cc-detail-head hc-subpage-offset"><span class="cc-kicker hc-status ${status.cls}">${escapeHtml(status.label)}</span><h1>${escapeHtml(order.order_number || `Заявка #${order.id}`)}</h1><p class="page-subtitle">${escapeHtml(order.service_name || 'Уборка')}</p></section>
      ${timeline(order.status)}
      <div class="hc-detail-sections">
        ${detailBlock('Дата и время', `${formatDate(order.date)} · ${formatTime(order.time)}`)}
        ${detailBlock('Адрес', [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : '', order.floor ? `этаж ${order.floor}` : '', order.entrance ? `парадная ${order.entrance}` : ''].filter(Boolean).join(', '))}
        ${detailBlock('Площадь', `${order.area || 0} м²`)}
        ${detailBlock('Дополнительные услуги', addons.length ? addons.map((item) => item.name).join(', ') : (order.addon_names?.join(', ') || 'Нет'))}
        ${detailBlock('Способ связи', contactMethodLabel(order.contact_method || order.contactMethod))}
        ${order.comment ? detailBlock('Комментарий', order.comment) : ''}
        ${price > 0 ? `<section class="card hc-detail-block"><small>Стоимость</small>${before > price && discount ? `<span>До скидки: ${escapeHtml(money(before))}</span><span>Скидка ${discount}%: −${escapeHtml(money(before - price))}</span>` : ''}<strong>Предварительно: от ${escapeHtml(money(price))}</strong></section>` : ''}
      </div>
      <div class="cc-policy-note">${selfCancel ? '<strong>Отмена доступна самостоятельно, пока до уборки не меньше 24 часов.</strong>' : urgent ? '<strong>До уборки меньше 24 часов.</strong> Изменения и отмена — через менеджера.' : '<strong>Изменить заявку можно через менеджера.</strong>'}</div>
      <div class="cc-gallery-title"><h2>Фото объекта</h2><span>${photoCount ? `${photoCount} фото` : 'Нет фото'}</span></div>
      <div class="cc-client-gallery">${availablePhotos ? Array.from({ length: availablePhotos }, (_, index) => `<button class="cc-client-photo" type="button" data-client-photo="${index}"><img alt="Фото ${index + 1}"><span>${index + 1}</span></button>`).join('') : `<div class="card cc-order-empty" style="grid-column:1/-1">${photoCount ? 'Фотографии этой старой заявки недоступны для восстановления.' : 'Фотографии не прикреплены.'}</div>`}</div>
      <div class="hc-order-actions">${selfCancel ? '<button class="hc-btn hc-btn-danger" type="button" data-cancel>Отменить заявку</button>' : ''}${ACTIVE.has(order.status) ? '<button class="hc-btn hc-btn-blue" type="button" data-manager>Написать менеджеру</button><button class="hc-btn hc-btn-green" type="button" data-call>Позвонить</button>' : ''}</div>`;

    root.querySelector('[data-back]').onclick = () => navigate('orders');
    root.querySelector('[data-manager]')?.addEventListener('click', () => openManager(order));
    root.querySelector('[data-call]')?.addEventListener('click', callManager);
    if (availablePhotos) await loadDetailPhotos(root, order.order_number, availablePhotos);
    const cancel = root.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = async () => {
      const approved = await modal({ title: 'Отменить уборку?', text: 'После отмены восстановить эту заявку нельзя.', confirmText: 'Отменить заявку', danger: true });
      if (!approved) return;
      try { cancel.disabled = true; await api.cancelOrder(id); showToast('Заявка отменена'); renderConciergeOrders(root, navigate, { orderId: id }); }
      catch (error) { cancel.disabled = false; showToast(error.message || 'Не удалось отменить заявку', true); }
    };
  } catch (error) {
    root.innerHTML = `<button class="cc-back hc-fixed-back" type="button" data-back>← Назад</button><div class="card cc-order-empty hc-subpage-offset">${escapeHtml(error.message || 'Заявка не найдена')}</div>`;
    root.querySelector('[data-back]').onclick = () => navigate('orders');
  }
}

function detailBlock(label, value) {
  return `<section class="card hc-detail-block"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value || '—'))}</strong></section>`;
}

function clientPhotoUrl(orderNumber, index) {
  const query = new URLSearchParams({ order: String(orderNumber), index: String(index) });
  return `/api/demo-client-photo?${query.toString()}`;
}

async function loadDetailPhotos(root, orderNumber, count) {
  const urls = new Array(count).fill('');
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    const button = root.querySelector(`[data-client-photo="${index}"]`);
    const img = button?.querySelector('img');
    if (!button || !img) return;
    try {
      const response = await fetch(clientPhotoUrl(orderNumber, index), { headers: headers() });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      urls[index] = url;
      img.src = url;
      button.onclick = () => openGallery(urls, index);
    } catch { button.innerHTML = '<span style="position:static;background:none;color:#8995a0">Недоступно</span>'; }
  }));
}

function openGallery(urls, startIndex) {
  const available = urls.map((url, index) => ({ url, index })).filter((item) => item.url);
  if (!available.length) return;
  let current = Math.max(0, available.findIndex((item) => item.index === startIndex));
  const overlay = document.createElement('div');
  overlay.className = 'cc-lightbox';
  overlay.innerHTML = `<div class="cc-lightbox-top"><button type="button" data-close>×</button><span data-count></span></div><button class="cc-lightbox-nav prev" type="button" data-prev>‹</button><div class="cc-lightbox-stage"><img data-image alt="Фото объекта"></div><button class="cc-lightbox-nav next" type="button" data-next>›</button>`;
  document.body.appendChild(overlay);
  const draw = () => { overlay.querySelector('[data-image]').src = available[current].url; overlay.querySelector('[data-count]').textContent = `${current + 1} / ${available.length}`; };
  overlay.querySelector('[data-close]').onclick = () => overlay.remove();
  overlay.querySelector('[data-prev]').onclick = () => { current = (current - 1 + available.length) % available.length; draw(); };
  overlay.querySelector('[data-next]').onclick = () => { current = (current + 1) % available.length; draw(); };
  overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
  draw();
}

function isoDay(offset) {
  const date = new Date(Date.now() + offset * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
