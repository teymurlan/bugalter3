import { api, canSelfCancel, hoursUntilOrder } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatTime, modal, money, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
const MANAGER_PHONE = '+79992107977';
let currentFilter = 'active';
let currentQuery = '';
let managerCache = null;

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

function orderStart(order) {
  if (!order?.date) return Number.POSITIVE_INFINITY;
  const time = String(order.time || '00:00').slice(0, 5);
  const stamp = Date.parse(`${order.date}T${time}:00+03:00`);
  return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY;
}

function shortOrderNumber(order) {
  const direct = Number(order?.display_number || order?.short_number || order?.id || 0);
  if (Number.isFinite(direct) && direct > 0) return `#${String(Math.trunc(direct)).padStart(3, '0')}`;
  const digits = String(order?.order_number || '').replace(/\D/g, '');
  const fallback = digits.slice(-3);
  return fallback ? `#${fallback.padStart(3, '0')}` : '#---';
}

function sortOrders(a, b) {
  const aActive = ACTIVE.has(a.status);
  const bActive = ACTIVE.has(b.status);
  if (aActive !== bActive) return aActive ? -1 : 1;
  if (aActive && bActive) {
    if (a.status === 'IN_PROGRESS' && b.status !== 'IN_PROGRESS') return -1;
    if (b.status === 'IN_PROGRESS' && a.status !== 'IN_PROGRESS') return 1;
    return orderStart(a) - orderStart(b) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
  }
  return orderStart(b) - orderStart(a) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

function mergeOrders(localOrders, storedOrders) {
  const map = new Map();
  for (const item of [...localOrders, ...storedOrders]) {
    const key = String(item.order_number || item.id || '');
    const previous = map.get(key) || {};
    map.set(key, { ...previous, ...item, id: previous.id || item.id });
  }
  return [...map.values()].sort(sortOrders);
}

async function managerContact() {
  if (managerCache) return managerCache;
  try {
    const response = await fetch('/api/manager-contact', { headers: headers() });
    if (response.ok) managerCache = await response.json();
  } catch {}
  return managerCache || {};
}

async function openManager() {
  const contact = await managerContact();
  const id = Number(contact.telegram_id || 0);
  if (id) {
    window.location.href = `tg://user?id=${id}`;
    return;
  }
  const username = String(state.bootstrap?.config?.managerUsername || '').replace(/^@/, '');
  if (!username) return showToast('Контакт менеджера пока не настроен', true);
  const url = `https://t.me/${username}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank');
}

function callManager() { window.location.href = `tel:${MANAGER_PHONE}`; }

function statusInfo(status) {
  if (['NEW', 'REVIEW'].includes(status)) return { label: 'На проверке', cls: 'pending' };
  if (['CONFIRMED', 'CLEANER_ASSIGNED'].includes(status)) return { label: 'Подтверждена', cls: 'confirmed' };
  if (status === 'IN_PROGRESS') return { label: 'Уборка началась', cls: 'progress' };
  if (status === 'COMPLETED') return { label: 'Завершена', cls: 'completed' };
  if (status === 'CANCELLED') return { label: 'Отменена', cls: 'cancelled' };
  return { label: 'Заявка', cls: 'neutral' };
}

function contactMethodLabel(value) {
  return ({ telegram: 'Telegram', whatsapp: 'WhatsApp', max: 'MAX', call: 'Звонок' })[String(value || '').toLowerCase()] || 'Не выбран';
}

function matchesFilter(order) {
  if (currentFilter === 'active' && !ACTIVE.has(order.status)) return false;
  if (currentFilter === 'history' && ACTIVE.has(order.status)) return false;
  const query = currentQuery.trim().toLowerCase();
  if (!query) return true;
  return [shortOrderNumber(order), order.order_number, order.address, order.city, order.service_name, formatDate(order.date), formatTime(order.time)]
    .some((value) => String(value || '').toLowerCase().includes(query));
}

function countFilter(list, id) {
  if (id === 'all') return list.length;
  if (id === 'active') return list.filter((order) => ACTIVE.has(order.status)).length;
  if (id === 'history') return list.filter((order) => !ACTIVE.has(order.status)).length;
  return 0;
}

function whenLabel(order) {
  if (!order?.date) return '';
  if (order.date === isoDay(0)) return `Сегодня · ${formatTime(order.time)}`;
  if (order.date === isoDay(1)) return `Завтра · ${formatTime(order.time)}`;
  return `${formatDate(order.date)} · ${formatTime(order.time)}`;
}

function orderCard(order) {
  const status = statusInfo(order.status);
  const address = [order.city, order.address].filter(Boolean).join(', ');
  const price = Number(order.estimated_price || 0);
  const showEstimate = order.status !== 'COMPLETED' && price > 0;
  return `<article class="u7-order-card-v3 status-${status.cls}" data-order-id="${escapeHtml(order.id)}">
    <div class="u7-order-card-top">
      <span class="u7-order-number">Заказ ${escapeHtml(shortOrderNumber(order))}</span>
      <span class="u7-order-status ${status.cls}">${escapeHtml(status.label)}</span>
    </div>
    <h3>${escapeHtml(order.service_name || 'Уборка')}</h3>
    <div class="u7-order-inline-meta">
      <span><i>◷</i>${escapeHtml(whenLabel(order))}</span>
      <span><i>□</i>${escapeHtml(String(order.area || 0))} м²</span>
    </div>
    <div class="u7-order-address"><span>⌖</span><b>${escapeHtml(address || 'Адрес указан в заявке')}</b></div>
    <div class="u7-order-card-bottom">
      <strong>${showEstimate ? `от ${escapeHtml(money(price))}` : (order.status === 'COMPLETED' ? 'Выполнено' : status.label)}</strong>
      <button type="button" data-open>Открыть <i>›</i></button>
    </div>
  </article>`;
}

function renderList(root, navigate, list, params = {}) {
  const activeCount = countFilter(list, 'active');
  const historyCount = countFilter(list, 'history');
  const filters = [['active','Активные'],['history','История'],['all','Все']];
  const back = params.from === 'home' ? '<button class="cc-back hc-fixed-back" type="button" data-orders-back>← Главная</button>' : '';

  root.innerHTML = `${back}<section class="u7-orders-hero ${params.from === 'home' ? 'hc-subpage-offset' : ''}">
      <span class="u7-eyebrow">HOUSE CLEANING</span>
      <h1>Мои заявки</h1>
      <p>Текущие уборки, статусы и история — без лишних экранов.</p>
      <div class="u7-orders-counters"><span><b>${activeCount}</b> активных</span><span><b>${historyCount}</b> в истории</span></div>
    </section>
    <section class="u7-orders-toolbar">
      <label class="u7-order-search"><span>⌕</span><input type="search" value="${escapeHtml(currentQuery)}" data-order-search placeholder="Номер, услуга, адрес или дата"></label>
      <div class="u7-orders-tabs" role="tablist">${filters.map(([id,label])=>`<button class="${currentFilter===id?'active':''}" type="button" data-filter="${id}"><span>${label}</span><b>${countFilter(list,id)}</b></button>`).join('')}</div>
    </section>
    <div class="u7-order-list-v3" data-order-list></div>`;

  const holder = root.querySelector('[data-order-list]');
  const draw = () => {
    const visible = list.filter(matchesFilter).sort(sortOrders);
    holder.innerHTML = visible.length ? visible.map(orderCard).join('') : `<div class="u7-orders-empty"><span>✓</span><strong>${currentFilter === 'active' ? 'Активных заявок нет' : 'Заявок не найдено'}</strong><p>${currentFilter === 'active' ? 'Когда оформите новую уборку, она появится здесь.' : 'Попробуйте изменить фильтр или поиск.'}</p></div>`;
    root.querySelectorAll('[data-filter]').forEach((button)=>button.classList.toggle('active',button.dataset.filter===currentFilter));
    holder.querySelectorAll('[data-order-id]').forEach((card)=>{
      const open=()=>navigate('orders',{orderId:Number(card.dataset.orderId),from:'orders'});
      card.querySelector('[data-open]').onclick=(event)=>{event.stopPropagation();open();};
      card.onclick=(event)=>{if(!event.target.closest('button'))open();};
    });
  };

  const input = root.querySelector('[data-order-search]');
  input.oninput = () => { currentQuery = input.value; draw(); };
  root.querySelectorAll('[data-filter]').forEach((button)=>button.onclick=()=>{currentFilter=button.dataset.filter;draw();});
  root.querySelector('[data-orders-back]')?.addEventListener('click',()=>window.HCNavigation?.back?.('home') || navigate('home'));
  draw();
}

export async function renderConciergeOrders(root, navigate, params = {}) {
  if (params.orderId) {
    root.innerHTML = `<button class="cc-back hc-fixed-back" type="button" data-back>← Назад</button><section class="cc-detail-head hc-subpage-offset"><span class="cc-kicker">HOUSE CLEANING</span><h1>Открываем заявку</h1><p class="page-subtitle">Проверяем актуальный статус...</p></section><div class="card hc-detail-block"><div class="loading">Загрузка...</div></div>`;
    root.querySelector('[data-back]').onclick = () => window.HCNavigation?.back?.(params.from === 'home' ? 'home' : 'orders') || navigate(params.from === 'home' ? 'home' : 'orders');
    return renderOrderDetails(root, navigate, params.orderId, params);
  }

  const cached = Array.isArray(window.__HC_CLIENT_ORDERS_CACHE) ? window.__HC_CLIENT_ORDERS_CACHE : null;
  if (cached) renderList(root, navigate, cached, params);
  else root.innerHTML = `<section class="u7-orders-hero"><span class="u7-eyebrow">HOUSE CLEANING</span><h1>Мои заявки</h1><p>Загружаем актуальные данные...</p></section><div class="loading"><div><div class="spinner"></div>Проверяем заявки...</div></div>`;

  try {
    const [local, stored] = await Promise.all([api.orders(), fetchStoredOrders()]);
    const fresh = mergeOrders(Array.isArray(local?.orders) ? local.orders : [], stored);
    const oldKey = JSON.stringify((cached || []).map((o)=>[o.order_number,o.status,o.date,o.time,o.updated_at]));
    const newKey = JSON.stringify(fresh.map((o)=>[o.order_number,o.status,o.date,o.time,o.updated_at]));
    window.__HC_CLIENT_ORDERS_CACHE = fresh;
    if (!cached) renderList(root, navigate, fresh, params);
    else if (oldKey !== newKey) root.dataset.ordersRefreshReady = '1';
  } catch (error) {
    if (!cached) root.innerHTML = `<section class="u7-orders-hero"><span class="u7-eyebrow">HOUSE CLEANING</span><h1>Мои заявки</h1></section><div class="u7-orders-empty"><strong>Не удалось загрузить заявки</strong><p>${escapeHtml(error.message || 'Попробуйте ещё раз')}</p></div>`;
  }
}

function timeline(status) {
  if (status === 'CANCELLED') return `<div class="cc-status-timeline cancelled"><div class="cc-cancelled-mark">×</div><div><strong>Заявка отменена</strong><span>При необходимости оформите новую уборку.</span></div></div>`;
  const steps = ['Заявка создана', 'Подтверждена', 'Уборка началась', 'Завершена'];
  const index = status === 'COMPLETED' ? 3 : status === 'IN_PROGRESS' ? 2 : ['CONFIRMED', 'CLEANER_ASSIGNED'].includes(status) ? 1 : 0;
  return `<div class="cc-status-timeline hc-timeline state-${statusInfo(status).cls}"><div class="cc-timeline-line"><i style="width:${index ? Math.round(index / 3 * 100) : 0}%"></i></div>${steps.map((label, step) => `<div class="cc-timeline-step ${step <= index ? 'done' : ''} ${step === index ? 'current' : ''}"><span>${step < index ? '✓' : step + 1}</span><small>${escapeHtml(label)}</small></div>`).join('')}</div>`;
}

async function renderOrderDetails(root, navigate, id, params = {}) {
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
    const showEstimate = order.status !== 'COMPLETED' && price > 0;

    root.innerHTML = `<button class="cc-back hc-fixed-back" type="button" data-back>← Назад</button>
      <section class="cc-detail-head hc-subpage-offset"><span class="cc-kicker hc-status ${status.cls}">${escapeHtml(status.label)}</span><h1>Заказ ${escapeHtml(shortOrderNumber(order))}</h1><p class="page-subtitle">${escapeHtml(order.service_name || 'Уборка')}</p></section>
      ${timeline(order.status)}
      <div class="hc-detail-sections">
        ${detailBlock('Дата и время', `${formatDate(order.date)} · ${formatTime(order.time)}`)}
        ${detailBlock('Адрес', [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : '', order.floor ? `этаж ${order.floor}` : '', order.entrance ? `парадная ${order.entrance}` : ''].filter(Boolean).join(', '))}
        ${detailBlock('Площадь', `${order.area || 0} м²`)}
        ${detailBlock('Дополнительные услуги', addons.length ? addons.map((item) => item.name).join(', ') : (order.addon_names?.join(', ') || 'Нет'))}
        ${detailBlock('Способ связи', contactMethodLabel(order.contact_method || order.contactMethod))}
        ${order.comment ? detailBlock('Комментарий', order.comment) : ''}
        ${showEstimate ? `<section class="card hc-detail-block"><small>Предварительная стоимость</small>${before > price && discount ? `<span>До скидки: ${escapeHtml(money(before))}</span><span>Скидка ${discount}%: −${escapeHtml(money(before - price))}</span>` : ''}<strong>от ${escapeHtml(money(price))}</strong></section>` : ''}
      </div>
      <div class="cc-policy-note">${selfCancel ? '<strong>Отмена доступна самостоятельно, пока до уборки не меньше 24 часов.</strong>' : urgent ? '<strong>До уборки меньше 24 часов.</strong> Изменения и отмена — через менеджера.' : '<strong>Изменить заявку можно через менеджера.</strong>'}</div>
      <div class="cc-gallery-title"><h2>Фото объекта</h2><span>${photoCount ? `${photoCount} фото` : 'Нет фото'}</span></div>
      <div class="cc-client-gallery">${availablePhotos ? Array.from({ length: availablePhotos }, (_, index) => `<button class="cc-client-photo" type="button" data-client-photo="${index}"><img alt="Фото ${index + 1}"><span>${index + 1}</span></button>`).join('') : `<div class="card cc-order-empty" style="grid-column:1/-1">${photoCount ? 'Фотографии этой старой заявки недоступны для восстановления.' : 'Фотографии не прикреплены.'}</div>`}</div>
      <div class="hc-order-actions">${selfCancel ? '<button class="hc-btn hc-btn-danger" type="button" data-cancel>Отменить заявку</button>' : ''}${ACTIVE.has(order.status) ? '<button class="hc-btn hc-btn-blue" type="button" data-manager>✉️ Написать менеджеру</button><button class="hc-btn hc-btn-green" type="button" data-call>📞 Позвонить</button>' : ''}<button class="hc-btn hc-copy-order-v58" type="button" data-copy-order>Скопировать детали</button></div>`;

    root.querySelector('[data-back]').onclick = () => window.HCNavigation?.back?.(params.from === 'home' ? 'home' : 'orders') || navigate(params.from === 'home' ? 'home' : 'orders');
    root.querySelector('[data-manager]')?.addEventListener('click', openManager);
    root.querySelector('[data-call]')?.addEventListener('click', callManager);
    root.querySelector('[data-copy-order]')?.addEventListener('click', async () => {
      const address = [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : ''].filter(Boolean).join(', ');
      const text = [
        `Заказ ${shortOrderNumber(order)}`,
        order.service_name || 'Уборка',
        `${formatDate(order.date)} · ${formatTime(order.time)}`,
        address,
        `Статус: ${status.label}`,
      ].filter(Boolean).join('\n');
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const area = document.createElement('textarea');
          area.value = text;
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          area.remove();
        }
        showToast('Детали заявки скопированы');
      } catch {
        showToast('Не удалось скопировать детали', true);
      }
    });
    if (availablePhotos) await loadDetailPhotos(root, order.order_number, availablePhotos);
    const cancel = root.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = async () => {
      const approved = await modal({ title: 'Отменить уборку?', text: 'После отмены восстановить эту заявку нельзя.', confirmText: 'Отменить заявку', danger: true });
      if (!approved) return;
      try {
        cancel.disabled = true;
        await api.cancelOrder(id);
        window.__HC_CLIENT_ORDERS_CACHE = null;
        showToast('Заявка отменена');
        renderConciergeOrders(root, navigate, { ...params, orderId: id });
      } catch (error) {
        cancel.disabled = false;
        showToast(error.message || 'Не удалось отменить заявку', true);
      }
    };
  } catch (error) {
    root.innerHTML = `<button class="cc-back hc-fixed-back" type="button" data-back>← Назад</button><div class="card cc-order-empty hc-subpage-offset">${escapeHtml(error.message || 'Заявка не найдена')}</div>`;
    root.querySelector('[data-back]').onclick = () => window.HCNavigation?.back?.(params.from === 'home' ? 'home' : 'orders') || navigate(params.from === 'home' ? 'home' : 'orders');
  }
}

function detailBlock(label, value) { return `<section class="card hc-detail-block"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value || '—'))}</strong></section>`; }
function clientPhotoUrl(orderNumber, index) { return `/api/demo-client-photo?${new URLSearchParams({ order: String(orderNumber), index: String(index) })}`; }

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
  const image = overlay.querySelector('[data-image]');
  const count = overlay.querySelector('[data-count]');
  const draw = () => { image.src = available[current].url; count.textContent = `${current + 1} / ${available.length}`; };
  overlay.querySelector('[data-close]').onclick = () => overlay.remove();
  overlay.querySelector('[data-prev]').onclick = () => { current = (current - 1 + available.length) % available.length; draw(); };
  overlay.querySelector('[data-next]').onclick = () => { current = (current + 1) % available.length; draw(); };
  overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
  draw();
}

function isoDay(offset = 0) {
  const date = new Date(Date.now() + offset * 86400000);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
