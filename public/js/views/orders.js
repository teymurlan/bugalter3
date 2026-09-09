import { api, canSelfCancel, hoursUntilOrder } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatTime, modal, STATUS_LABELS, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);

function initDataHeaders() {
  return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
}

async function fetchStoredOrders() {
  try {
    const response = await fetch('/api/demo-client-orders', { headers: initDataHeaders() });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.orders) ? data.orders : [];
  } catch {
    return [];
  }
}

async function fetchStoredOrder(orderNumber) {
  try {
    const response = await fetch(`/api/demo-client-order?order=${encodeURIComponent(orderNumber)}`, { headers: initDataHeaders() });
    if (!response.ok) return null;
    const data = await response.json();
    return data.order || null;
  } catch {
    return null;
  }
}

function mergeWithStored(localOrders, storedOrders) {
  const byNumber = new Map(storedOrders.map((order) => [String(order.order_number || ''), order]));
  return localOrders.map((local) => {
    const stored = byNumber.get(String(local.order_number || ''));
    return stored ? { ...local, ...stored, id: local.id } : local;
  });
}

export async function renderOrders(root, navigate, params = {}) {
  root.innerHTML = `<h1 class="page-title">Мои заявки</h1><p class="page-subtitle">Активные и завершённые уборки</p><div class="loading"><div><div class="spinner"></div>Загружаем заявки...</div></div>`;
  try {
    if (params.orderId) return renderOrderDetails(root, navigate, params.orderId);
    const data = await api.orders();
    const stored = await fetchStoredOrders();
    const orders = mergeWithStored(data.orders || [], stored);
    const active = orders.filter((order) => ACTIVE.has(order.status));
    const history = orders.filter((order) => !ACTIVE.has(order.status));
    root.innerHTML = `
      <h1 class="page-title">Мои заявки</h1><p class="page-subtitle">Здесь можно проверить статус, детали и условия отмены</p>
      ${section('Активные', active)}
      ${section('История', history)}`;
    bindCards(root, navigate);
    await loadOrderCardPhotos(root);
  } catch (error) {
    root.innerHTML = `<h1 class="page-title">Мои заявки</h1><div class="empty card" style="margin-top:20px">${escapeHtml(error.message || 'Не удалось загрузить заявки')}</div>`;
  }
}

function section(title, orders) {
  return `<div class="order-section-title"><h2 style="margin:0">${title}</h2><span class="badge-count">${orders.length}</span></div>
    ${orders.length ? orders.map(orderCard).join('') : `<div class="empty card">${title === 'Активные' ? 'Активных заявок пока нет' : 'История пока пустая'}</div>`}`;
}

function orderCard(order) {
  const hours = hoursUntilOrder(order);
  const cancelHint = ACTIVE.has(order.status) && Number.isFinite(hours)
    ? (hours >= 24 ? 'Самостоятельная отмена доступна до 24 часов до начала' : 'До начала меньше 24 часов — отмена через менеджера')
    : '';
  return `<article class="card order-card" data-order="${order.id}">
    <div class="order-top"><div><div class="order-name">${escapeHtml(order.customer_name)}</div><div class="profile-meta">${escapeHtml(order.order_number || '')}</div></div><span class="status ${order.status}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span></div>
    <div class="order-meta"><span>⌖ ${escapeHtml(`${order.city}, ${order.address}`)}</span><span>≡ ${escapeHtml(order.service_name)}</span><span>□ ${formatDate(order.date)} · ${escapeHtml(formatTime(order.time))}</span></div>
    ${cancelHint ? `<div class="profile-meta" style="margin:0 0 12px">${escapeHtml(cancelHint)}</div>` : ''}
    ${Number(order.photo_count || 0) ? cardPhotos(order) : ''}
    <button class="primary-btn" type="button">Открыть заявку</button>
  </article>`;
}

function cardPhotos(order) {
  const count = Math.max(Number(order.photo_count || 0), Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0);
  const available = Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0;
  const visible = Math.min(3, available);
  const extra = Math.max(0, count - visible);
  if (!visible) return `<div class="order-photos"><div class="order-more">${count ? `+${count}` : 'Фото'}</div></div>`;
  return `<div class="order-photos">${Array.from({ length: visible }, (_, index) => `<div class="order-mini-photo"><img data-card-photo data-order-number="${escapeHtml(order.order_number)}" data-photo-index="${index}" alt="Фото ${index + 1}"></div>`).join('')}${extra ? `<div class="order-more">+${extra}</div>` : ''}</div>`;
}

function clientPhotoUrl(orderNumber, index) {
  const query = new URLSearchParams({ order: String(orderNumber), index: String(index) });
  return `/api/demo-client-photo?${query.toString()}`;
}

async function loadOrderCardPhotos(root) {
  await Promise.all([...root.querySelectorAll('[data-card-photo]')].map(async (img) => {
    try {
      const response = await fetch(clientPhotoUrl(img.dataset.orderNumber, Number(img.dataset.photoIndex)), { headers: initDataHeaders() });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
    } catch { /* preview is optional */ }
  }));
}

function bindCards(root, navigate) {
  root.querySelectorAll('[data-order]').forEach((card) => card.onclick = () => navigate('orders', { orderId: Number(card.dataset.order) }));
}

function managerUsername() {
  return String(state.bootstrap?.config?.managerUsername || state.bootstrap?.config?.botUsername || '').replace(/^@/, '');
}

