import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatTime, money, STATUS_LABELS, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);

function icon(name) {
  const icons = {
    calc: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h2M14 18h2"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    prep: '<svg viewBox="0 0 24 24"><path d="M7 4h10v3H7zM6 7h12v14H6z"/><path d="m9 12 1.5 1.5L15 9M9 17h6"/></svg>',
    faq: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 4.3 1.5c-.9.9-2.1 1.3-2.1 2.8M12 17h.01"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.1-.6L4 20l1.5-4.1A7.3 7.3 0 0 1 4 11.5 7.6 7.6 0 0 1 12 4a7.6 7.6 0 0 1 8 7.5Z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };
  return icons[name] || icons.list;
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

function clientStatus(order) {
  if (order?.status === 'CLEANER_ASSIGNED') return 'Подтверждена';
  return STATUS_LABELS[order?.status] || order?.status || 'Заявка';
}

function renderNearest(order) {
  if (!order) {
    return `
      <section class="card cc-empty-next">
        <span class="cc-kicker">Персональный сервис</span>
        <h3>Следующей уборки пока нет</h3>
        <p>Выберите удобный день — оформление новой заявки займёт несколько минут.</p>
      </section>
      <div class="cc-card-actions"><button class="primary-btn" type="button" data-new-order>Заказать уборку</button></div>`;
  }

  const address = [order.city, order.address].filter(Boolean).join(', ');
  const repeatSupported = typeof window.HCRepeatOrder === 'function';
  return `
    <section class="card cc-next-card" data-nearest-order="${escapeHtml(order.id)}">
      <div class="cc-card-head"><span class="cc-next-label">Ближайшая уборка</span><span class="cc-status-pill">${escapeHtml(clientStatus(order))}</span></div>
      <div class="cc-next-date">${escapeHtml(formatDate(order.date))} <span class="cc-next-time">· ${escapeHtml(formatTime(order.time))}</span></div>
      <div class="cc-next-service">${escapeHtml(order.service_name || 'Уборка')}</div>
      <div class="cc-next-address">${escapeHtml(address || 'Адрес указан в заявке')}</div>
    </section>
    <div class="cc-card-actions">
      ${repeatSupported ? '<button class="secondary-btn" type="button" data-repeat-order>Повторить эту уборку</button>' : ''}
      <button class="primary-btn" type="button" data-new-order>Заказать уборку</button>
    </div>`;
}

function hoursUntil(order) {
  const stamp = orderStamp(order);
  if (!Number.isFinite(stamp)) return NaN;
  return (stamp - Date.now()) / 3600000;
}

function personalTip(order) {
  if (!order) {
    return `<div class="card cc-personal-tip"><span class="cc-tip-icon">${icon('calc')}</span><div><strong>Планируете уборку?</strong><p>Сначала посмотрите ориентировочную стоимость — это займёт меньше минуты.</p></div><button type="button" data-tip-action="calc">Рассчитать</button></div>`;
  }
  const hours = hoursUntil(order);
  if (Number.isFinite(hours) && hours <= 24 && hours >= 0) {
    return `<div class="card cc-personal-tip urgent"><span class="cc-tip-icon">${icon('clock')}</span><div><strong>Уборка уже скоро</strong><p>До начала меньше 24 часов. Изменения и отмена теперь согласовываются с менеджером.</p></div><button type="button" data-tip-action="manager">Написать</button></div>`;
  }
  const days = Number.isFinite(hours) && hours > 0 ? Math.max(1, Math.ceil(hours / 24)) : null;
  return `<div class="card cc-personal-tip"><span class="cc-tip-icon">${icon('prep')}</span><div><strong>${days ? `До уборки ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}` : 'Проверьте детали уборки'}</strong><p>Подготовьте доступ в помещение и проверьте адрес перед приездом команды.</p></div><button type="button" data-tip-action="prep">Как подготовиться</button></div>`;
}

function toolHeader(title, subtitle) {
  return `<button class="cc-back" type="button" data-tool-back>← На главную</button><header class="cc-subpage-head"><span class="cc-kicker">HOUSE CLEANING · ДЛЯ ВАС</span><h1>${escapeHtml(title)}</h1><p class="page-subtitle">${escapeHtml(subtitle)}</p></header>`;
}

function showCalculator(root, navigate) {
  const services = (state.bootstrap?.services || []).filter((item) => item.kind === 'primary');
  let selected = services[0]?.id || null;
  let area = Math.max(10, Number(state.draft?.area || 50));

  const draw = () => {
    const service = services.find((item) => Number(item.id) === Number(selected));
    const rate = Number(service?.price_per_m2 || 0);
    const total = rate > 0 ? Math.round(rate * area) : 0;
    root.innerHTML = `${toolHeader('Рассчитать стоимость', 'Быстрый ориентир по виду уборки и площади.')}
      <div class="card cc-calc-panel">
        <div class="cc-calc-services">${services.map((item) => `<button type="button" class="cc-calc-service ${Number(item.id) === Number(selected) ? 'selected' : ''}" data-calc-service="${item.id}"><strong>${escapeHtml(item.name)}</strong><span>${Number(item.price_per_m2 || 0) > 0 ? `от ${escapeHtml(String(item.price_per_m2))} ₽/м²` : 'После оценки'}</span></button>`).join('')}</div>
        <label class="cc-calc-area"><span>Площадь объекта</span><div><input type="number" min="10" max="5000" inputmode="decimal" enterkeyhint="done" value="${area}" data-calc-area><b>м²</b></div></label>
        <div class="cc-calc-total"><span>Предварительно</span><strong>${total > 0 ? `от ${escapeHtml(money(total))}` : 'Уточнит менеджер'}</strong><small>Точную стоимость менеджер подтвердит после оценки объекта и фотографий.</small></div>
      </div>
      <button class="primary-btn" type="button" data-calc-order>Заказать уборку</button>`;
    root.querySelector('[data-tool-back]').onclick = () => renderConciergeHome(root, navigate);
    root.querySelectorAll('[data-calc-service]').forEach((button) => button.onclick = () => { selected = Number(button.dataset.calcService); draw(); });
    const areaInput = root.querySelector('[data-calc-area]');
    areaInput.oninput = () => { area = Math.max(10, Math.min(5000, Number(areaInput.value || 10))); const serviceNow = services.find((item) => Number(item.id) === Number(selected)); const value = Number(serviceNow?.price_per_m2 || 0) * area; const totalEl = root.querySelector('.cc-calc-total strong'); if (totalEl) totalEl.textContent = value > 0 ? `от ${money(Math.round(value))}` : 'Уточнит менеджер'; };
    areaInput.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); areaInput.blur(); } };
    root.querySelector('[data-calc-order]').onclick = () => { state.draft.serviceId = selected; state.draft.area = area; state.draft.step = 2; state.saveDraft(); navigate('booking'); };
  };
  draw();
}

