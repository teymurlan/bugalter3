import { api } from '../api.js';
import { escapeHtml, formatDate, modal, showToast, STATUS_LABELS } from '../utils.js';

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
    renderDashboard(root, navigate, orders, Boolean(data.demo));
  } catch (error) {
    root.innerHTML = `<h1 class="page-title">Заказы</h1><div class="empty card" style="margin-top:20px">${escapeHtml(error.message || 'Не удалось загрузить заказы')}</div>`;
  }
}

function renderDashboard(root, navigate, orders, isDemo) {
  const counts = Object.fromEntries(Object.entries(GROUPS).map(([key, group]) => [key, group.statuses ? orders.filter((o) => group.statuses.includes(o.status)).length : orders.length]));
  const filtered = filterOrders(orders);
  root.innerHTML = `
    <div class="admin-head"><div><span class="eyebrow">HOUSE CLEANING</span><h1 class="page-title admin-title">Заказы</h1><p class="page-subtitle">${orders.length} заявок в списке</p></div><button class="icon-btn" data-refresh title="Обновить">↻</button></div>
    ${isDemo ? '<div class="demo-banner"><strong>Демо-админка</strong><span>До подключения D1 здесь видны только заявки, сохранённые на этом устройстве. Telegram-уведомления админу уже могут работать отдельно.</span></div>' : ''}
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
  root.querySelector('[data-search]').oninput = (e) => { searchText = e.target.value; renderDashboard(root, navigate, orders, isDemo); const input = root.querySelector('[data-search]'); input?.focus(); input?.setSelectionRange(searchText.length, searchText.length); };
  root.querySelectorAll('[data-filter]').forEach((button) => button.onclick = () => { currentFilter = button.dataset.filter; renderDashboard(root, navigate, orders, isDemo); });
  root.querySelectorAll('[data-status-select]').forEach((select) => select.onchange = async () => {
    const id = Number(select.dataset.statusSelect);
    const order = orders.find((item) => Number(item.id) === id);
    const previous = order?.status;
    const nextStatus = select.value;

    if (!order || !previous || nextStatus === previous) return;

    if (nextStatus === 'CONFIRMED' || nextStatus === 'CANCELLED') {
      const isCancel = nextStatus === 'CANCELLED';
      const approved = await modal({
        title: isCancel ? 'Точно отменить заявку?' : 'Точно подтвердить заявку?',
        text: isCancel
          ? `${order.order_number || 'Эта заявка'} будет отменена. Клиент сразу получит уведомление об отмене.`
          : `${order.order_number || 'Эта заявка'} будет подтверждена. Клиент сразу получит уведомление о подтверждении.`,
        confirmText: isCancel ? 'Да, отменить' : 'Да, подтвердить',
        cancelText: isCancel ? 'Нет, оставить заявку' : 'Нет, вернуться',
        danger: isCancel,
      });

      if (!approved) {
        select.value = previous;
        return;
      }
    }

    try {
      select.disabled = true;
      await api.adminSetStatus(id, nextStatus);
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

function adminCard(order) {
  return `<article class="card admin-order status-border-${order.status}">
    <div class="order-top"><div><div class="order-number">${escapeHtml(order.order_number || `#${order.id}`)}</div><div class="order-name">${escapeHtml(order.customer_name || 'Клиент')}</div></div><span class="status ${order.status}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span></div>
    <div class="admin-order-grid">
      <div><small>Уборка</small><strong>${escapeHtml(order.service_name || '—')}</strong></div>
      <div><small>Площадь</small><strong>${escapeHtml(String(order.area || 0))} м²</strong></div>
      <div><small>Дата</small><strong>${escapeHtml(formatDate(order.date))}</strong></div>
      <div><small>Время</small><strong>${escapeHtml(order.time || '—')}</strong></div>
    </div>
    <div class="admin-address">⌖ ${escapeHtml(`${order.city || ''}, ${order.address || ''}`)}</div>
    <div class="admin-contact">${escapeHtml(order.phone || '')}</div>
    <div class="field floating compact"><select class="select" data-status-select="${order.id}" data-label="Статус заказа">${statusOptions(order.status)}</select><label>Статус заказа</label></div>
  </article>`;
}

function statusOptions(current) {
  return [
    ['NEW','Новая'], ['REVIEW','На подтверждении'], ['CONFIRMED','Подтверждена'], ['CLEANER_ASSIGNED','Клинер назначен'], ['IN_PROGRESS','В работе'], ['COMPLETED','Завершена'], ['CANCELLED','Отменена'],
  ].map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
}
