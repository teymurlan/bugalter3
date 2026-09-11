import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatTime, money, STATUS_LABELS, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
const MANAGER_PHONE = '+79992107977';

function icon(name) {
  const icons = {
    calc: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h2M14 18h2"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    prep: '<svg viewBox="0 0 24 24"><path d="M7 4h10v3H7zM6 7h12v14H6z"/><path d="m9 12 1.5 1.5L15 9M9 17h6"/></svg>',
    faq: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 4.3 1.5c-.9.9-2.1 1.3-2.1 2.8M12 17h.01"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.1-.6L4 20l1.5-4.1A7.3 7.3 0 0 1 4 11.5 7.6 7.6 0 0 1 12 4a7.6 7.6 0 0 1 8 7.5Z"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M6.6 3.5 9 8l-1.7 1.7c1 2.2 2.8 4 5 5l1.7-1.7 4.5 2.4-.8 3.2c-.2.8-.9 1.4-1.8 1.4C9.4 20 4 14.6 4 8.1c0-.9.6-1.6 1.4-1.8l1.2-2.8Z"/></svg>',
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

function initHeaders() {
  return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
}

async function serverJson(path) {
  const response = await fetch(path, { headers: initHeaders() });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function orderStamp(order) {
  if (!order?.date) return Number.POSITIVE_INFINITY;
  const time = String(order.time || '00:00').slice(0, 5);
  const stamp = Date.parse(`${order.date}T${time}:00+03:00`);
  return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY;
}

function nearestOrder(orders) {
  const active = (orders || []).filter((order) => ACTIVE.has(order.status));
  const now = Date.now() - 6 * 60 * 60 * 1000;
  return active.filter((order) => orderStamp(order) >= now).sort((a, b) => orderStamp(a) - orderStamp(b))[0]
    || active.sort((a, b) => orderStamp(a) - orderStamp(b))[0]
    || null;
}

async function loadOrders() {
  const local = await api.orders();
  const localOrders = Array.isArray(local?.orders) ? local.orders : [];
  const storedData = await serverJson('/api/demo-client-orders');
  const stored = Array.isArray(storedData?.orders) ? storedData.orders : [];
  if (!stored.length) return localOrders;
  const byNumber = new Map(stored.map((item) => [String(item.order_number || ''), item]));
  return localOrders.map((item) => {
    const server = byNumber.get(String(item.order_number || ''));
    return server ? { ...item, ...server, id: item.id } : item;
  });
}

function managerUsername() {
  return String(state.bootstrap?.config?.managerUsername || state.bootstrap?.config?.botUsername || '').replace(/^@/, '');
}

function openManager() {
  const username = managerUsername();
  if (!username) return showToast('Контакт менеджера пока не настроен', true);
  const url = `https://t.me/${username}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank');
}

function callManager() { window.location.href = `tel:${MANAGER_PHONE}`; }

function startBooking(navigate) {
  state.draft.step = 1;
  state.saveDraft();
  navigate('booking');
}

function clientStatus(order) {
  if (order?.status === 'CLEANER_ASSIGNED') return 'Подтверждена';
  if (order?.status === 'IN_PROGRESS') return 'Уборка началась';
  return STATUS_LABELS[order?.status] || order?.status || 'Заявка';
}

function renderNearest(order) {
  if (!order) return `<section class="card cc-empty-next"><span class="cc-kicker">HOUSE CLEANING</span><h3>Активных уборок нет</h3><p>Когда понадобится уборка, выберите услугу и удобный день.</p></section><div class="cc-card-actions"><button class="primary-btn" type="button" data-new-order>Заказать уборку</button></div>`;
  const address = [order.city, order.address].filter(Boolean).join(', ');
  return `<section class="card cc-next-card" data-nearest-order="${escapeHtml(order.id)}"><div class="cc-card-head"><span class="cc-next-label">Ближайшая уборка</span><span class="cc-status-pill status-${String(order.status || '').toLowerCase()}">${escapeHtml(clientStatus(order))}</span></div><div class="cc-next-date">${escapeHtml(formatDate(order.date))} <span class="cc-next-time">· ${escapeHtml(formatTime(order.time))}</span></div><div class="cc-next-service">${escapeHtml(order.service_name || 'Уборка')}</div><div class="cc-next-address">${escapeHtml(address || 'Адрес указан в заявке')}</div></section><div class="cc-card-actions"><button class="primary-btn" type="button" data-new-order>Заказать уборку</button></div>`;
}

function toolHeader(title, subtitle) {
  return `<button class="cc-back hc-fixed-back" type="button" data-tool-back>← Назад</button><header class="cc-subpage-head"><span class="cc-kicker">HOUSE CLEANING</span><h1>${escapeHtml(title)}</h1><p class="page-subtitle">${escapeHtml(subtitle)}</p></header>`;
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
      <div class="card cc-calc-panel"><div class="cc-calc-services">${services.map((item) => `<button type="button" class="cc-calc-service ${Number(item.id) === Number(selected) ? 'selected' : ''}" data-calc-service="${item.id}"><strong>${escapeHtml(item.name)}</strong><span>${Number(item.price_per_m2 || 0) > 0 ? `от ${escapeHtml(String(item.price_per_m2))} ₽/м²` : 'После оценки'}</span></button>`).join('')}</div><label class="cc-calc-area"><span>Площадь объекта</span><div><input type="number" min="10" max="5000" inputmode="decimal" enterkeyhint="done" value="${area}" data-calc-area><b>м²</b></div></label><div class="cc-calc-total"><span>Предварительно</span><strong>${total > 0 ? `от ${escapeHtml(money(total))}` : 'Уточнит менеджер'}</strong><small>Точную стоимость менеджер подтвердит после оценки объекта и фотографий.</small></div></div>
      <button class="primary-btn" type="button" data-calc-order>Заказать уборку</button>`;
    root.querySelector('[data-tool-back]').onclick = () => renderConciergeHome(root, navigate);
    root.querySelectorAll('[data-calc-service]').forEach((button) => button.onclick = () => { selected = Number(button.dataset.calcService); draw(); });
    const input = root.querySelector('[data-calc-area]');
    input.oninput = () => { area = Math.max(10, Math.min(5000, Number(input.value || 10))); const current = services.find((item) => Number(item.id) === Number(selected)); const value = Number(current?.price_per_m2 || 0) * area; root.querySelector('.cc-calc-total strong').textContent = value > 0 ? `от ${money(Math.round(value))}` : 'Уточнит менеджер'; };
    root.querySelector('[data-calc-order]').onclick = () => { state.draft.serviceId = selected; state.draft.area = area; state.draft.step = 2; state.saveDraft(); navigate('booking'); };
  };
  draw();
}

function showServiceGuide(root, navigate) {
  const services = (state.bootstrap?.services || []).filter((item) => item.kind === 'primary');
  root.innerHTML = `${toolHeader('Что входит в уборку', 'Сравните форматы и выберите подходящий вариант.')}
    <div class="cc-tool-list">${services.map((service) => `<div class="card cc-tool-info"><div><strong>${escapeHtml(service.name)}</strong><p>${escapeHtml(service.description || 'Состав работ уточняется по объекту.')}</p></div><span>${Number(service.price_per_m2 || 0) > 0 ? `от ${escapeHtml(String(service.price_per_m2))} ₽/м²` : 'По оценке'}</span></div>`).join('')}</div>
    <button class="primary-btn" type="button" data-tool-order>Выбрать уборку</button>`;
  root.querySelector('[data-tool-back]').onclick = () => renderConciergeHome(root, navigate);
  root.querySelector('[data-tool-order]').onclick = () => startBooking(navigate);
}

function showPreparation(root, navigate) {
  const items = [['Проверьте доступ', 'Убедитесь, что команда сможет попасть в помещение в выбранное время.'], ['Уберите ценные вещи и документы', 'Личные документы, деньги и ценные предметы лучше убрать заранее.'], ['Предупредите о животных', 'Укажите питомцев в заявке и при необходимости подготовьте для них спокойное место.'], ['Сообщите важные детали', 'Домофон, сложный вход, парковку или пожелания можно указать в комментарии.']];
  root.innerHTML = `${toolHeader('Подготовиться к уборке', 'Короткий чек-лист перед приездом команды.')}<div class="cc-prep-list">${items.map(([title, text], index) => `<div class="card cc-prep-item"><span>${index + 1}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div></div>`).join('')}</div>`;
  root.querySelector('[data-tool-back]').onclick = () => renderConciergeHome(root, navigate);
}

async function contextualCard(order, orders) {
  if (order?.status === 'NEW' || order?.status === 'REVIEW') return { title: 'Заявка на проверке', text: 'Менеджер проверит детали и свяжется с вами.', action: 'Открыть заявку', type: 'order' };
  if (order?.status === 'IN_PROGRESS') return { title: 'Уборка началась', text: 'Текущий статус и детали доступны в заявке.', action: 'Открыть заявку', type: 'order' };
  if (order) {
    const hours = (orderStamp(order) - Date.now()) / 3600000;
    if (hours >= 0 && hours <= 36) return { title: 'Уборка завтра', text: 'Проверьте адрес и подготовьте доступ в помещение.', action: 'Подготовиться', type: 'prep' };
    return { title: 'Проверьте детали уборки', text: 'Дата, время и адрес всегда доступны в вашей заявке.', action: 'Открыть заявку', type: 'order' };
  }
  const completed = (orders || []).filter((item) => item.status === 'COMPLETED').sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))).slice(0, 4);
  for (const item of completed) {
    const review = await serverJson(`/api/demo-review?order=${encodeURIComponent(item.order_number || '')}`);
    if (review && !review.review) return { title: 'Как прошла уборка?', text: 'Оцените последнюю уборку — это займёт меньше минуты.', action: 'Оставить отзыв', type: 'review', order: item };
  }
  const benefits = await serverJson('/api/client-benefits');
  if (Number(benefits?.referral_percent || 0) > 0) return { title: `Ваша скидка ${Number(benefits.referral_percent)}% доступна`, text: 'Она автоматически применится к следующей подходящей заявке.', action: 'Заказать со скидкой', type: 'book' };
  return { title: 'Выберите подходящую уборку', text: 'Сравните услуги и выберите подходящий формат.', action: 'Сравнить услуги', type: 'services' };
}

