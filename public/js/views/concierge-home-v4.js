import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, formatDate, formatTime, money, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW','REVIEW','CONFIRMED','CLEANER_ASSIGNED','IN_PROGRESS']);

function headers() {
  return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
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

function statusInfo(status) {
  if (['NEW','REVIEW'].includes(status)) return { label:'На проверке', cls:'pending' };
  if (['CONFIRMED','CLEANER_ASSIGNED'].includes(status)) return { label:'Подтверждена', cls:'confirmed' };
  if (status === 'IN_PROGRESS') return { label:'Уборка началась', cls:'progress' };
  if (status === 'COMPLETED') return { label:'Завершена', cls:'completed' };
  if (status === 'CANCELLED') return { label:'Отменена', cls:'cancelled' };
  return { label:'Заявка', cls:'neutral' };
}

function shortOrderNumber(order) {
  const direct = Number(order?.display_number || order?.short_number || order?.id || 0);
  if (Number.isFinite(direct) && direct > 0) return `#${String(Math.trunc(direct)).padStart(3,'0')}`;
  const digits = String(order?.order_number || '').replace(/\D/g,'');
  const fallback = digits.slice(-3);
  return fallback ? `#${fallback.padStart(3,'0')}` : '#---';
}

function orderStart(order) {
  if (!order?.date) return Number.POSITIVE_INFINITY;
  const time = String(order.time || '00:00').slice(0,5);
  const stamp = Date.parse(`${order.date}T${time}:00+03:00`);
  return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY;
}

async function loadOrders() {
  const local = await api.orders().catch(() => ({ orders:[] }));
  const localOrders = Array.isArray(local?.orders) ? local.orders : [];
  let stored = [];
  try {
    const response = await fetch('/api/demo-client-orders', { headers:headers(), cache:'no-store' });
    if (response.ok) {
      const data = await response.json();
      stored = Array.isArray(data?.orders) ? data.orders : [];
    }
  } catch {}

  const map = new Map();
  for (const item of [...localOrders,...stored]) {
    const key = String(item.order_number || item.id || '');
    if (!key) continue;
    const previous = map.get(key) || {};
    map.set(key,{ ...previous,...item,id:previous.id || item.id });
  }
  return [...map.values()];
}

function activeUpcoming(list) {
  const now = Date.now() - 6 * 60 * 60 * 1000;
  return list.filter((order)=>ACTIVE.has(order.status) && orderStart(order) >= now)
    .sort((a,b)=>orderStart(a)-orderStart(b));
}

function recentOrders(list) {
  return [...list].sort((a,b)=>{
    const first = String(b.created_at || b.updated_at || '').localeCompare(String(a.created_at || a.updated_at || ''));
    if (first) return first;
    return Number(b.id||0)-Number(a.id||0);
  }).slice(0,2);
}

function completedOrders(list) {
  return list.filter((order)=>order.status === 'COMPLETED')
    .sort((a,b)=>orderStart(b)-orderStart(a));
}

function repeatableOrder(list) {
  return completedOrders(list)[0] || list
    .filter((order)=>!ACTIVE.has(order.status) && order.status !== 'CANCELLED')
    .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0] || null;
}

function profileRemaining() {
  const profile = state.bootstrap?.user || {};
  const raw = profile.cleanings_remaining ?? profile.remaining_cleanings ?? profile.subscription_remaining;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && raw !== undefined && raw !== null && raw !== '' ? value : null;
}

function nearestCard(order) {
  if (!order) {
    return `<section class="u7-next-cleaning empty">
      <div><span>БЛИЖАЙШАЯ УБОРКА</span><strong>Пока не запланирована</strong><p>Выберите удобную дату — оформление займёт несколько минут.</p></div>
      <button type="button" data-book-cleaning>Выбрать дату</button>
    </section>`;
  }
  const status = statusInfo(order.status);
  const address = [order.city,order.address].filter(Boolean).join(', ');
  return `<section class="u7-next-cleaning">
    <div class="u7-next-cleaning-head"><span>БЛИЖАЙШАЯ УБОРКА</span><em class="hc-home-status-v54 ${status.cls}">${escapeHtml(status.label)}</em></div>
    <strong>${escapeHtml(formatDate(order.date))} · ${escapeHtml(formatTime(order.time))}</strong>
    <p>${escapeHtml(order.service_name || 'Уборка')} · ${escapeHtml(address || 'Адрес в заявке')}</p>
    <button type="button" data-next-order="${escapeHtml(String(order.id || ''))}">Открыть заявку</button>
  </section>`;
}

