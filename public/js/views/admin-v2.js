import { api } from '../api.js';
import { escapeHtml, formatDate, formatTime, modal, showToast, STATUS_LABELS } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
const PENDING = new Set(['NEW', 'REVIEW']);
const CAPACITY = 300;
const STATUS_GROUPS = {
  all: null,
  new: ['NEW', 'REVIEW'],
  confirmed: ['CONFIRMED', 'CLEANER_ASSIGNED'],
  progress: ['IN_PROGRESS'],
  completed: ['COMPLETED'],
  cancelled: ['CANCELLED'],
};

let section = 'overview';
let filter = 'all';
let query = '';
let cache = [];

export async function renderAdmin(root, navigate) {
  document.body.classList.add('admin-ops-mode');
  root.innerHTML = loading('Загружаем рабочий центр...');
  try {
    const data = await api.adminOrders();
    cache = Array.isArray(data?.orders) ? data.orders : [];
    renderSection(root, navigate);
  } catch (error) {
    root.innerHTML = `<div class="ops-error"><h2>Не удалось открыть панель</h2><p>${escapeHtml(error.message || 'Ошибка')}</p><button class="primary-btn" data-retry>Повторить</button></div>`;
    root.querySelector('[data-retry]').onclick = () => renderAdmin(root, navigate);
  }
}

function renderSection(root, navigate) {
  const content = section === 'orders'
    ? ordersView()
    : section === 'clients'
      ? clientsView()
      : overviewView();

  root.innerHTML = `
    <div class="ops-shell">
      <header class="ops-header">
        <div><span class="ops-kicker">HOUSE CLEANING · ADMIN</span><h1>${sectionTitle()}</h1><p>${sectionSubtitle()}</p></div>
        <button class="ops-refresh" type="button" data-refresh aria-label="Обновить">↻</button>
      </header>
      <main class="ops-content">${content}</main>
      ${adminNav()}
    </div>`;

  bindCommon(root, navigate);
  if (section === 'overview') bindOverview(root, navigate);
  if (section === 'orders') bindOrders(root, navigate);
  if (section === 'clients') bindClients(root, navigate);
}

function sectionTitle() {
  if (section === 'orders') return 'Заказы';
  if (section === 'clients') return 'Клиенты';
  return 'Рабочий центр';
}
function sectionSubtitle() {
  if (section === 'orders') return 'Все заявки, статусы и быстрые действия.';
  if (section === 'clients') return 'История и активность постоянных клиентов.';
  return 'Только то, что требует внимания сегодня.';
}

function adminNav() {
  const items = [
    ['overview', '⌂', 'Обзор'],
    ['orders', '▤', 'Заказы'],
    ['clients', '◎', 'Клиенты'],
  ];
  return `<nav class="ops-nav" aria-label="Навигация администратора">${items.map(([id, icon, label]) => `<button type="button" class="${section === id ? 'active' : ''}" data-admin-section="${id}"><span>${icon}</span><small>${label}</small></button>`).join('')}</nav>`;
}

function bindCommon(root, navigate) {
  root.querySelector('[data-refresh]').onclick = () => renderAdmin(root, navigate);
  root.querySelectorAll('[data-admin-section]').forEach((button) => button.onclick = () => {
    section = button.dataset.adminSection;
    renderSection(root, navigate);
  });
}

