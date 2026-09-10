import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatTime, STATUS_LABELS, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);

function icon(name) {
  const icons = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    calc: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h2M14 18h2"/></svg>',
    orders: '<svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M15 3v5h4M8.5 12h7M8.5 16h5"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.1-.6L4 20l1.5-4.1A7.3 7.3 0 0 1 4 11.5 7.6 7.6 0 0 1 12 4a7.6 7.6 0 0 1 8 7.5Z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.2 8.2-8 10-4.8-1.8-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  };
  return icons[name] || icons.plus;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function displayName() {
  const user = state.bootstrap?.user || {};
  return user.name || user.first_name || 'клиент';
}

function orderStamp(order) {
  if (!order?.date) return Number.POSITIVE_INFINITY;
  const time = String(order.time || '00:00').slice(0, 5);
  const stamp = Date.parse(`${order.date}T${time}:00+03:00`);
  return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY;
}

function nearestOrder(orders) {
  const now = Date.now() - 6 * 60 * 60 * 1000;
  const active = (orders || []).filter((order) => ACTIVE.has(order.status));
  const future = active.filter((order) => orderStamp(order) >= now).sort((a, b) => orderStamp(a) - orderStamp(b));
  return future[0] || active.sort((a, b) => orderStamp(a) - orderStamp(b))[0] || null;
}

async function loadOrders() {
  const local = await api.orders();
  const localOrders = Array.isArray(local?.orders) ? local.orders : [];
  try {
    const initData = window.Telegram?.WebApp?.initData || '';
    const response = await fetch('/api/demo-client-orders', { headers: { 'X-Telegram-Init-Data': initData } });
    if (!response.ok) return localOrders;
    const payload = await response.json();
    const stored = Array.isArray(payload?.orders) ? payload.orders : [];
    const byNumber = new Map(stored.map((item) => [String(item.order_number || ''), item]));
    return localOrders.map((item) => {
      const server = byNumber.get(String(item.order_number || ''));
      return server ? { ...item, ...server, id: item.id } : item;
    });
  } catch {
    return localOrders;
  }
}

function openManager() {
  const username = String(state.bootstrap?.config?.managerUsername || state.bootstrap?.config?.botUsername || '').replace(/^@/, '');
  if (!username) return showToast('Контакт администратора пока не настроен', true);
  const url = `https://t.me/${username}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

function startBooking(navigate) {
  state.draft.step = 1;
  state.saveDraft();
  navigate('booking');
}

function renderNearest(order, navigate) {
  if (!order) {
    return `
      <section class="card cc-empty-next">
        <span class="cc-kicker">Персональный сервис</span>
        <h3>Следующей уборки пока нет</h3>
        <p>Выберите удобный день — оформление новой заявки займёт всего несколько минут.</p>
      </section>
      <div class="cc-card-actions"><button class="primary-btn" type="button" data-new-order>Заказать уборку</button></div>`;
  }

  const status = STATUS_LABELS[order.status] || order.status || 'Заявка';
  const repeatSupported = typeof window.HCRepeatOrder === 'function';
  const address = [order.city, order.address].filter(Boolean).join(', ');
  return `
    <section class="card cc-next-card" data-nearest-order="${escapeHtml(order.id)}">
      <div class="cc-card-head"><span class="cc-next-label">Ближайшая уборка</span><span class="cc-status-pill">${escapeHtml(status)}</span></div>
      <div class="cc-next-date">${escapeHtml(formatDate(order.date))} <span class="cc-next-time">· ${escapeHtml(formatTime(order.time))}</span></div>
      <div class="cc-next-service">${escapeHtml(order.service_name || 'Уборка')}</div>
      <div class="cc-next-address">${escapeHtml(address || 'Адрес указан в заявке')}</div>
    </section>
    <div class="cc-card-actions">
      ${repeatSupported ? '<button class="secondary-btn" type="button" data-repeat-order>Повторить эту уборку</button>' : ''}
      <button class="primary-btn" type="button" data-new-order>Заказать уборку</button>
    </div>`;
}

function loyaltyOrCare(orders) {
  const user = state.bootstrap?.user || {};
  const level = user.loyalty_level || user.level || '';
  const discount = Number(user.discount_percent ?? user.discount ?? 0);
  if (level || discount > 0) {
    return `<div class="card cc-care-card"><div class="cc-care-icon">${icon('shield')}</div><div class="cc-care-copy"><strong>Ваш уровень${level ? ` · ${escapeHtml(level)}` : ''}</strong><span>${discount > 0 ? `Персональная скидка ${discount}%` : 'Ваши привилегии сохранены в профиле'}</span></div><span class="cc-care-arrow">›</span></div>`;
  }

  const completed = (orders || []).filter((order) => order.status === 'COMPLETED').length;
  return `<div class="card cc-care-card"><div class="cc-care-icon">${icon('pin')}</div><div class="cc-care-copy"><strong>Санкт-Петербург и Ленинградская область</strong><span>${completed ? `У вас уже ${completed} завершён${completed === 1 ? 'ная уборка' : 'ных уборок'}` : 'Работаем только в пределах нашего региона обслуживания'}</span></div><span class="cc-care-arrow">›</span></div>`;
}

export async function renderConciergeHome(root, navigate) {
  root.innerHTML = `
    <div class="cc-home">
      <header class="cc-greeting-row">
        <div><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1 class="cc-greeting">${escapeHtml(greeting())}, ${escapeHtml(displayName())}!</h1><p class="cc-greeting-sub">Ваша чистота — наша забота. Всё важное собрано здесь.</p></div>
        <div class="cc-monogram">HC</div>
      </header>
      <div class="card cc-empty-next"><div class="loading"><div><div class="spinner"></div>Проверяем ближайшую уборку...</div></div></div>
    </div>`;

  let orders = [];
  try { orders = await loadOrders(); } catch { orders = []; }
  if (!root.querySelector('.cc-home')) return;
  const order = nearestOrder(orders);

  root.innerHTML = `
    <div class="cc-home">
      <header class="cc-greeting-row">
        <div><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1 class="cc-greeting">${escapeHtml(greeting())}, ${escapeHtml(displayName())}!</h1><p class="cc-greeting-sub">Ваша чистота — наша забота. Всё важное собрано здесь.</p></div>
        <div class="cc-monogram">HC</div>
      </header>
      ${renderNearest(order, navigate)}
      <section class="cc-section">
        <div class="cc-section-head"><h2>Быстрые действия</h2><span>В один касание</span></div>
        <div class="cc-quick-grid">
          <button class="cc-quick" type="button" data-quick="new"><span class="cc-quick-icon">${icon('plus')}</span><div><strong>Новая заявка</strong><small>Оформить уборку</small></div></button>
          <button class="cc-quick" type="button" data-quick="calc"><span class="cc-quick-icon">${icon('calc')}</span><div><strong>Рассчитать стоимость</strong><small>По площади и услуге</small></div></button>
          <button class="cc-quick" type="button" data-quick="orders"><span class="cc-quick-icon">${icon('orders')}</span><div><strong>Мои заявки</strong><small>Статусы и детали</small></div></button>
          <button class="cc-quick" type="button" data-quick="chat"><span class="cc-quick-icon">${icon('chat')}</span><div><strong>Связаться с нами</strong><small>Помощь менеджера</small></div></button>
        </div>
      </section>
      <section class="cc-section">
        <div class="cc-section-head"><h2>Ваш сервис</h2><span>HOUSE CLEANING</span></div>
        ${loyaltyOrCare(orders)}
      </section>
    </div>`;

  root.querySelectorAll('[data-new-order], [data-quick="new"], [data-quick="calc"]').forEach((button) => {
    button.onclick = () => startBooking(navigate);
  });
  root.querySelector('[data-quick="orders"]')?.addEventListener('click', () => navigate('orders'));
  root.querySelector('[data-quick="chat"]')?.addEventListener('click', openManager);
  root.querySelector('[data-nearest-order]')?.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    if (order?.id) navigate('orders', { orderId: order.id });
  });
  root.querySelector('[data-repeat-order]')?.addEventListener('click', () => {
    try { window.HCRepeatOrder(order); } catch { showToast('Не удалось повторить уборку', true); }
  });
}