function dashboardSummary(list, next) {
  const completed = completedOrders(list);
  const remaining = profileRemaining();
  const last = completed[0] || null;
  return `<section class="u7-home-summary">
    <div class="u7-home-summary-title"><h2>Мои уборки</h2><span>Коротко о вашем сервисе</span></div>
    <div class="u7-home-stats">
      <div><small>Выполнено</small><b>${completed.length}</b><span>всего уборок</span></div>
      <div><small>Осталось</small><b>${remaining === null ? '—' : remaining}</b><span>${remaining === null ? 'появится после загрузки графика' : 'по вашему графику'}</span></div>
    </div>
    <div class="u7-home-history-row"><span>Последняя</span><b>${last ? `${escapeHtml(formatDate(last.date))} · ${escapeHtml(formatTime(last.time))}` : 'Ещё не было'}</b></div>
    <div class="u7-home-history-row"><span>Следующая</span><b>${next ? `${escapeHtml(formatDate(next.date))} · ${escapeHtml(formatTime(next.time))}` : 'Не запланирована'}</b></div>
  </section>`;
}

function compactOrderCard(order) {
  const status = statusInfo(order.status);
  const address = [order.city,order.address].filter(Boolean).join(', ');
  const price = Number(order.estimated_price || 0);
  return `<button class="hc-home-order-card-v54 status-${status.cls}" type="button" data-home-order="${escapeHtml(String(order.id || ''))}">
    <span class="hc-home-order-top-v54"><b>Заказ ${escapeHtml(shortOrderNumber(order))}</b><em class="hc-home-status-v54 ${status.cls}">${escapeHtml(status.label)}</em></span>
    <strong>${escapeHtml(order.service_name || 'Уборка')}</strong>
    <span class="hc-home-order-meta-v54">${escapeHtml(formatDate(order.date))} · ${escapeHtml(formatTime(order.time))}${order.area ? ` · ${escapeHtml(String(order.area))} м²` : ''}</span>
    <span class="hc-home-order-address-v54">${escapeHtml(address || 'Адрес указан в заявке')}</span>
    ${price > 0 && order.status !== 'COMPLETED' ? `<span class="hc-home-order-price-v54">от ${escapeHtml(money(price))}</span>` : ''}
  </button>`;
}

function upcomingSection(list) {
  const now = Date.now() - 6*60*60*1000;
  const limit = Date.now() + 7*24*60*60*1000;
  const upcoming = list.filter((order)=>ACTIVE.has(order.status))
    .filter((order)=>{ const t=orderStart(order); return Number.isFinite(t) && t>=now && t<=limit; })
    .sort((a,b)=>orderStart(a)-orderStart(b));
  return `<section class="cc-section hc-home-week-section-v54">
    <div class="cc-section-head hc-home-section-head-v54"><div><h2>Ближайшие 7 дней</h2><span>${upcoming.length ? `Запланировано: ${upcoming.length}` : 'Пока свободно'}</span></div></div>
    <div class="hc-home-week-list-v54">${upcoming.length ? upcoming.slice(0,3).map(compactOrderCard).join('') : '<div class="card hc-home-empty-v54">На ближайшие 7 дней уборок нет.</div>'}</div>
  </section>`;
}

function recentSection(list) {
  const recent = recentOrders(list);
  return `<section class="cc-section hc-home-orders-section-v54">
    <div class="cc-section-head hc-home-section-head-v54"><div><h2>Последние заявки</h2><span>Статус и основные детали</span></div><button type="button" data-all-orders>Все</button></div>
    <div class="hc-home-order-list-v54">${recent.length ? recent.map(compactOrderCard).join('') : '<div class="card hc-home-empty-v54">У вас пока нет заявок.</div>'}</div>
  </section>`;
}