function overviewView() {
  const today = moscowIso(0);
  const tomorrow = moscowIso(1);
  const todayOrders = cache.filter((o) => o.date === today && o.status !== 'CANCELLED');
  const tomorrowOrders = cache.filter((o) => o.date === tomorrow && o.status !== 'CANCELLED');
  const used = todayOrders.filter((o) => ACTIVE.has(o.status)).reduce((sum, o) => sum + Number(o.area || 0), 0);
  const urgent = cache.filter((o) => PENDING.has(o.status) && ageMinutes(o) >= 30).sort((a, b) => ageMinutes(b) - ageMinutes(a));
  const todayPending = todayOrders.filter((o) => PENDING.has(o.status));
  const completedToday = todayOrders.filter((o) => o.status === 'COMPLETED').length;
  const cancelledToday = cache.filter((o) => o.date === today && o.status === 'CANCELLED').length;
  const attention = uniqueOrders([...todayPending, ...urgent]).slice(0, 8);

  return `
    <section class="ops-stats">
      ${stat('Нужно ответить', attention.length, attention.length ? 'attention' : 'ok')}
      ${stat('Сегодня', todayOrders.length, '')}
      ${stat('Завершено', completedToday, 'ok')}
      ${stat('Отменено', cancelledToday, cancelledToday ? 'muted' : '')}
    </section>

    <section class="ops-capacity card">
      <div class="ops-section-row"><div><span>Загрузка сегодня</span><strong>${used} / ${CAPACITY} м²</strong></div><b>${Math.min(100, Math.round((used / CAPACITY) * 100))}%</b></div>
      <div class="ops-capacity-track"><i style="width:${Math.min(100, Math.round((used / CAPACITY) * 100))}%"></i></div>
      <small>${used >= CAPACITY ? 'Лимит дня заполнен.' : `Свободно ещё ${Math.max(0, CAPACITY - used)} м².`}</small>
    </section>

    <div class="ops-title-row"><div><h2>Требует внимания</h2><p>Заявки, которые лучше не оставлять на потом.</p></div><span>${attention.length}</span></div>
    <section class="ops-attention-list">
      ${attention.length ? attention.map(attentionCard).join('') : '<div class="ops-empty card"><strong>Сейчас всё спокойно</strong><span>Нет заявок, которые требуют срочного ответа.</span></div>'}
    </section>

    <div class="ops-title-row"><div><h2>Сегодня</h2><p>Расписание по времени.</p></div><span>${todayOrders.length}</span></div>
    <section class="ops-today-list">
      ${todayOrders.length ? todayOrders.sort(byTime).map(scheduleRow).join('') : '<div class="ops-empty card"><strong>На сегодня уборок нет</strong></div>'}
    </section>

    ${tomorrowOrders.length ? `<div class="ops-tomorrow card"><span>Завтра</span><strong>${tomorrowOrders.length} ${plural(tomorrowOrders.length, 'уборка', 'уборки', 'уборок')}</strong><button type="button" data-go-orders>Посмотреть</button></div>` : ''}
  `;
}

function stat(label, value, cls) {
  return `<div class="ops-stat ${cls || ''}"><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong></div>`;
}

