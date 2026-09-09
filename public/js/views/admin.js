import { api } from '../api.js';
import { escapeHtml, formatDate, formatTime, modal, showToast, STATUS_LABELS } from '../utils.js';

const GROUPS = {
  all: { label: 'Все', statuses: null },
  new: { label: 'Новые', statuses: ['NEW'] },
  waiting: { label: 'Ожидают', statuses: ['REVIEW'] },
  active: { label: 'Активные', statuses: ['CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS'] },
  completed: { label: 'Завершённые', statuses: ['COMPLETED'] },
  cancelled: { label: 'Отменённые', statuses: ['CANCELLED'] },
};

let currentFilter = 'all';
let searchText = '';

export async function renderAdmin(root, navigate) {
  root.innerHTML = `<div class="admin-head"><div><span class="eyebrow">HOUSE CLEANING</span><h1 class="page-title admin-title">Заказы</h1><p class="page-subtitle">Панель администратора</p></div><button class="icon-btn" data-refresh title="Обновить">↻</button></div><div class="loading"><div><div class="spinner"></div>Загружаем заявки...</div></div>`;
  try {
    const data = await api.adminOrders();
    const orders = data.orders || [];
    renderDashboard(root, navigate, orders);
  } catch (error) {
    root.innerHTML = `<h1 class="page-title">Заказы</h1><div class="empty card" style="margin-top:20px">${escapeHtml(error.message || 'Не удалось загрузить заказы')}</div>`;
  }
}

function renderDashboard(root, navigate, orders) {
  const counts = Object.fromEntries(Object.entries(GROUPS).map(([key, group]) => [key, group.statuses ? orders.filter((o) => group.statuses.includes(o.status)).length : orders.length]));
  const filtered = filterOrders(orders);
  root.innerHTML = `
    <div class="admin-head"><div><span class="eyebrow">HOUSE CLEANING</span><h1 class="page-title admin-title">Заказы</h1><p class="page-subtitle">${orders.length} заявок в списке</p></div><button class="icon-btn" data-refresh title="Обновить">↻</button></div>
    <div class="admin-stats">
      <div class="mini-stat new"><b>${counts.new}</b><span>Новые</span></div>
      <div class="mini-stat waiting"><b>${counts.waiting}</b><span>Ожидают</span></div>
      <div class="mini-stat active"><b>${counts.active}</b><span>Активные</span></div>
      <div class="mini-stat completed"><b>${counts.completed}</b><span>Готово</span></div>
    </div>
    <div class="field floating admin-search"><input class="input" data-search data-label="Поиск заказов" value="${escapeHtml(searchText)}" placeholder=" "><label>Поиск по клиенту, адресу или номеру</label></div>
    <div class="filter-scroll">${Object.entries(GROUPS).map(([key, group]) => `<button type="button" class="filter-chip ${currentFilter === key ? 'active' : ''}" data-filter="${key}">${group.label}<span>${counts[key]}</span></button>`).join('')}</div>
    <div class="admin-list">${filtered.length ? filtered.map(adminCard).join('') : '<div class="empty card">По выбранному фильтру заявок нет</div>'}</div>`;

  root.querySelector('[data-refresh]').onclick = () => renderAdmin(root, navigate);
  root.querySelector('[data-search]').oninput = (event) => {
    searchText = event.target.value;
    renderDashboard(root, navigate, orders);
    const input = root.querySelector('[data-search]');
    input?.focus();
    input?.setSelectionRange(searchText.length, searchText.length);
  };
  root.querySelectorAll('[data-filter]').forEach((button) => button.onclick = () => {
    currentFilter = button.dataset.filter;
    renderDashboard(root, navigate, orders);
  });
  root.querySelectorAll('[data-open-order]').forEach((button) => button.onclick = () => {
    const order = findOrder(orders, button.dataset.clientId, button.dataset.openOrder);
    if (order) renderAdminOrder(root, navigate, order, orders);
  });
  root.querySelectorAll('[data-status-select]').forEach((select) => select.onchange = async () => {
    const order = findOrder(orders, select.dataset.clientId, select.dataset.orderNumber);
    const previous = order?.status;
    const nextStatus = select.value;
    if (!order || !previous || nextStatus === previous) return;

    if (nextStatus === 'CONFIRMED' || nextStatus === 'CANCELLED') {
      const isCancel = nextStatus === 'CANCELLED';
      const approved = await modal({
        title: isCancel ? 'Точно отменить заявку?' : 'Точно подтвердить заявку?',
        text: isCancel
          ? `${order.order_number} будет отменена. Клиент сразу получит уведомление.`
          : `${order.order_number} будет подтверждена. Клиент сразу получит уведомление.`,
        confirmText: isCancel ? 'Да, отменить' : 'Да, подтвердить',
        cancelText: isCancel ? 'Нет, оставить заявку' : 'Нет, вернуться',
        danger: isCancel,
      });
      if (!approved) { select.value = previous; return; }
    }

    try {
      select.disabled = true;
      await api.adminSetStatus(order, nextStatus);
      showToast(nextStatus === 'CONFIRMED' ? 'Заявка подтверждена' : nextStatus === 'CANCELLED' ? 'Заявка отменена' : 'Статус обновлён');
      renderAdmin(root, navigate);
    } catch (error) {
      select.value = previous;
      select.disabled = false;
      showToast(error.message || 'Не удалось изменить статус', true);
    }
  });
}