function showServiceGuide(root, navigate) {
  const services = (state.bootstrap?.services || []).filter((item) => item.kind === 'primary');
  root.innerHTML = `${toolHeader('Что входит в уборку', 'Коротко о доступных форматах. Конкретный объём работ менеджер уточнит по вашему объекту.')}
    <div class="cc-tool-list">${services.map((service) => `<div class="card cc-tool-info"><div><strong>${escapeHtml(service.name)}</strong><p>${escapeHtml(service.description || 'Состав работ уточняется по объекту.')}</p></div><span>${Number(service.price_per_m2 || 0) > 0 ? `от ${escapeHtml(String(service.price_per_m2))} ₽/м²` : 'По оценке'}</span></div>`).join('')}</div>
    <button class="primary-btn" type="button" data-tool-order>Выбрать уборку</button>`;
  root.querySelector('[data-tool-back]').onclick = () => renderConciergeHome(root, navigate);
  root.querySelector('[data-tool-order]').onclick = () => startBooking(navigate);
}

function showPreparation(root, navigate) {
  const items = [
    ['Проверьте доступ', 'Убедитесь, что команда сможет попасть в квартиру, дом или офис в выбранное время.'],
    ['Уберите ценные вещи и документы', 'Личные документы, деньги и ценные предметы лучше заранее убрать в безопасное место.'],
    ['Предупредите о животных', 'Если дома есть питомцы, укажите это в заявке и при необходимости подготовьте для них спокойное место.'],
    ['Сообщите важные детали', 'Домофон, сложный вход, парковку или особые пожелания можно указать в комментарии к адресу.'],
  ];
  root.innerHTML = `${toolHeader('Подготовиться к уборке', 'Небольшой чек-лист, чтобы визит прошёл спокойно и без задержек.')}
    <div class="cc-prep-list">${items.map(([title, text], index) => `<div class="card cc-prep-item"><span>${index + 1}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div></div>`).join('')}</div>`;
  root.querySelector('[data-tool-back]').onclick = () => renderConciergeHome(root, navigate);
}

