import { api, canSelfCancel, hoursUntilOrder } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatTime, modal, money, STATUS_LABELS, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
let currentFilter = 'all';

function icon(name) {
  const icons = {
    calendar: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    area: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  };
  return icons[name] || icons.calendar;
}

function initDataHeaders() {
  return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
}

async function fetchStoredOrders() {
  try {
    const response = await fetch('/api/demo-client-orders', { headers: initDataHeaders() });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.orders) ? data.orders : [];
  } catch { return []; }
}

async function fetchStoredOrder(orderNumber) {
  try {
    const response = await fetch(`/api/demo-client-order?order=${encodeURIComponent(orderNumber)}`, { headers: initDataHeaders() });
    if (!response.ok) return null;
    const data = await response.json();
    return data.order || null;
  } catch { return null; }
}

function mergeWithStored(localOrders, storedOrders) {
  const byNumber = new Map(storedOrders.map((order) => [String(order.order_number || ''), order]));
  return localOrders.map((local) => {
    const stored = byNumber.get(String(local.order_number || ''));
    return stored ? { ...local, ...stored, id: local.id } : local;
  });
}

function clientPhotoUrl(orderNumber, index) {
  const query = new URLSearchParams({ order: String(orderNumber), index: String(index) });
  return `/api/demo-client-photo?${query.toString()}`;
}

function managerUsername() {
  return String(state.bootstrap?.config?.managerUsername || state.bootstrap?.config?.botUsername || '').replace(/^@/, '');
}