function filterOrders(orders) {
  const group = GROUPS[currentFilter];
  const q = searchText.trim().toLowerCase();
  return orders.filter((order) => {
    if (group?.statuses && !group.statuses.includes(order.status)) return false;
    if (!q) return true;
    return [order.order_number, order.customer_name, order.address, order.city, order.phone, order.service_name].some((value) => String(value || '').toLowerCase().includes(q));
  });
}

function findOrder(orders, clientId, number) {
  return orders.find((item) => String(item.client_telegram_id) === String(clientId) && String(item.order_number) === String(number));
}

function adminCard(order) {
  const price = Number(order.estimated_price || 0);
  const photos = Number(order.photo_count || order.photo_file_ids?.length || 0);
  return `<article class="card admin-order status-border-${order.status}">
    <div class="order-top"><div><div class="order-number">${escapeHtml(order.order_number || `#${order.id}`)}</div><div class="order-name">${escapeHtml(order.customer_name || 'Клиент')}</div></div><span class="status ${order.status}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span></div>
    <div class="admin-order-grid">
      <div><small>Уборка</small><strong>${escapeHtml(order.service_name || '—')}</strong></div>
      <div><small>Площадь</small><strong>${escapeHtml(String(order.area || 0))} м²</strong></div>
      <div><small>Дата</small><strong>${escapeHtml(formatDate(order.date))}</strong></div>
      <div><small>Время</small><strong>${escapeHtml(formatTime(order.time))}</strong></div>
    </div>
    <div class="admin-price-line"><span>Предварительная стоимость</span><strong>${price > 0 ? `от ${escapeHtml(new Intl.NumberFormat('ru-RU').format(price))} ₽` : 'Рассчитает менеджер'}</strong></div>
    <div class="admin-address">⌖ ${escapeHtml(`${order.city || ''}, ${order.address || ''}`)}</div>
    <div class="admin-contact">${escapeHtml(order.phone || '')}</div>
    <div class="admin-photo-count">Фото объекта: <b>${photos}</b></div>
    <button class="secondary-btn admin-open-btn" type="button" data-open-order="${escapeHtml(order.order_number)}" data-client-id="${escapeHtml(order.client_telegram_id)}">Открыть заявку</button>
    <div class="field floating compact"><select class="select" data-status-select data-order-number="${escapeHtml(order.order_number)}" data-client-id="${escapeHtml(order.client_telegram_id)}" data-label="Статус заказа">${statusOptions(order.status)}</select><label>Статус заказа</label></div>
  </article>`;
}

function renderAdminOrder(root, navigate, order, orders) {
  const price = Number(order.estimated_price || 0);
  const count = Math.max(Number(order.photo_count || 0), Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0);
  root.innerHTML = `
    <button class="secondary-btn" style="width:auto;min-height:44px;padding:10px 14px;margin-bottom:18px" data-back>← Назад</button>
    <div class="admin-detail-head"><div><span class="eyebrow">HOUSE CLEANING</span><h1 class="page-title admin-detail-title">${escapeHtml(order.order_number)}</h1></div><span class="status ${order.status}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span></div>
    <div class="card pad admin-detail-card">
      ${detailRow('Клиент', order.customer_name)}
      ${detailRow('Телефон', order.phone)}
      ${detailRow('Уборка', order.service_name)}
      ${detailRow('Площадь', `${order.area} м²`)}
      ${detailRow('Дата', formatDate(order.date))}
      ${detailRow('Время', formatTime(order.time))}
      ${detailRow('Адрес', [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : ''].filter(Boolean).join(', '))}
      ${detailRow('Комнаты / санузлы', `${order.rooms ?? '—'} / ${order.bathrooms ?? '—'}`)}
      ${detailRow('Доп. услуги', Array.isArray(order.addon_names) && order.addon_names.length ? order.addon_names.join(', ') : 'Нет')}
    </div>
    <div class="card pad admin-detail-price"><span>Предварительная стоимость</span><strong>${price > 0 ? `от ${new Intl.NumberFormat('ru-RU').format(price)} ₽` : 'Рассчитает менеджер'}</strong><small>Точная стоимость подтверждается после оценки объекта и фотографий.</small></div>
    <div class="admin-gallery-head"><h2 class="section-title">Фото объекта</h2><span>${count}</span></div>
    <div class="admin-photo-grid" data-admin-photo-grid>${count ? Array.from({ length: count }, (_, index) => `<button type="button" class="admin-photo-tile loading" data-photo-index="${index}" aria-label="Фото ${index + 1}"><span>${index + 1}</span></button>`).join('') : '<div class="empty card">Фотографии не прикреплены</div>'}</div>
    <div class="field floating compact" style="margin-top:20px"><select class="select" data-detail-status data-label="Статус заказа">${statusOptions(order.status)}</select><label>Статус заказа</label></div>`;

  root.querySelector('[data-back]').onclick = () => renderDashboard(root, navigate, orders);
  const select = root.querySelector('[data-detail-status]');
  if (select) select.onchange = async () => {
    const nextStatus = select.value;
    if (nextStatus === order.status) return;
    if (nextStatus === 'CONFIRMED' || nextStatus === 'CANCELLED') {
      const cancel = nextStatus === 'CANCELLED';
      const approved = await modal({
        title: cancel ? 'Точно отменить заявку?' : 'Точно подтвердить заявку?',
        text: cancel ? 'Клиент сразу получит уведомление об отмене.' : 'Клиент сразу получит уведомление о подтверждении.',
        confirmText: cancel ? 'Да, отменить' : 'Да, подтвердить',
        cancelText: 'Нет, вернуться',
        danger: cancel,
      });
      if (!approved) { select.value = order.status; return; }
    }
    try {
      select.disabled = true;
      await api.adminSetStatus(order, nextStatus);
      showToast('Статус обновлён');
      renderAdmin(root, navigate);
    } catch (error) {
      select.disabled = false;
      select.value = order.status;
      showToast(error.message || 'Не удалось изменить статус', true);
    }
  };

  if (count) loadAdminPhotos(root, order, count);
}

function detailRow(label, value) {
  return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? '—'))}</strong></div>`;
}

