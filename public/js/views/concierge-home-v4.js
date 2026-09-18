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

function subscriptionState() {
  const profile = state.bootstrap?.user || {};
  const name = String(profile.subscription_name || '').trim();
  const total = Math.max(0, Number(profile.cleanings_total || 0));
  const remaining = Math.max(0, Number(profile.cleanings_remaining || 0));
  const active = Boolean(name || total > 0);
  return { active, name, total, remaining, used: active && total > 0 ? Math.max(0, total - remaining) : 0 };
}

function activeDraft() {
  return Number(state.draft?.step || 0) > 0;
}

function draftStepLabel() {
  const step = Number(state.draft?.step || 0);
  return ({
    1:'выбор уборки',2:'данные об объекте',3:'дополнительные услуги',4:'адрес',
    5:'первый или повторный заказ',6:'дата и время',7:'контакты',8:'проверка заявки',
  })[step] || 'оформление заказа';
}

function resumeCard() {
  if (!activeDraft()) return '';
  return `<section class="u7-resume-card-v60">
    <div class="u7-resume-icon-v60">↗</div>
    <div><span class="u7-eyebrow">НЕЗАВЕРШЁННЫЙ ЗАКАЗ</span><h3>Продолжить оформление</h3><p>Вы остановились на этапе: ${escapeHtml(draftStepLabel())}.</p></div>
    <button type="button" data-resume-order>Продолжить</button>
    <button type="button" class="u7-resume-new-v60" data-start-new-order>Начать заново</button>
  </section>`;
}