function attentionCard(order) {
  const wait = ageMinutes(order);
  return `<article class="ops-attention card">
    <div class="ops-attention-top"><div><span>${escapeHtml(order.order_number || '')}</span><strong>${escapeHtml(order.customer_name || 'Клиент')}</strong></div><b>${wait >= 60 ? `${Math.floor(wait / 60)} ч` : `${wait} мин`}</b></div>
    <div class="ops-mini-meta">${escapeHtml(order.service_name || 'Уборка')} · ${escapeHtml(String(order.area || 0))} м² · ${escapeHtml(formatDate(order.date))} ${escapeHtml(formatTime(order.time))}</div>
    <div class="ops-quick-actions">
      <button type="button" data-open-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Открыть</button>
      <button type="button" data-template="manager_callback" data-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Напомнить</button>
      ${order.status === 'NEW' || order.status === 'REVIEW' ? `<button class="gold" type="button" data-confirm="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Подтвердить</button>` : ''}
    </div>
  </article>`;
}

function scheduleRow(order) {
  return `<button class="ops-schedule-row card" type="button" data-open-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">
    <time>${escapeHtml(formatTime(order.time))}</time>
    <span><strong>${escapeHtml(order.customer_name || 'Клиент')}</strong><small>${escapeHtml(order.service_name || 'Уборка')} · ${escapeHtml(String(order.area || 0))} м²</small></span>
    <em class="${String(order.status || '').toLowerCase()}">${escapeHtml(publicStatus(order.status))}</em>
  </button>`;
}

function bindOverview(root, navigate) {
  root.querySelector('[data-go-orders]')?.addEventListener('click', () => { section = 'orders'; renderSection(root, navigate); });
  bindOrderButtons(root, navigate);
}

function ordersView() {
  const counts = Object.fromEntries(Object.keys(STATUS_GROUPS).map((key) => [key, filterByStatus(cache, key).length]));
  const visible = filterByStatus(cache, filter).filter(matchesQuery).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return `
    <div class="ops-search"><input type="search" data-order-search value="${escapeHtml(query)}" placeholder="Имя, телефон, адрес или номер заявки"></div>
    <div class="ops-filters">
      ${[
        ['all', 'Все'], ['new', 'Новые'], ['confirmed', 'Подтверждённые'], ['progress', 'В работе'], ['completed', 'Завершённые'], ['cancelled', 'Отменённые'],
      ].map(([id, label]) => `<button type="button" class="${filter === id ? 'active' : ''}" data-order-filter="${id}">${label}<b>${counts[id]}</b></button>`).join('')}
    </div>
    <div class="ops-order-list">${visible.length ? visible.map(orderCard).join('') : '<div class="ops-empty card"><strong>Ничего не найдено</strong></div>'}</div>
  `;
}

function orderCard(order) {
  const price = Number(order.estimated_price || 0);
  const photos = Math.max(Number(order.photo_count || 0), Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0);
  const method = contactMethod(order.contact_method);
  return `<article class="ops-order-card card">
    <div class="ops-order-head"><div><span>${escapeHtml(order.order_number || '')}</span><strong>${escapeHtml(order.customer_name || 'Клиент')}</strong></div><em class="${String(order.status || '').toLowerCase()}">${escapeHtml(publicStatus(order.status))}</em></div>
    <div class="ops-order-grid">
      <div><span>Дата</span><strong>${escapeHtml(formatDate(order.date))} · ${escapeHtml(formatTime(order.time))}</strong></div>
      <div><span>Площадь</span><strong>${escapeHtml(String(order.area || 0))} м²</strong></div>
      <div><span>Стоимость</span><strong>${price ? `от ${money(price)}` : 'После оценки'}</strong></div>
      <div><span>Фото</span><strong>${photos}</strong></div>
    </div>
    <div class="ops-order-line">${escapeHtml([order.city, order.address].filter(Boolean).join(', ') || 'Адрес не указан')}</div>
    ${method ? `<div class="ops-order-line subtle">Связаться: <b>${escapeHtml(method)}</b></div>` : ''}
    ${order.admin_note ? `<div class="ops-note-preview">${escapeHtml(order.admin_note)}</div>` : ''}
    <div class="ops-card-actions">
      <button type="button" data-open-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Открыть</button>
      <button type="button" data-template="reminder" data-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Напомнить</button>
      <button type="button" data-chat-client="${escapeHtml(order.client_telegram_id)}">Написать</button>
    </div>
  </article>`;
}

function bindOrders(root, navigate) {
  const search = root.querySelector('[data-order-search]');
  if (search) search.oninput = () => {
    query = search.value;
    const pos = search.selectionStart;
    renderSection(root, navigate);
    const next = root.querySelector('[data-order-search]');
    next?.focus();
    next?.setSelectionRange(pos, pos);
  };
  root.querySelectorAll('[data-order-filter]').forEach((button) => button.onclick = () => { filter = button.dataset.orderFilter; renderSection(root, navigate); });
  bindOrderButtons(root, navigate);
}

function bindOrderButtons(root, navigate) {
  root.querySelectorAll('[data-open-order]').forEach((button) => button.onclick = () => {
    const order = findOrder(button.dataset.client, button.dataset.openOrder);
    if (order) renderOrderDetail(root, navigate, order);
  });
  root.querySelectorAll('[data-template]').forEach((button) => button.onclick = async () => {
    const order = findOrder(button.dataset.client, button.dataset.order);
    if (!order) return;
    await sendTemplate(button, order, button.dataset.template);
  });
  root.querySelectorAll('[data-confirm]').forEach((button) => button.onclick = async () => {
    const order = findOrder(button.dataset.client, button.dataset.confirm);
    if (!order) return;
    const ok = await modal({ title: 'Подтвердить заявку?', text: `${order.order_number} будет подтверждена. Клиент получит уведомление.`, confirmText: 'Да, подтвердить', cancelText: 'Отмена' });
    if (!ok) return;
    button.disabled = true;
    try { await api.adminSetStatus(order, 'CONFIRMED'); showToast('Заявка подтверждена'); await renderAdmin(root, navigate); }
    catch (error) { button.disabled = false; showToast(error.message || 'Не удалось подтвердить', true); }
  });
  root.querySelectorAll('[data-chat-client]').forEach((button) => button.onclick = () => openClientChat(button.dataset.chatClient));
}

async function renderOrderDetail(root, navigate, order) {
  const photos = Math.max(Number(order.photo_count || 0), Array.isArray(order.photo_file_ids) ? order.photo_file_ids.length : 0);
  const price = Number(order.estimated_price || 0);
  root.innerHTML = `
    <div class="ops-detail-shell">
      <button class="ops-sticky-back" type="button" data-back>← Заказы</button>
      <header class="ops-detail-head"><div><span>${escapeHtml(order.order_number || '')}</span><h1>${escapeHtml(order.customer_name || 'Клиент')}</h1></div><em class="${String(order.status || '').toLowerCase()}">${escapeHtml(publicStatus(order.status))}</em></header>
      <div class="card ops-detail-card">
        ${detail('Телефон', order.phone || '—')}
        ${detail('Способ связи', contactMethod(order.contact_method) || 'Не выбран')}
        ${detail('Уборка', order.service_name || '—')}
        ${detail('Площадь', `${order.area || 0} м²`)}
        ${detail('Дата', formatDate(order.date))}
        ${detail('Время', formatTime(order.time))}
        ${detail('Адрес', [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : ''].filter(Boolean).join(', '))}
        ${detail('Доп. услуги', Array.isArray(order.addon_names) && order.addon_names.length ? order.addon_names.join(', ') : 'Нет')}
        ${detail('Предварительная стоимость', price ? `от ${money(price)}` : 'После оценки')}
      </div>

      <div class="ops-title-row"><div><h2>Быстрые сообщения</h2><p>Одно нажатие — клиент получает готовый текст от бота.</p></div></div>
      <div class="ops-template-grid">
        <button type="button" data-template="need_details">Уточнить детали</button>
        <button type="button" data-template="need_photos">Попросить фото</button>
        <button type="button" data-template="reminder">Напомнить об уборке</button>
        <button type="button" data-template="manager_callback">Попросить связаться</button>
      </div>

      <div class="card ops-admin-note">
        <label>Внутренняя заметка</label>
        <textarea data-admin-note maxlength="1200" placeholder="Например: домофон не работает, звонить за 10 минут">${escapeHtml(order.admin_note || '')}</textarea>
        <div><small>Клиент эту заметку не видит.</small><button type="button" data-save-note>Сохранить</button></div>
      </div>

      <div class="ops-title-row"><div><h2>Фото объекта</h2><p>${photos} ${plural(photos, 'фото', 'фото', 'фото')}</p></div></div>
      <div class="admin-photo-grid" data-admin-photo-grid>${photos ? Array.from({ length: photos }, (_, i) => `<button type="button" class="admin-photo-tile loading" data-photo-index="${i}"><span>${i + 1}</span></button>`).join('') : '<div class="ops-empty card"><strong>Фото не прикреплены</strong></div>'}</div>

      <div class="card ops-status-box">
        <label>Статус заявки</label>
        <select data-status>${statusOptions(order.status)}</select>
      </div>
      <button class="ops-contact-client" type="button" data-chat-client="${escapeHtml(order.client_telegram_id)}">Написать клиенту в Telegram</button>
    </div>`;

  root.querySelector('[data-back]').onclick = () => { section = 'orders'; renderSection(root, navigate); };
  root.querySelectorAll('[data-template]').forEach((button) => button.onclick = () => sendTemplate(button, order, button.dataset.template));
  root.querySelector('[data-chat-client]').onclick = () => openClientChat(order.client_telegram_id);
  root.querySelector('[data-save-note]').onclick = async () => {
    const button = root.querySelector('[data-save-note]');
    const note = root.querySelector('[data-admin-note]').value;
    button.disabled = true;
    try {
      const data = await adminPost('/api/demo-admin-note', { client_telegram_id: order.client_telegram_id, order_number: order.order_number, note });
      order.admin_note = data?.order?.admin_note ?? note;
      const cached = findOrder(order.client_telegram_id, order.order_number);
      if (cached) cached.admin_note = order.admin_note;
      showToast('Заметка сохранена');
    } catch (error) { showToast(error.message || 'Не удалось сохранить заметку', true); }
    finally { button.disabled = false; }
  };
  const select = root.querySelector('[data-status]');
  select.onchange = async () => {
    const next = select.value;
    if (next === order.status) return;
    if (next === 'CONFIRMED' || next === 'CANCELLED') {
      const cancel = next === 'CANCELLED';
      const ok = await modal({ title: cancel ? 'Точно отменить заявку?' : 'Точно подтвердить заявку?', text: cancel ? 'Клиент сразу получит уведомление об отмене.' : 'Клиент сразу получит уведомление о подтверждении.', confirmText: cancel ? 'Да, отменить' : 'Да, подтвердить', cancelText: 'Назад', danger: cancel });
      if (!ok) { select.value = order.status; return; }
    }
    select.disabled = true;
    try { await api.adminSetStatus(order, next); order.status = next; showToast('Статус обновлён'); await renderAdmin(root, navigate); }
    catch (error) { select.value = order.status; select.disabled = false; showToast(error.message || 'Не удалось изменить статус', true); }
  };
  if (photos) loadPhotos(root, order, photos);
}

function clientsView() {
  const clients = aggregateClients(cache).sort((a, b) => b.completed - a.completed || b.orders.length - a.orders.length);
  return `<div class="ops-client-list">${clients.length ? clients.map(clientCard).join('') : '<div class="ops-empty card"><strong>Клиентов пока нет</strong></div>'}</div>`;
}

function clientCard(client) {
  const discount = client.completed >= 10 ? 10 : client.completed >= 3 ? 5 : 0;
  return `<button class="ops-client-card card" type="button" data-client-card="${escapeHtml(client.id)}">
    <div class="ops-client-avatar">${escapeHtml((client.name || 'К').charAt(0).toUpperCase())}</div>
    <span><strong>${escapeHtml(client.name || 'Клиент')}</strong><small>${escapeHtml(client.phone || '')}</small><em>${client.orders.length} ${plural(client.orders.length, 'заявка', 'заявки', 'заявок')} · ${client.completed} завершено</em></span>
    <b>${discount ? `${discount}%` : '›'}</b>
  </button>`;
}

function bindClients(root, navigate) {
  root.querySelectorAll('[data-client-card]').forEach((button) => button.onclick = () => {
    const client = aggregateClients(cache).find((item) => String(item.id) === String(button.dataset.clientCard));
    if (client) renderClientDetail(root, navigate, client);
  });
}

function renderClientDetail(root, navigate, client) {
  const discount = client.completed >= 10 ? 10 : client.completed >= 3 ? 5 : 0;
  const nextTarget = client.completed < 3 ? 3 : client.completed < 10 ? 10 : 10;
  const remaining = Math.max(0, nextTarget - client.completed);
  root.innerHTML = `
    <div class="ops-detail-shell">
      <button class="ops-sticky-back" type="button" data-back>← Клиенты</button>
      <header class="ops-detail-head"><div><span>КАРТОЧКА КЛИЕНТА</span><h1>${escapeHtml(client.name || 'Клиент')}</h1></div></header>
      <section class="ops-client-stats">
        ${stat('Всего заявок', client.orders.length, '')}
        ${stat('Завершено', client.completed, 'ok')}
        ${stat('Отменено', client.cancelled, client.cancelled ? 'muted' : '')}
        ${stat('Скидка', `${discount}%`, discount ? 'attention' : '')}
      </section>
      <div class="card ops-client-progress"><span>Лояльность</span><strong>${discount ? `Текущая скидка ${discount}%` : 'Скидка появится после 3 уборок'}</strong><div><i style="width:${Math.min(100, nextTarget ? (client.completed / nextTarget) * 100 : 100)}%"></i></div><small>${remaining ? `Ещё ${remaining} ${plural(remaining, 'уборка', 'уборки', 'уборок')} до следующего уровня` : 'Максимальный уровень достигнут'}</small></div>
      <button class="ops-contact-client" type="button" data-chat-client="${escapeHtml(client.id)}">Написать клиенту</button>
      <div class="ops-title-row"><div><h2>История</h2><p>${client.orders.length} заявок</p></div></div>
      <div class="ops-order-list">${client.orders.sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).map(orderCard).join('')}</div>
    </div>`;
  root.querySelector('[data-back]').onclick = () => { section = 'clients'; renderSection(root, navigate); };
  root.querySelector('[data-chat-client]').onclick = () => openClientChat(client.id);
  bindOrderButtons(root, navigate);
}

async function sendTemplate(button, order, template) {
  button.disabled = true;
  try {
    await adminPost('/api/demo-admin-message', { client_telegram_id: order.client_telegram_id, order_number: order.order_number, template });
    showToast('Сообщение отправлено клиенту');
  } catch (error) { showToast(error.message || 'Не удалось отправить сообщение', true); }
  finally { button.disabled = false; }
}

async function adminPost(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`);
  return data;
}