function openManager(order) {
  const username = managerUsername();
  if (!username) return showToast('Контакт менеджера пока не настроен', true);
  const orderNumber = order?.order_number || '';
  const url = `https://t.me/${username}?start=manager${orderNumber ? '_' + encodeURIComponent(orderNumber) : ''}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

function managerCard(order, urgent = false) {
  return `<div class="manager-card"><strong>${urgent ? 'Нужно отменить или изменить заказ?' : 'Есть вопрос по заказу?'}</strong><p>${urgent ? 'До уборки осталось меньше 24 часов. Самостоятельная отмена закрыта — напишите менеджеру, чтобы решить вопрос.' : 'Менеджер поможет изменить детали заявки, адрес, время или ответит на вопрос.'}</p><button type="button" class="manager-btn" data-manager>Связаться с менеджером</button></div>`;
}

async function renderOrderDetails(root, navigate, id) {
  try {
    const localData = await api.order(id);
    const stored = localData.order?.order_number ? await fetchStoredOrder(localData.order.order_number) : null;
    const order = stored ? { ...localData.order, ...stored, id: localData.order.id } : localData.order;
    const addons = (order.addon_ids || []).map((addonId) => (state.bootstrap?.services || []).find((item) => Number(item.id) === Number(addonId))).filter(Boolean);
    const photoCount = Math.max(Number(order.photo_count || 0), Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0);
    const availablePhotoCount = Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0;
    const selfCancel = canSelfCancel(order);
    const hours = hoursUntilOrder(order);
    const urgent = ACTIVE.has(order.status) && Number.isFinite(hours) && hours < 24;
    const showManager = ACTIVE.has(order.status);

    root.innerHTML = `
      <button class="secondary-btn" style="width:auto;min-height:44px;padding:10px 14px;margin-bottom:18px" data-back>← Назад</button>
      <h1 class="page-title">${escapeHtml(order.order_number || `Заявка #${order.id}`)}</h1>
      <p class="page-subtitle"><span class="status ${order.status}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span></p>
      <div class="card pad" style="margin-top:20px">
        ${row('Уборка', order.service_name)}
        ${row('Адрес', `${order.city}, ${order.address}`)}
        ${row('Площадь', `${order.area} м²`)}
        ${row('Дата', formatDate(order.date))}
        ${row('Время', formatTime(order.time))}
        ${row('Комнаты / санузлы', `${order.rooms} / ${order.bathrooms}`)}
        ${row('Доп. услуги', addons.length ? addons.map((item) => item.name).join(', ') : (order.addon_names?.join(', ') || 'Нет'))}
        ${row('Контакт', `${order.customer_name}, ${order.phone}`)}
      </div>
      <div class="cancel-policy"><strong>Отмена:</strong> заявку можно отменить самостоятельно не позднее чем за 24 часа до выбранного времени. Позже — только через менеджера.</div>
      <h2 class="section-title">Фото объекта</h2>
      <div class="photo-grid client-order-gallery">${availablePhotoCount ? Array.from({ length: availablePhotoCount }, (_, index) => `<button class="photo-thumb client-photo-thumb" type="button" data-client-photo="${index}"><img alt="Фото ${index + 1}"><span>${index + 1}</span></button>`).join('') : `<div class="empty card">${photoCount ? 'Фотографии этой заявки были созданы до включения серверного хранения и недоступны для восстановления.' : 'Фотографии не прикреплены'}</div>`}</div>
      ${selfCancel ? '<button class="danger-btn" style="margin-top:24px" data-cancel>Отменить заявку</button>' : ''}
      ${showManager ? managerCard(order, urgent) : ''}`;

    root.querySelector('[data-back]').onclick = () => navigate('orders');
    root.querySelector('[data-manager]')?.addEventListener('click', () => openManager(order));
    if (availablePhotoCount) await loadClientDetailPhotos(root, order.order_number, availablePhotoCount);

    const cancel = root.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = async () => {
      if (!await modal({ title: 'Отменить уборку?', text: 'Заявка будет отменена, а администратор сразу получит уведомление.', confirmText: 'Отменить заявку', danger: true })) return;
      try {
        cancel.disabled = true;
        await api.cancelOrder(id);
        showToast('Заявка отменена. Администратор уведомлён');
        renderOrders(root, navigate, { orderId: id });
      } catch (error) {
        cancel.disabled = false;
        showToast(error.message || 'Не удалось отменить заявку', true);
      }
    };
  } catch (error) {
    root.innerHTML = `<button class="secondary-btn" style="width:auto" data-back>← Назад</button><div class="empty card" style="margin-top:20px">${escapeHtml(error.message || 'Заявка не найдена')}</div>`;
    root.querySelector('[data-back]').onclick = () => navigate('orders');
  }
}

async function loadClientDetailPhotos(root, orderNumber, count) {
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
      button.onclick = () => openClientGallery(urls, index);
    } catch {
      button.classList.add('error');
      button.innerHTML = '<span>Фото недоступно</span>';
    }
  }));
}

function openClientGallery(urls, startIndex) {
  const available = urls.map((url, index) => ({ url, index })).filter((item) => item.url);
  if (!available.length) return;
  let current = Math.max(0, available.findIndex((item) => item.index === startIndex));
  const overlay = document.createElement('div');
  overlay.className = 'admin-lightbox client-lightbox';
  overlay.innerHTML = `<div class="admin-lightbox-top"><button type="button" data-close>×</button><span data-count></span></div><button type="button" class="admin-lightbox-nav prev" data-prev>‹</button><div class="admin-lightbox-stage"><img data-image alt="Фото объекта"></div><button type="button" class="admin-lightbox-nav next" data-next>›</button>`;
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

function row(label, value) {
  return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? '—'))}</strong></div>`;
}