function nearestCard(order) {
  if (!order) return '';
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
  const sub = subscriptionState();
  const last = completed[0] || null;

  if (sub.active) {
    const total = Math.max(1, sub.total || sub.used + sub.remaining || 1);
    const used = Math.min(total, Math.max(0, sub.used));
    const percent = Math.max(0, Math.min(100, Math.round(used / total * 100)));
    return `<section class="u7-home-summary u7-home-summary-v3 u7-plan-summary-v60">
      <div class="u7-home-summary-title"><div><span class="u7-eyebrow">ВАШ АБОНЕМЕНТ</span><h2>${escapeHtml(sub.name || `План на ${total} уборок`)}</h2></div><span>${used} из ${total}</span></div>
      <div class="u7-plan-progress-v60"><i style="width:${percent}%"></i></div>
      <div class="u7-service-stats">
        <div class="u7-service-stat"><small>Выполнено</small><b>${used}</b><span>уборок по плану</span></div>
        <div class="u7-service-stat"><small>Осталось</small><b>${sub.remaining}</b><span>до завершения плана</span></div>
      </div>
      <div class="u7-service-timeline">
        ${last ? `<div><span>Последняя</span><b>${escapeHtml(formatDate(last.date))} · ${escapeHtml(formatTime(last.time))}</b></div>` : ''}
        ${next ? `<div class="is-next"><span>Следующая</span><b>${escapeHtml(formatDate(next.date))} · ${escapeHtml(formatTime(next.time))}</b></div>` : ''}
      </div>
    </section>`;
  }

  const goal = 10;
  const done = completed.length > 0 && completed.length % goal === 0 ? goal : completed.length % goal;
  const left = Math.max(0, goal - done);
  const percent = Math.round(done / goal * 100);
  return `<section class="u7-home-summary u7-home-summary-v3 u7-progress-summary-v60">
    <div class="u7-home-summary-title"><div><span class="u7-eyebrow">ВАШ ПРОГРЕСС</span><h2>${done} из ${goal} уборок</h2></div><span>${left ? `до цели ещё ${left}` : 'цель выполнена'}</span></div>
    <div class="u7-plan-progress-v60"><i style="width:${percent}%"></i></div>
    <div class="u7-service-stats">
      <div class="u7-service-stat"><small>Выполнено</small><b>${completed.length}</b><span>за всё время</span></div>
      <div class="u7-service-stat"><small>${next ? 'Ближайшая' : 'Следующая цель'}</small><b>${next ? escapeHtml(formatDate(next.date)) : left}</b><span>${next ? escapeHtml(formatTime(next.time)) : 'уборок до 10'}</span></div>
    </div>
    ${last ? `<div class="u7-service-timeline"><div><span>Последняя уборка</span><b>${escapeHtml(formatDate(last.date))} · ${escapeHtml(formatTime(last.time))}</b></div></div>` : ''}
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
  if (!upcoming.length) return '';
  return `<section class="cc-section hc-home-week-section-v54 u7-week-v3">
    <div class="cc-section-head hc-home-section-head-v54"><div><span class="u7-eyebrow">РАСПИСАНИЕ</span><h2>Ближайшие 7 дней</h2><span>${upcoming.length === 1 ? '1 уборка запланирована' : `${upcoming.length} уборки запланировано`}</span></div><button type="button" data-all-orders>Все</button></div>
    <div class="hc-home-week-list-v54">${upcoming.slice(0,3).map(compactOrderCard).join('')}</div>
  </section>`;
}

function smartSection(order) {
  if (!order) return '';
  const address = [order.city,order.address].filter(Boolean).join(', ');
  return `<section class="u7-smart-card">
    <div class="u7-smart-icon">↻</div>
    <div><span class="u7-eyebrow">БЫСТРЫЙ ПОВТОР</span><h3>Повторить последнюю уборку</h3><p>${escapeHtml(order.service_name || 'Уборка')}${address ? ` · ${escapeHtml(address)}` : ''}</p></div>
    <button type="button" data-repeat-order>Повторить</button>
  </section>`;
}

function subscriptionOffer() {
  if (subscriptionState().active) return '';
  return `<section class="u7-home-offer u7-home-offer-v3 u7-sub-offer-v60">
    <div class="u7-sub-offer-media-v60"><img src="/assets/subscription-promo-v60.jpg" alt="" loading="lazy"></div>
    <div class="u7-sub-offer-copy-v60"><span class="u7-eyebrow">АБОНЕМЕНТЫ</span><h3>Чистота по вашему графику</h3><p>5 или 10 уборок без повторного заполнения заявки. Согласуем даты заранее и закрепим удобный формат.</p><button type="button" data-subscriptions>Подробнее</button></div>
  </section>`;
}

function supportSection() {
  return `<section class="u7-home-help u7-home-help-v3">
    <div class="u7-help-icon">💬</div>
    <div><span class="u7-eyebrow">ПОДДЕРЖКА</span><strong>Менеджер HOUSE CLEANING</strong><small>Вопрос по заявке, адресу или графику — напишите напрямую.</small></div>
    <button type="button" data-manager>Написать</button>
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

async function startBooking(navigate) {
  if (activeDraft()) await state.resetDraft();
  state.draft.step = 1;
  state.saveDraft();
  navigate('booking');
}

function continueBooking(navigate) {
  if (!activeDraft()) return startBooking(navigate);
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

  root.innerHTML = `<div class="cc-home u7-home-v2 u7-home-v3">
    <header class="u7-home-hero cc-greeting-row">
      <div><span class="cc-kicker">HOUSE CLEANING</span><h1 class="cc-greeting">${escapeHtml(greeting())}, ${escapeHtml(displayName())}!</h1><p>Ваша уборка, график и поддержка — в одном месте.</p></div>
      <div class="cc-monogram">HC</div>
      <button class="u7-home-primary" type="button" data-book-cleaning><span>＋</span> Заказать уборку</button>
    </header>

    ${nearestCard(next)}
    ${dashboardSummary(orders,next)}
    ${upcomingSection(orders)}
    ${smartSection(repeat)}

    <section class="u7-home-offer u7-home-offer-v3">
      <div><span class="u7-eyebrow">АБОНЕМЕНТЫ</span><h3>Регулярная уборка по вашему графику</h3><p>5 или 10 уборок без повторного заполнения заявки каждый раз.</p></div>
      <button type="button" data-subscriptions>Подробнее</button>
    </section>

    ${supportSection()}
  </div>`;

  root.querySelectorAll('[data-book-cleaning]').forEach((button)=>button.onclick=()=>startBooking(navigate));
  root.querySelector('[data-repeat-order]')?.addEventListener('click',()=>repeatOrder(navigate,repeat));
  root.querySelectorAll('[data-all-orders]').forEach((button)=>button.onclick=()=>navigate('orders',{from:'home'}));
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