async function openManager() {
  try {
    const response = await fetch('/api/manager-contact',{headers:headers(),cache:'no-store'});
    if (response.ok) {
      const data = await response.json();
      const id = Number(data?.telegram_id || 0);
      if (id) {
        window.location.href = `tg://user?id=${id}`;
        return;
      }
    }
  } catch {}

  const username = String(state.bootstrap?.config?.managerUsername || '').replace(/^@/,'');
  if (!username) return showToast('Контакт менеджера пока не настроен',true);
  const url = `https://t.me/${username}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url,'_blank');
}

function startBooking(navigate) {
  if (!Number(state.draft?.step || 0)) state.draft.step = 1;
  state.saveDraft();
  navigate('booking');
}

async function repeatOrder(navigate, order) {
  if (!order) return showToast('Пока нет завершённой уборки для повторения',true);
  await state.resetDraft();
  state.draft = {
    ...state.draft,
    serviceId:Number(order.service_id || order.serviceId || 0) || null,
    propertyType:order.property_type || order.propertyType || 'apartment',
    area:Math.max(10,Number(order.area || 50)),
    rooms:Math.max(1,Number(order.rooms || 1)),
    bathrooms:Math.max(1,Number(order.bathrooms || 1)),
    pets:Boolean(order.pets),
    addonIds:Array.isArray(order.addon_ids) ? order.addon_ids.map(Number).filter(Number.isFinite) : [],
    serviceArea:order.service_area || order.serviceArea || 'spb',
    city:order.city || 'Санкт-Петербург',
    address:order.address || '',
    apartment:order.apartment || '',
    entrance:order.entrance || '',
    floor:order.floor || '',
    addressComment:order.address_comment || order.addressComment || '',
    visitType:'repeat',
    visitTypeConfirmed:true,
    photoRequired:false,
    knownAddress:false,
    date:'',
    time:'',
    customerName:order.customer_name || state.bootstrap?.user?.name || '',
    phone:order.phone || state.bootstrap?.user?.phone || '',
    contactMethod:order.contact_method || order.contactMethod || 'telegram',
    comment:'',
    step:6,
    idempotencyKey:crypto.randomUUID(),
  };
  state.saveDraft();
  showToast('Данные прошлой уборки подставлены');
  navigate('booking');
}

export async function renderConciergeHome(root,navigate) {
  root.innerHTML = `<div class="cc-home u7-home-v2"><div class="loading"><div><div class="spinner"></div>Загружаем ваш кабинет...</div></div></div>`;
  let orders = [];
  try { orders = await loadOrders(); } catch {}
  if (!root.querySelector('.u7-home-v2')) return;

  const upcoming = activeUpcoming(orders);
  const next = upcoming[0] || null;
  const repeat = repeatableOrder(orders);

  root.innerHTML = `<div class="cc-home u7-home-v2">
    <header class="u7-home-hero cc-greeting-row">
      <div><span class="cc-kicker">HOUSE CLEANING</span><h1 class="cc-greeting">${escapeHtml(greeting())}, ${escapeHtml(displayName())}!</h1><p>Управляйте уборками без лишних шагов.</p></div>
      <div class="cc-monogram">HC</div>
      <button class="u7-home-primary" type="button" data-book-cleaning>Заказать уборку</button>
    </header>

    ${nearestCard(next)}

    <section class="u7-home-actions">
      <button type="button" data-repeat-order ${repeat ? '' : 'disabled'}><span>↻</span><b>Повторить уборку</b><small>${repeat ? 'Данные уже подставим' : 'После первой уборки'}</small></button>
      <button type="button" data-all-orders><span>▤</span><b>Мои заявки</b><small>Статусы и история</small></button>
      <button type="button" data-my-profile><span>⌂</span><b>Мои данные</b><small>Адрес и контакты</small></button>
      <button type="button" data-price><span>₽</span><b>Прайс</b><small>Стоимость услуг</small></button>
    </section>

    ${dashboardSummary(orders,next)}
    ${upcomingSection(orders)}
    ${recentSection(orders)}

    <section class="u7-home-offer">
      <div><span>АБОНЕМЕНТЫ</span><h3>Регулярная уборка без повторного оформления</h3><p>Заранее согласованный график на 5 или 10 уборок.</p></div>
      <button type="button" data-subscriptions>Посмотреть</button>
    </section>

    <section class="u7-home-help"><div><small>Нужна помощь?</small><strong>Менеджер HOUSE CLEANING</strong></div><button type="button" data-manager>Написать</button></section>
  </div>`;

  root.querySelectorAll('[data-book-cleaning]').forEach((button)=>button.onclick=()=>startBooking(navigate));
  root.querySelector('[data-repeat-order]')?.addEventListener('click',()=>repeatOrder(navigate,repeat));
  root.querySelectorAll('[data-all-orders]').forEach((button)=>button.onclick=()=>navigate('orders',{from:'home'}));
  root.querySelector('[data-my-profile]')?.addEventListener('click',()=>navigate('profile',{from:'home'}));
  root.querySelector('[data-price]')?.addEventListener('click',()=>navigate('profile',{section:'price',from:'home'}));
  root.querySelector('[data-subscriptions]')?.addEventListener('click',()=>navigate('profile',{section:'subscriptions',from:'home'}));
  root.querySelector('[data-manager]')?.addEventListener('click',openManager);
  root.querySelector('[data-next-order]')?.addEventListener('click',(event)=>{
    const id = Number(event.currentTarget.dataset.nextOrder || 0);
    if (id) navigate('orders',{orderId:id,from:'home'});
  });
  root.querySelectorAll('[data-home-order]').forEach((card)=>{
    card.onclick=()=>{
      const id=Number(card.dataset.homeOrder || 0);
      if(id) navigate('orders',{orderId:id,from:'home'});
    };
  });
}
