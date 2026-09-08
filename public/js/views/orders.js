import { api, canSelfCancel, hoursUntilOrder } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, modal, STATUS_LABELS, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);

export async function renderOrders(root, navigate, params = {}) {
  root.innerHTML = `<h1 class="page-title">Мои заявки</h1><p class="page-subtitle">Активные и завершённые уборки</p><div class="loading"><div><div class="spinner"></div>Загружаем заявки...</div></div>`;
  try {
    if (params.orderId) return renderOrderDetails(root, navigate, params.orderId);
    const data = await api.orders();
    const active = data.orders.filter((order) => ACTIVE.has(order.status));
    const history = data.orders.filter((order) => !ACTIVE.has(order.status));
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
    <div class="order-meta"><span>⌖ ${escapeHtml(`${order.city}, ${order.address}`)}</span><span>≡ ${escapeHtml(order.service_name)}</span><span>□ ${formatDate(order.date)} · ${escapeHtml(order.time)}</span></div>
    ${cancelHint ? `<div class="profile-meta" style="margin:0 0 12px">${escapeHtml(cancelHint)}</div>` : ''}
    ${order.photo_count ? cardPhotos(order) : ''}
    <button class="primary-btn" type="button">Открыть заявку</button>
  </article>`;
}

function cardPhotos(order) {
  const ids = String(order.photo_ids || '').split(',').filter(Boolean);
  const visible = ids.slice(0, 3);
  const extra = Math.max(0, Number(order.photo_count || 0) - visible.length);
  return `<div class="order-photos">${visible.map((id) => `<div class="order-mini-photo"><img data-card-photo data-order-id="${order.id}" data-photo-id="${id}" alt=""></div>`).join('')}${extra ? `<div class="order-more">+${extra}</div>` : ''}</div>`;
}

async function loadOrderCardPhotos(root) {
  const initData = window.Telegram?.WebApp?.initData || '';
  await Promise.all([...root.querySelectorAll('[data-card-photo]')].map(async (img) => {
    try {
      const response = await fetch(api.photoUrl(img.dataset.orderId, img.dataset.photoId), { headers: { 'X-Telegram-Init-Data': initData } });
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
    const data = await api.order(id);
    const order = data.order;
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
        ${row('Время', order.time)}
        ${row('Комнаты / санузлы', `${order.rooms} / ${order.bathrooms}`)}
        ${row('Доп. услуги', data.addons.length ? data.addons.map((item) => item.name).join(', ') : 'Нет')}
        ${row('Контакт', `${order.customer_name}, ${order.phone}`)}
      </div>
      <div class="cancel-policy"><strong>Отмена:</strong> заявку можно отменить самостоятельно не позднее чем за 24 часа до выбранного времени. Позже — только через менеджера.</div>
      <h2 class="section-title">Фото объекта</h2>
      <div class="photo-grid">${data.photos.map((photo, index) => `<div class="photo-thumb"><img data-protected-photo="${photo.id}" alt="Фото ${index + 1}"></div>`).join('') || '<div class="empty card">Фото сохранены в черновике этого устройства</div>'}</div>
      ${selfCancel ? '<button class="danger-btn" style="margin-top:24px" data-cancel>Отменить заявку</button>' : ''}
      ${showManager ? managerCard(order, urgent) : ''}`;

    root.querySelector('[data-back]').onclick = () => navigate('orders');
    root.querySelector('[data-manager]')?.addEventListener('click', () => openManager(order));
    await loadProtectedPhotos(root, id);

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

async function loadProtectedPhotos(root, orderId) {
  const initData = window.Telegram?.WebApp?.initData || '';
  await Promise.all([...root.querySelectorAll('[data-protected-photo]')].map(async (img) => {
    try {
      const response = await fetch(api.photoUrl(orderId, img.dataset.protectedPhoto), { headers: { 'X-Telegram-Init-Data': initData } });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
    } catch { /* preview is non-critical */ }
  }));
}

function row(label, value) {
  return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? '—'))}</strong></div>`;
}