export async function renderConciergeHome(root, navigate) {
  root.innerHTML = `
    <div class="cc-home">
      <header class="cc-greeting-row"><div><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1 class="cc-greeting">${escapeHtml(greeting())}, ${escapeHtml(displayName())}!</h1><p class="cc-greeting-sub">Ваша чистота — наша забота. Всё важное собрано здесь.</p></div><div class="cc-monogram">HC</div></header>
      <div class="card cc-empty-next"><div class="loading"><div><div class="spinner"></div>Проверяем ближайшую уборку...</div></div></div>
    </div>`;

  let orders = [];
  try { orders = await loadOrders(); } catch { orders = []; }
  if (!root.querySelector('.cc-home')) return;
  const order = nearestOrder(orders);

  root.innerHTML = `
    <div class="cc-home">
      <header class="cc-greeting-row"><div><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1 class="cc-greeting">${escapeHtml(greeting())}, ${escapeHtml(displayName())}!</h1><p class="cc-greeting-sub">Ваша чистота — наша забота. Всё важное собрано здесь.</p></div><div class="cc-monogram">HC</div></header>
      ${renderNearest(order)}
      <section class="cc-section cc-for-you-section">
        <div class="cc-section-head"><h2>Для вас</h2><span>Полезное перед заказом</span></div>
        <div class="cc-for-you-grid">
          <button class="cc-tool-card" type="button" data-tool="calc"><span>${icon('calc')}</span><div><strong>Рассчитать стоимость</strong><small>Ориентир за минуту</small></div></button>
          <button class="cc-tool-card" type="button" data-tool="services"><span>${icon('list')}</span><div><strong>Что входит в уборку</strong><small>Выберите подходящий формат</small></div></button>
          <button class="cc-tool-card" type="button" data-tool="prep"><span>${icon('prep')}</span><div><strong>Подготовиться</strong><small>Короткий чек-лист</small></div></button>
          <button class="cc-tool-card" type="button" data-tool="faq"><span>${icon('faq')}</span><div><strong>Частые вопросы</strong><small>Оплата, отмена и сервис</small></div></button>
        </div>
      </section>
      <section class="cc-section">
        <div class="cc-section-head"><h2>Подсказка</h2><span>По вашей заявке</span></div>
        ${personalTip(order)}
      </section>
      <button class="cc-help-strip" type="button" data-manager><span class="cc-help-icon">${icon('chat')}</span><span><small>Нужна помощь?</small><strong>Связаться с менеджером</strong></span><b>›</b></button>
    </div>`;

  root.querySelectorAll('[data-new-order]').forEach((button) => button.onclick = () => startBooking(navigate));
  root.querySelector('[data-nearest-order]')?.addEventListener('click', (event) => { if (!event.target.closest('button') && order?.id) navigate('orders', { orderId: order.id }); });
  root.querySelector('[data-repeat-order]')?.addEventListener('click', () => { try { window.HCRepeatOrder(order); } catch { showToast('Не удалось повторить уборку', true); } });
  root.querySelector('[data-tool="calc"]')?.addEventListener('click', () => showCalculator(root, navigate));
  root.querySelector('[data-tool="services"]')?.addEventListener('click', () => showServiceGuide(root, navigate));
  root.querySelector('[data-tool="prep"]')?.addEventListener('click', () => showPreparation(root, navigate));
  root.querySelector('[data-tool="faq"]')?.addEventListener('click', () => navigate('profile', { section: 'faq' }));
  root.querySelector('[data-tip-action="calc"]')?.addEventListener('click', () => showCalculator(root, navigate));
  root.querySelector('[data-tip-action="prep"]')?.addEventListener('click', () => showPreparation(root, navigate));
  root.querySelector('[data-tip-action="manager"]')?.addEventListener('click', openManager);
  root.querySelector('[data-manager]')?.addEventListener('click', openManager);
}