export async function renderConciergeHome(root, navigate) {
  root.innerHTML = `<div class="cc-home"><header class="cc-greeting-row"><div><span class="cc-kicker">HOUSE CLEANING</span><h1 class="cc-greeting">${escapeHtml(greeting())}, ${escapeHtml(displayName())}!</h1><p class="cc-greeting-sub">Запись, статусы и полезные инструменты в одном месте.</p></div><div class="cc-monogram">HC</div></header><div class="card cc-empty-next"><div class="loading"><div><div class="spinner"></div>Загружаем данные...</div></div></div></div>`;
  let orders = [];
  try { orders = await loadOrders(); } catch {}
  if (!root.querySelector('.cc-home')) return;
  const order = nearestOrder(orders);
  let context = { title: 'Выберите подходящую уборку', text: 'Сравните услуги и выберите подходящий формат.', action: 'Сравнить услуги', type: 'services' };
  try { context = await contextualCard(order, orders); } catch {}
  if (!root.querySelector('.cc-home')) return;

  root.innerHTML = `<div class="cc-home">
    <header class="cc-greeting-row"><div><span class="cc-kicker">HOUSE CLEANING</span><h1 class="cc-greeting">${escapeHtml(greeting())}, ${escapeHtml(displayName())}!</h1><p class="cc-greeting-sub">Запись, статусы и полезные инструменты в одном месте.</p></div><div class="cc-monogram">HC</div></header>
    ${renderNearest(order)}
    <section class="cc-section cc-for-you-section"><div class="cc-section-head"><h2>Для вас</h2><span>Полезное перед заказом</span></div><div class="cc-for-you-grid"><button class="cc-tool-card" type="button" data-tool="calc"><span>${icon('calc')}</span><div><strong>Рассчитать стоимость</strong><small>Ориентир за минуту</small></div></button><button class="cc-tool-card" type="button" data-tool="services"><span>${icon('list')}</span><div><strong>Что входит в уборку</strong><small>Сравнить форматы</small></div></button><button class="cc-tool-card" type="button" data-tool="prep"><span>${icon('prep')}</span><div><strong>Подготовиться</strong><small>Короткий чек-лист</small></div></button><button class="cc-tool-card" type="button" data-tool="faq"><span>${icon('faq')}</span><div><strong>Частые вопросы</strong><small>Оплата, отмена и сервис</small></div></button></div></section>
    <section class="cc-section"><div class="cc-section-head"><h2>Актуально для вас</h2><span>По текущей ситуации</span></div><div class="card cc-personal-tip"><span class="cc-tip-icon">${icon(context.type === 'prep' ? 'prep' : context.type === 'order' ? 'clock' : 'list')}</span><div><strong>${escapeHtml(context.title)}</strong><p>${escapeHtml(context.text)}</p></div><button type="button" data-context-action>${escapeHtml(context.action)}</button></div></section>
    <section class="card hc-contact-panel hc-home-contact"><div><small>Нужна помощь?</small><strong>Связаться с менеджером</strong></div><div class="hc-contact-actions"><button class="hc-btn hc-btn-blue" type="button" data-manager>Написать</button><button class="hc-btn hc-btn-green" type="button" data-call>Позвонить</button></div></section>
  </div>`;

  root.querySelectorAll('[data-new-order]').forEach((button) => button.onclick = () => startBooking(navigate));
  root.querySelector('[data-nearest-order]')?.addEventListener('click', () => order?.id && navigate('orders', { orderId: order.id }));
  root.querySelector('[data-tool="calc"]').onclick = () => showCalculator(root, navigate);
  root.querySelector('[data-tool="services"]').onclick = () => showServiceGuide(root, navigate);
  root.querySelector('[data-tool="prep"]').onclick = () => showPreparation(root, navigate);
  root.querySelector('[data-tool="faq"]').onclick = () => navigate('profile', { section: 'faq' });
  root.querySelector('[data-manager]').onclick = openManager;
  root.querySelector('[data-call]').onclick = callManager;
  root.querySelector('[data-context-action]').onclick = () => {
    if (context.type === 'order' && order?.id) return navigate('orders', { orderId: order.id });
    if (context.type === 'prep') return showPreparation(root, navigate);
    if (context.type === 'review' && context.order?.id) { try { sessionStorage.setItem('hc-review-focus', context.order.order_number || ''); } catch {} return navigate('orders', { orderId: context.order.id }); }
    if (context.type === 'book') return startBooking(navigate);
    return showServiceGuide(root, navigate);
  };
}