async function loadAdminPhotos(root, order, count) {
  const initData = window.Telegram?.WebApp?.initData || '';
  const urls = new Array(count).fill('');
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    const tile = root.querySelector(`[data-photo-index="${index}"]`);
    if (!tile) return;
    try {
      const query = new URLSearchParams({ user: String(order.client_telegram_id), order: String(order.order_number), index: String(index) });
      const response = await fetch(`/api/demo-admin-photo?${query.toString()}`, { headers: { 'X-Telegram-Init-Data': initData } });
      if (!response.ok) throw new Error('Фото недоступно');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      urls[index] = url;
      tile.classList.remove('loading');
      tile.innerHTML = `<img src="${url}" alt="Фото объекта ${index + 1}"><span>${index + 1}</span>`;
      tile.onclick = () => openGallery(urls, index);
    } catch {
      tile.classList.remove('loading');
      tile.classList.add('error');
      tile.innerHTML = '<span>Нет фото</span>';
    }
  }));
}

function openGallery(urls, startIndex) {
  const available = urls.map((url, index) => ({ url, index })).filter((item) => item.url);
  if (!available.length) return;
  let current = Math.max(0, available.findIndex((item) => item.index === startIndex));

  const overlay = document.createElement('div');
  overlay.className = 'admin-lightbox';
  overlay.innerHTML = `
    <div class="admin-lightbox-top"><button type="button" data-close>×</button><span data-count></span></div>
    <button type="button" class="admin-lightbox-nav prev" data-prev>‹</button>
    <div class="admin-lightbox-stage"><img data-image alt="Фото объекта"></div>
    <button type="button" class="admin-lightbox-nav next" data-next>›</button>`;
  document.body.appendChild(overlay);

  const image = overlay.querySelector('[data-image]');
  const counter = overlay.querySelector('[data-count]');
  const draw = () => {
    image.src = available[current].url;
    counter.textContent = `${current + 1} / ${available.length}`;
    overlay.querySelector('[data-prev]').disabled = available.length < 2;
    overlay.querySelector('[data-next]').disabled = available.length < 2;
  };
  overlay.querySelector('[data-close]').onclick = () => overlay.remove();
  overlay.querySelector('[data-prev]').onclick = () => { current = (current - 1 + available.length) % available.length; draw(); };
  overlay.querySelector('[data-next]').onclick = () => { current = (current + 1) % available.length; draw(); };
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  draw();
}

function statusOptions(current) {
  return [
    ['NEW','Новая'], ['REVIEW','На подтверждении'], ['CONFIRMED','Подтверждена'], ['CLEANER_ASSIGNED','Клинер назначен'], ['IN_PROGRESS','В работе'], ['COMPLETED','Завершена'], ['CANCELLED','Отменена'],
  ].map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
}