function openClientChat(id) {
  const url = `tg://user?id=${encodeURIComponent(String(id || ''))}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.location.href = url;
}

async function loadPhotos(root, order, count) {
  const initData = window.Telegram?.WebApp?.initData || '';
  for (let i = 0; i < count; i += 1) {
    const tile = root.querySelector(`[data-photo-index="${i}"]`);
    if (!tile) continue;
    try {
      const q = new URLSearchParams({ user: String(order.client_telegram_id), order: String(order.order_number), index: String(i) });
      const response = await fetch(`/api/demo-admin-photo?${q}`, { headers: { 'X-Telegram-Init-Data': initData } });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      tile.classList.remove('loading');
      tile.innerHTML = `<img src="${url}" alt="Фото ${i + 1}"><span>${i + 1}</span>`;
      tile.onclick = () => openSinglePhoto(url);
    } catch { tile.classList.remove('loading'); tile.classList.add('error'); tile.innerHTML = '<span>Недоступно</span>'; }
  }
}
function openSinglePhoto(url) {
  const overlay = document.createElement('div');
  overlay.className = 'admin-lightbox';
  overlay.innerHTML = `<div class="admin-lightbox-top"><button type="button">×</button></div><div class="admin-lightbox-stage"><img src="${url}" alt="Фото объекта"></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('button').onclick = () => overlay.remove();
  overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
}