function openManager(order) {
  const username = managerUsername();
  if (!username) return showToast('Контакт менеджера пока не настроен', true);
  const number = order?.order_number || '';
  const url = `https://t.me/${username}?start=manager${number ? '_' + encodeURIComponent(number) : ''}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

function clientStatus(status) {
  if (status === 'CLEANER_ASSIGNED') return 'Подтверждена';
  if (status === 'IN_PROGRESS') return 'Уборка началась';
  return STATUS_LABELS[status] || status || 'Заявка';
}

function contactMethodLabel(value) {
  return ({ telegram: 'Telegram', whatsapp: 'WhatsApp', max: 'MAX', call: 'Звонок' })[String(value || '').toLowerCase()] || '';
}

function counts(orders) {
  return {
    all: orders.length,
    active: orders.filter((order) => ACTIVE.has(order.status)).length,
    completed: orders.filter((order) => order.status === 'COMPLETED').length,
  };
}

function filteredOrders(orders) {
  if (currentFilter === 'active') return orders.filter((order) => ACTIVE.has(order.status));
  if (currentFilter === 'completed') return orders.filter((order) => order.status === 'COMPLETED');
  return orders;
}

function orderPhotoCount(order) {
  return Math.max(Number(order.photo_count || 0), Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0);
}

function cardPhotos(order) {
  const count = orderPhotoCount(order);
  const available = Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0;
  const visible = Math.min(3, available);
  if (!count) return '';
  const extra = Math.max(0, count - visible);
  if (!visible) return `<div class="cc-photo-strip"><div class="cc-photo-more">+${count}</div></div>`;
  return `<div class="cc-photo-strip">${Array.from({ length: visible }, (_, index) => `<div class="cc-photo-tile"><img data-cc-card-photo data-order-number="${escapeHtml(order.order_number)}" data-photo-index="${index}" alt="Фото ${index + 1}"></div>`).join('')}${extra ? `<div class="cc-photo-more">+${extra}</div>` : ''}</div>`;
}

function orderCard(order) {
  const status = clientStatus(order.status);
  const address = [order.city, order.address].filter(Boolean).join(', ');
  const price = Number(order.estimated_price || 0);
  return `
    <article class="card cc-order-card" data-order-id="${escapeHtml(order.id)}">
      <div class="cc-order-topline"><span class="cc-order-number">${escapeHtml(order.order_number || `#${order.id}`)}</span><span class="cc-status-pill">${escapeHtml(status)}</span></div>
      <div class="cc-order-service">${escapeHtml(order.service_name || 'Уборка')}</div>
      <div class="cc-order-meta">
        <div class="cc-order-meta-row"><span class="cc-meta-icon">${icon('calendar')}</span><span>${escapeHtml(formatDate(order.date))} · ${escapeHtml(formatTime(order.time))}</span>${price > 0 ? `<span class="cc-order-price">от ${escapeHtml(money(price))}</span>` : ''}</div>
        <div class="cc-order-meta-row"><span class="cc-meta-icon">${icon('pin')}</span><span>${escapeHtml(address || 'Адрес указан в заявке')}</span></div>
        <div class="cc-order-meta-row"><span class="cc-meta-icon">${icon('area')}</span><span>${escapeHtml(String(order.area || 0))} м²</span></div>
      </div>
      ${cardPhotos(order)}
      <div class="cc-order-open"><span>Подробнее о заявке</span><span>›</span></div>
    </article>`;
}

async function loadCardPhotos(root) {
  await Promise.all([...root.querySelectorAll('[data-cc-card-photo]')].map(async (img) => {
    try {
      const response = await fetch(clientPhotoUrl(img.dataset.orderNumber, Number(img.dataset.photoIndex)), { headers: initDataHeaders() });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
    } catch { /* thumbnail is optional */ }
  }));
}

function renderList(root, navigate, orders) {
  const c = counts(orders);
  const visible = filteredOrders(orders);
  root.innerHTML = `
    <section class="cc-orders-head"><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1 class="page-title">Мои заявки</h1><p class="page-subtitle">Статусы, детали и фотографии для оценки.</p></section>
    <div class="cc-filter-row" role="tablist">
      <button class="cc-filter ${currentFilter === 'all' ? 'active' : ''}" type="button" data-filter="all">Все <b>${c.all}</b></button>
      <button class="cc-filter ${currentFilter === 'active' ? 'active' : ''}" type="button" data-filter="active">Активные <b>${c.active}</b></button>
      <button class="cc-filter ${currentFilter === 'completed' ? 'active' : ''}" type="button" data-filter="completed">Завершённые <b>${c.completed}</b></button>
    </div>
    <div class="cc-order-list">${visible.length ? visible.map(orderCard).join('') : '<div class="card cc-order-empty">В этом разделе пока нет заявок.</div>'}</div>`;

  root.querySelectorAll('[data-filter]').forEach((button) => button.onclick = () => {
    currentFilter = button.dataset.filter;
    renderList(root, navigate, orders);
    loadCardPhotos(root);
  });
  root.querySelectorAll('[data-order-id]').forEach((card) => card.onclick = () => navigate('orders', { orderId: Number(card.dataset.orderId) }));
  loadCardPhotos(root);
}

export async function renderConciergeOrders(root, navigate, params = {}) {
  if (params.orderId) return renderOrderDetails(root, navigate, params.orderId);
  root.innerHTML = `<section class="cc-orders-head"><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1 class="page-title">Мои заявки</h1><p class="page-subtitle">Загружаем вашу историю...</p></section><div class="loading"><div><div class="spinner"></div>Проверяем заявки...</div></div>`;
  try {
    const data = await api.orders();
    const stored = await fetchStoredOrders();
    const orders = mergeWithStored(data.orders || [], stored);
    renderList(root, navigate, orders);
  } catch (error) {
    root.innerHTML = `<section class="cc-orders-head"><h1 class="page-title">Мои заявки</h1></section><div class="card cc-order-empty">${escapeHtml(error.message || 'Не удалось загрузить заявки')}</div>`;
  }
}

function timeline(status) {
  const steps = ['Заявка создана', 'Подтверждена', 'Уборка началась', 'Завершена'];
  if (status === 'CANCELLED') return `<div class="cc-status-timeline cancelled"><div class="cc-cancelled-mark">×</div><div><strong>Заявка отменена</strong><span>Если нужна новая уборка, оформите новую заявку.</span></div></div>`;
  const index = status === 'COMPLETED' ? 3 : status === 'IN_PROGRESS' ? 2 : ['CONFIRMED', 'CLEANER_ASSIGNED'].includes(status) ? 1 : 0;
  return `<div class="cc-status-timeline"><div class="cc-timeline-line"><i style="width:${index === 0 ? 0 : Math.round(index / 3 * 100)}%"></i></div>${steps.map((label, step) => `<div class="cc-timeline-step ${step <= index ? 'done' : ''} ${step === index ? 'current' : ''}"><span>${step < index ? '✓' : step + 1}</span><small>${escapeHtml(label)}</small></div>`).join('')}</div>`;
}

async function renderOrderDetails(root, navigate, id) {
  try {
    const localData = await api.order(id);
    const stored = localData.order?.order_number ? await fetchStoredOrder(localData.order.order_number) : null;
    const order = stored ? { ...localData.order, ...stored, id: localData.order.id } : localData.order;
    const addons = (order.addon_ids || []).map((addonId) => (state.bootstrap?.services || []).find((item) => Number(item.id) === Number(addonId))).filter(Boolean);
    const availablePhotoCount = Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0;
    const totalPhotoCount = orderPhotoCount(order);
    const selfCancel = canSelfCancel(order);
    const hours = hoursUntilOrder(order);
    const urgent = ACTIVE.has(order.status) && Number.isFinite(hours) && hours < 24;
    const status = clientStatus(order.status);
    const price = Number(order.estimated_price || 0);
    const contactMethod = contactMethodLabel(order.contact_method || order.contactMethod);

    root.innerHTML = `
      <button class="cc-back" type="button" data-back>← Все заявки</button>
      <section class="cc-detail-head"><span class="cc-kicker">${escapeHtml(status)}</span><h1>${escapeHtml(order.order_number || `Заявка #${order.id}`)}</h1><p class="page-subtitle">${escapeHtml(order.service_name || 'Уборка')}</p></section>
      ${timeline(order.status)}
      <div class="card cc-detail-card">
        ${row('Адрес', [order.city, order.address].filter(Boolean).join(', '))}
        ${row('Площадь', `${order.area} м²`)}
        ${row('Дата', formatDate(order.date))}
        ${row('Время', formatTime(order.time))}
        ${row('Комнаты / санузлы', `${order.rooms ?? '—'} / ${order.bathrooms ?? '—'}`)}
        ${row('Доп. услуги', addons.length ? addons.map((item) => item.name).join(', ') : (order.addon_names?.join(', ') || 'Нет'))}
        ${price > 0 ? row('Предварительная стоимость', `от ${money(price)}`) : ''}
        ${row('Контакт', `${order.customer_name}, ${order.phone}`)}
        ${contactMethod ? row('Связаться через', contactMethod) : ''}
      </div>
      <div class="cc-policy-note">${selfCancel ? '<strong>Отмена:</strong> вы можете отменить заявку самостоятельно, пока до начала больше 24 часов.' : urgent ? '<strong>До уборки меньше 24 часов.</strong> Отмена и любые изменения теперь только через менеджера.' : '<strong>Изменения заявки</strong> выполняются через менеджера.'}</div>
      <div class="cc-gallery-title"><h2>Фото объекта</h2><span>${totalPhotoCount ? `${totalPhotoCount} фото` : 'Нет фото'}</span></div>
      <div class="cc-client-gallery">${availablePhotoCount ? Array.from({ length: availablePhotoCount }, (_, index) => `<button class="cc-client-photo" type="button" data-client-photo="${index}"><img alt="Фото ${index + 1}"><span>${index + 1}</span></button>`).join('') : `<div class="card cc-order-empty" style="grid-column:1/-1">${totalPhotoCount ? 'Фотографии этой старой заявки недоступны для восстановления.' : 'Фотографии не прикреплены.'}</div>`}</div>
      ${selfCancel ? '<button class="danger-btn" style="margin-top:16px" type="button" data-cancel>Отменить заявку</button>' : ''}
      ${ACTIVE.has(order.status) ? '<button class="secondary-btn" style="margin-top:10px" type="button" data-manager>Связаться с менеджером</button>' : ''}`;

    root.querySelector('[data-back]').onclick = () => navigate('orders');
    root.querySelector('[data-manager]')?.addEventListener('click', () => openManager(order));
    if (availablePhotoCount) await loadDetailPhotos(root, order.order_number, availablePhotoCount);

    const cancel = root.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = async () => {
      const approved = await modal({ title: 'Отменить уборку?', text: 'После отмены восстановить эту заявку нельзя.', confirmText: 'Отменить заявку', danger: true });
      if (!approved) return;
      try {
        cancel.disabled = true;
        await api.cancelOrder(id);
        showToast('Заявка отменена');
        renderConciergeOrders(root, navigate, { orderId: id });
      } catch (error) {
        cancel.disabled = false;
        showToast(error.message || 'Не удалось отменить заявку', true);
      }
    };
  } catch (error) {
    root.innerHTML = `<button class="cc-back" type="button" data-back>← Все заявки</button><div class="card cc-order-empty">${escapeHtml(error.message || 'Заявка не найдена')}</div>`;
    root.querySelector('[data-back]').onclick = () => navigate('orders');
  }
}

function row(label, value) {
  return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? '—'))}</strong></div>`;
}

async function loadDetailPhotos(root, orderNumber, count) {
  const urls = new Array(count).fill('');
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    const button = root.querySelector(`[data-client-photo="${index}"]`);
    const img = button?.querySelector('img');
    if (!button || !img) return;
    try {
      const response = await fetch(clientPhotoUrl(orderNumber, index), { headers: initDataHeaders() });
      if (!response.ok) throw new Error('Photo unavailable');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      urls[index] = url;
      img.src = url;
      button.onclick = () => openGallery(urls, index);
    } catch {
      button.innerHTML = '<span style="position:static;background:none;color:#8995a0">Недоступно</span>';
    }
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
  const image = overlay.querySelector('[data-image]');
  const counter = overlay.querySelector('[data-count]');
  const draw = () => { image.src = available[current].url; counter.textContent = `${current + 1} / ${available.length}`; };
  overlay.querySelector('[data-close]').onclick = () => overlay.remove();
  overlay.querySelector('[data-prev]').onclick = () => { current = (current - 1 + available.length) % available.length; draw(); };
  overlay.querySelector('[data-next]').onclick = () => { current = (current + 1) % available.length; draw(); };
  overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
  draw();
}