function aggregateClients(orders) {
  const map = new Map();
  for (const order of orders) {
    const id = String(order.client_telegram_id || '');
    if (!id) continue;
    if (!map.has(id)) map.set(id, { id, name: order.customer_name || 'Клиент', phone: order.phone || '', orders: [], completed: 0, cancelled: 0 });
    const client = map.get(id);
    client.orders.push(order);
    if (order.status === 'COMPLETED') client.completed += 1;
    if (order.status === 'CANCELLED') client.cancelled += 1;
    if (order.customer_name) client.name = order.customer_name;
    if (order.phone) client.phone = order.phone;
  }
  return [...map.values()];
}

function filterByStatus(orders, key) {
  const statuses = STATUS_GROUPS[key];
  return statuses ? orders.filter((o) => statuses.includes(o.status)) : [...orders];
}
function matchesQuery(order) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [order.order_number, order.customer_name, order.phone, order.address, order.city, order.service_name].some((v) => String(v || '').toLowerCase().includes(q));
}
function findOrder(clientId, number) {
  return cache.find((o) => String(o.client_telegram_id) === String(clientId) && String(o.order_number) === String(number));
}
function uniqueOrders(orders) {
  const seen = new Set();
  return orders.filter((o) => { const key = `${o.client_telegram_id}:${o.order_number}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function ageMinutes(order) {
  const ts = Date.parse(order.created_at || '');
  return Number.isFinite(ts) ? Math.max(0, Math.floor((Date.now() - ts) / 60000)) : 0;
}
function byTime(a, b) { return String(a.time || '').localeCompare(String(b.time || '')); }
function moscowIso(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + offsetDays * 86400000));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function contactMethod(value) {
  return ({ telegram: 'Telegram', whatsapp: 'WhatsApp', max: 'MAX', call: 'Звонок' })[String(value || '').toLowerCase()] || '';
}
function publicStatus(status) {
  if (status === 'CLEANER_ASSIGNED') return 'Подтверждена';
  return STATUS_LABELS[status] || status || 'Заявка';
}
function statusOptions(current) {
  const list = [['NEW','Новая'],['REVIEW','На рассмотрении'],['CONFIRMED','Подтверждена'],['CLEANER_ASSIGNED','Команда назначена'],['IN_PROGRESS','В работе'],['COMPLETED','Завершена'],['CANCELLED','Отменена']];
  return list.map(([v,l]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${l}</option>`).join('');
}
function detail(label, value) { return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? '—'))}</strong></div>`; }
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`; }
function plural(n, one, few, many) { const v = Math.abs(Number(n)) % 100; const v1 = v % 10; if (v > 10 && v < 20) return many; if (v1 > 1 && v1 < 5) return few; if (v1 === 1) return one; return many; }
function loading(text) { return `<div class="loading"><div><div class="spinner"></div>${escapeHtml(text)}</div></div>`; }
