import { api } from '../api.js';
import { escapeHtml, formatDate, formatTime, modal, money, showToast } from '../utils.js';

const CAPACITY = 300;
const PENDING = new Set(['NEW', 'REVIEW']);
const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
const MANAGER_PHONE_FALLBACK = '+79992107977';

let section = 'overview';
let orderFilter = 'all';
let orderSearch = '';
let customDate = '';
let clientSearch = '';
let reviewFilter = 'all';
let reviewSearch = '';
let referralSearch = '';
let orders = [];
let reviews = [];
let referrals = [];
let loadedReviews = false;
let loadedReferrals = false;

function headers(extra = {}) {
  return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '', ...extra };
}

async function getJson(path) {
  const response = await fetch(path, { headers: headers() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`);
  return data;
}

async function postJson(path, body) {
  const response = await fetch(path, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`);
  return data;
}

export async function renderAdmin(root, navigate) {
  document.body.classList.add('admin-ops-mode');
  root.innerHTML = loading('Загружаем рабочий центр...');
  try {
    const data = await api.adminOrders();
    orders = Array.isArray(data?.orders) ? data.orders : [];
    renderSection(root, navigate);
  } catch (error) {
    root.innerHTML = `<div class="ops-error"><h2>Не удалось открыть панель</h2><p>${escapeHtml(error.message || 'Ошибка')}</p><button class="hc-btn hc-btn-blue" data-retry>Повторить</button></div>`;
    root.querySelector('[data-retry]').onclick = () => renderAdmin(root, navigate);
  }
}

async function switchSection(root, navigate, next) {
  section = next;
  if (section === 'reviews' && !loadedReviews) {
    root.innerHTML = shell(loading('Загружаем отзывы...'));
    try { reviews = (await getJson('/api/demo-admin-reviews')).reviews || []; loadedReviews = true; }
    catch (error) { showToast(error.message || 'Не удалось загрузить отзывы', true); }
  }
  if (section === 'referrals' && !loadedReferrals) {
    root.innerHTML = shell(loading('Загружаем рефералы...'));
    try { referrals = (await getJson('/api/demo-admin-referrals')).referrals || []; loadedReferrals = true; }
    catch (error) { showToast(error.message || 'Не удалось загрузить рефералы', true); }
  }
  renderSection(root, navigate);
}

function renderSection(root, navigate) {
  let content = '';
  if (section === 'orders') content = ordersView();
  else if (section === 'clients') content = clientsView();
  else if (section === 'reviews') content = reviewsView();
  else if (section === 'referrals') content = referralsView();
  else content = overviewView();
  root.innerHTML = shell(content);
  bindShell(root, navigate);
  if (section === 'overview') bindOverview(root, navigate);
  if (section === 'orders') bindOrders(root, navigate);
  if (section === 'clients') bindClients(root, navigate);
  if (section === 'reviews') bindReviews(root, navigate);
  if (section === 'referrals') bindReferrals(root, navigate);
}

function shell(content) {
  return `<div class="ops-shell"><header class="ops-header"><div><span class="ops-kicker">HOUSE CLEANING · УПРАВЛЕНИЕ</span><h1>${escapeHtml(sectionTitle())}</h1><p>${escapeHtml(sectionSubtitle())}</p></div><button class="ops-refresh" type="button" data-refresh aria-label="Обновить">↻</button></header><main class="ops-content">${content}</main>${adminNav()}</div>`;
}

function sectionTitle() {
  return ({ overview:'Обзор', orders:'Заказы', clients:'Клиенты', reviews:'Отзывы', referrals:'Рефералы' })[section] || 'Обзор';
}
function sectionSubtitle() {
  return ({ overview:'Ситуация по ближайшим дням и то, что требует внимания.', orders:'Поиск, фильтры и управление заявками.', clients:'История и активность клиентов.', reviews:'Оценки после завершённых уборок.', referrals:'Контроль приглашений и начислений.' })[section] || '';
}

function navIcon(name) {
  const map = {
    overview:'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
    orders:'<svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v14H5V5a2 2 0 0 1 2-2Z"/><path d="M15 3v5h4M8 12h8M8 16h8"/></svg>',
    clients:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.5-4 2.6-6 6-6s5.5 2 6 6M14 15c3.2.1 5 1.8 5.5 5"/></svg>',
    reviews:'<svg viewBox="0 0 24 24"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9L12 3Z"/></svg>',
    referrals:'<svg viewBox="0 0 24 24"><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13"/><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5L12 7Zm0 0h3.5A2.5 2.5 0 1 0 13 4.5L12 7Z"/></svg>',
  };
  return map[name] || '';
}

function adminNav() {
  return `<nav class="ops-nav hc-admin-nav" aria-label="Навигация администратора">${['overview','orders','clients','reviews','referrals'].map((id) => `<button type="button" class="${section === id ? 'active' : ''}" data-admin-section="${id}"><span class="hc-admin-nav-icon">${navIcon(id)}</span><small>${({overview:'Обзор',orders:'Заказы',clients:'Клиенты',reviews:'Отзывы',referrals:'Рефералы'})[id]}</small></button>`).join('')}</nav>`;
}

function bindShell(root, navigate) {
  root.querySelector('[data-refresh]').onclick = async () => {
    try { orders = (await api.adminOrders()).orders || []; loadedReviews = false; loadedReferrals = false; await switchSection(root, navigate, section); }
    catch (error) { showToast(error.message || 'Не удалось обновить', true); }
  };
  root.querySelectorAll('[data-admin-section]').forEach((button) => button.onclick = () => switchSection(root, navigate, button.dataset.adminSection));
}

function overviewView() {
  const days = [daySummary(0,'Сегодня'), daySummary(1,'Завтра'), daySummary(2,'Послезавтра')];
  const today = days[0].date;
  const todayOrders = orders.filter((o) => o.date === today && o.status !== 'CANCELLED').sort(byTime);
  const attention = uniqueOrders(orders.filter((o) => PENDING.has(o.status) && (o.date === today || ageMinutes(o) >= 30))).sort((a,b) => urgencyScore(b)-urgencyScore(a)).slice(0,8);
  return `<section class="ops-stats">${stat('Новые', orders.filter((o)=>PENDING.has(o.status)).length, attention.length?'attention':'')}${stat('Сегодня', todayOrders.length, '')}${stat('Подтверждено', todayOrders.filter((o)=>['CONFIRMED','CLEANER_ASSIGNED'].includes(o.status)).length, '')}${stat('Завершено', todayOrders.filter((o)=>o.status==='COMPLETED').length, 'ok')}</section>
    <div class="ops-title-row"><div><h2>Ближайшие уборки</h2><p>Загрузка каждого дня отдельно.</p></div></div>
    <section class="hc-admin-days">${days.map(dayCard).join('')}</section>
    <div class="ops-title-row"><div><h2>Требует внимания</h2><p>Только заявки, по которым лучше действовать сейчас.</p></div><span>${attention.length}</span></div>
    <section class="ops-attention-list">${attention.length ? attention.map(attentionCard).join('') : '<div class="ops-empty card"><strong>Сейчас всё спокойно</strong><span>Срочных заявок нет.</span></div>'}</section>
    <div class="ops-title-row"><div><h2>Сегодня по времени</h2><p>${formatDate(today)}</p></div><span>${todayOrders.length}</span></div>
    <section class="ops-today-list">${todayOrders.length ? todayOrders.map(scheduleRow).join('') : '<div class="ops-empty card"><strong>На сегодня уборок нет</strong></div>'}</section>`;
}

function daySummary(offset,label) {
  const date = moscowIso(offset);
  const list = orders.filter((o) => o.date === date && o.status !== 'CANCELLED');
  const used = list.reduce((sum,o)=>sum+Math.max(0,Number(o.area||0)),0);
  return { label,date,count:list.length,used,pct:Math.min(100,Math.round((used/CAPACITY)*100)),free:Math.max(0,CAPACITY-used) };
}
function dayCard(day) {
  const cls = day.pct >= 100 ? 'full' : day.pct >= 86 ? 'hot' : day.pct >= 61 ? 'busy' : 'calm';
  return `<button class="card hc-day-card ${cls}" type="button" data-day-date="${day.date}"><div class="hc-day-top"><span>${day.label}</span><b>${formatDate(day.date)}</b></div><strong>${day.count} ${plural(day.count,'уборка','уборки','уборок')}</strong><div class="hc-day-load"><span>${day.used} / ${CAPACITY} м²</span><b>${day.pct}%</b></div><div class="hc-day-track"><i style="width:${day.pct}%"></i></div><small>${day.used >= CAPACITY ? 'День полностью загружен' : `Свободно ${day.free} м²`}</small></button>`;
}
function stat(label,value,cls='') { return `<div class="ops-stat ${cls}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`; }
function attentionCard(order) {
  return `<article class="ops-attention card"><div class="ops-attention-top"><div><span>${escapeHtml(order.order_number||'')}</span><strong>${escapeHtml(order.customer_name||'Клиент')}</strong></div><b>${ageLabel(order)}</b></div><div class="ops-mini-meta">${escapeHtml(order.service_name||'Уборка')} · ${escapeHtml(String(order.area||0))} м² · ${escapeHtml(formatDate(order.date))} ${escapeHtml(formatTime(order.time))}</div><div class="ops-quick-actions"><button class="hc-btn hc-btn-blue" type="button" data-open-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Открыть</button><button class="hc-btn hc-btn-blue" type="button" data-template="manager_callback" data-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Связаться</button>${PENDING.has(order.status)?`<button class="hc-btn hc-btn-green" type="button" data-confirm="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Подтвердить</button>`:''}</div></article>`;
}
function scheduleRow(order) {
  const status = publicStatus(order.status);
  return `<button class="ops-schedule-row card" type="button" data-open-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}"><time>${escapeHtml(formatTime(order.time))}</time><span><strong>${escapeHtml(order.customer_name||'Клиент')}</strong><small>${escapeHtml(order.service_name||'Уборка')} · ${escapeHtml(String(order.area||0))} м²</small></span><em class="status-${status.cls}">${escapeHtml(status.label)}</em></button>`;
}
function bindOverview(root,navigate) {
  root.querySelectorAll('[data-day-date]').forEach((button)=>button.onclick=()=>{ customDate=button.dataset.dayDate; orderFilter='date'; switchSection(root,navigate,'orders'); });
  bindOrderButtons(root,navigate);
}

function ordersView() {
  const visible = filteredAdminOrders();
  const countText = orderSearch.trim() || orderFilter !== 'all' || customDate ? (visible.length ? `Найдено: ${visible.length}` : 'Ничего не найдено') : `Всего заявок: ${orders.length}`;
  return `<div class="ops-search hc-admin-search"><input type="search" data-order-search value="${escapeHtml(orderSearch)}" placeholder="Поиск заявки или клиента"><span>${escapeHtml(countText)}</span></div>
    <div class="ops-filters hc-scroll-chips">${[['all','Все'],['today','Сегодня'],['tomorrow','Завтра'],['dayafter','Послезавтра'],['new','Новые'],['confirmed','Подтверждённые'],['progress','В работе'],['completed','Завершённые'],['cancelled','Отменённые']].map(([id,label])=>`<button type="button" class="${orderFilter===id&&!customDate?'active':''}" data-order-filter="${id}">${label}</button>`).join('')}</div>
    <div class="hc-admin-date-filter"><label>Дата<input type="date" data-custom-date value="${escapeHtml(customDate)}"></label>${customDate||orderFilter!=='all'||orderSearch?'<button class="hc-btn hc-btn-ghost" type="button" data-reset-filter>Сбросить</button>':''}</div>
    <div class="ops-order-list">${visible.length ? visible.map(orderCard).join('') : '<div class="ops-empty card"><strong>Ничего не найдено</strong></div>'}</div>`;
}

function filteredAdminOrders() {
  const dateByFilter = orderFilter==='today'?moscowIso(0):orderFilter==='tomorrow'?moscowIso(1):orderFilter==='dayafter'?moscowIso(2):customDate||'';
  const statusMap = { new:['NEW','REVIEW'],confirmed:['CONFIRMED','CLEANER_ASSIGNED'],progress:['IN_PROGRESS'],completed:['COMPLETED'],cancelled:['CANCELLED'] };
  const statuses = statusMap[orderFilter] || null;
  const q = orderSearch.trim().toLowerCase();
  return orders.filter((order)=>{
    if (dateByFilter && order.date!==dateByFilter) return false;
    if (statuses && !statuses.includes(order.status)) return false;
    if (!q) return true;
    return [order.order_number,order.customer_name,order.phone,order.profile_phone2,order.address,order.city,order.service_name,order.username,order.telegram_username].some((v)=>String(v||'').toLowerCase().includes(q));
  }).sort((a,b)=> dateByFilter ? byTime(a,b) : String(b.created_at||'').localeCompare(String(a.created_at||'')));
}

function orderCard(order) {
  const status=publicStatus(order.status); const price=Number(order.estimated_price||0); const photos=Math.max(Number(order.photo_count||0),Array.isArray(order.photo_file_ids)?order.photo_file_ids.length:0);
  const badges=[]; if(photos)badges.push(`Фото ${photos}`); if(Number(order.discount_percent||0))badges.push(`Скидка ${order.discount_percent}%`); if(order.comment)badges.push('Комментарий'); if(String(order.discount_type||'').startsWith('referral'))badges.push('Реферал');
  return `<article class="ops-order-card card"><div class="ops-order-head"><div><span>${escapeHtml(order.order_number||'')}</span><strong>${escapeHtml(order.customer_name||'Клиент')}</strong></div><em class="status-${status.cls}">${escapeHtml(status.label)}</em></div><div class="ops-order-service">${escapeHtml(order.service_name||'Уборка')}</div><div class="ops-order-grid"><div><span>Дата</span><strong>${escapeHtml(formatDate(order.date))} · ${escapeHtml(formatTime(order.time))}</strong></div><div><span>Площадь</span><strong>${escapeHtml(String(order.area||0))} м²</strong></div><div><span>Стоимость</span><strong>${price?`от ${money(price)}`:'После оценки'}</strong></div><div><span>Телефон</span><strong>${escapeHtml(order.phone||'—')}</strong></div></div><div class="ops-order-line">${escapeHtml([order.city,order.address].filter(Boolean).join(', ')||'Адрес не указан')}</div>${badges.length?`<div class="hc-admin-badges">${badges.map((b)=>`<span>${escapeHtml(b)}</span>`).join('')}</div>`:''}<div class="ops-card-actions"><button class="hc-btn hc-btn-blue" type="button" data-open-order="${escapeHtml(order.order_number)}" data-client="${escapeHtml(order.client_telegram_id)}">Открыть заказ</button><button class="hc-btn hc-btn-blue" type="button" data-chat-client="${escapeHtml(order.client_telegram_id)}">Написать</button>${order.phone?`<button class="hc-btn hc-btn-green" type="button" data-call="${escapeHtml(order.phone)}">Позвонить</button>`:''}</div></article>`;
}

function bindOrders(root,navigate) {
  const input=root.querySelector('[data-order-search]');
  if(input)input.oninput=()=>{orderSearch=input.value;renderSection(root,navigate);const next=root.querySelector('[data-order-search]');if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length);}};
  root.querySelectorAll('[data-order-filter]').forEach((button)=>button.onclick=()=>{customDate='';orderFilter=button.dataset.orderFilter;renderSection(root,navigate);});
  root.querySelector('[data-custom-date]')?.addEventListener('change',(event)=>{customDate=event.target.value;orderFilter=customDate?'date':'all';renderSection(root,navigate);});
  root.querySelector('[data-reset-filter]')?.addEventListener('click',()=>{orderSearch='';customDate='';orderFilter='all';renderSection(root,navigate);});
  bindOrderButtons(root,navigate);
}

function bindOrderButtons(root,navigate) {
  root.querySelectorAll('[data-open-order]').forEach((button)=>button.onclick=()=>{const order=findOrder(button.dataset.client,button.dataset.openOrder);if(order)renderOrderDetail(root,navigate,order);});
  root.querySelectorAll('[data-chat-client]').forEach((button)=>button.onclick=()=>openClientChat(button.dataset.chatClient));
  root.querySelectorAll('[data-call]').forEach((button)=>button.onclick=()=>callPhone(button.dataset.call));
  root.querySelectorAll('[data-template]').forEach((button)=>button.onclick=async()=>{const order=findOrder(button.dataset.client,button.dataset.order);if(order)await sendTemplate(button,order,button.dataset.template);});
  root.querySelectorAll('[data-confirm]').forEach((button)=>button.onclick=async()=>{const order=findOrder(button.dataset.client,button.dataset.confirm);if(!order)return;const ok=await modal({title:'Подтвердить заявку?',text:`${order.order_number} будет подтверждена.`,confirmText:'Подтвердить',cancelText:'Назад'});if(!ok)return;button.disabled=true;try{await api.adminSetStatus(order,'CONFIRMED');order.status='CONFIRMED';showToast('Заявка подтверждена');renderSection(root,navigate);}catch(error){button.disabled=false;showToast(error.message||'Не удалось подтвердить',true);}});
}

async function renderOrderDetail(root,navigate,order) {
  const photos=Math.max(Number(order.photo_count||0),Array.isArray(order.photo_file_ids)?order.photo_file_ids.length:0); const price=Number(order.estimated_price||0); const before=Number(order.price_before_discount||0); const discount=Number(order.discount_percent||0); const status=publicStatus(order.status);
  root.innerHTML=`<div class="ops-detail-shell"><button class="ops-sticky-back hc-fixed-back" type="button" data-back>← Назад</button><header class="ops-detail-head hc-subpage-offset"><div><span>${escapeHtml(order.order_number||'')}</span><h1>${escapeHtml(order.customer_name||'Клиент')}</h1></div><em class="status-${status.cls}">${escapeHtml(status.label)}</em></header><div class="card ops-detail-card">${detail('Телефон',order.phone||'—')}${order.profile_phone2?detail('Доп. телефон',order.profile_phone2):''}${detail('Способ связи',contactMethod(order.contact_method)||'Не выбран')}${detail('Уборка',order.service_name||'—')}${detail('Площадь',`${order.area||0} м²`)}${detail('Дата',formatDate(order.date))}${detail('Время',formatTime(order.time))}${detail('Адрес',[order.city,order.address,order.apartment?`кв./офис ${order.apartment}`:''].filter(Boolean).join(', '))}${detail('Доп. услуги',Array.isArray(order.addon_names)&&order.addon_names.length?order.addon_names.join(', '):'Нет')}${before>price&&discount?detail('Стоимость до скидки',money(before))+detail(`Скидка ${discount}%`, `−${money(before-price)}`):''}${detail('Предварительная стоимость',price?`от ${money(price)}`:'После оценки')}</div><div class="ops-title-row"><div><h2>Быстрые сообщения</h2><p>Готовые сообщения клиенту.</p></div></div><div class="ops-template-grid"><button class="hc-btn hc-btn-blue" type="button" data-template="need_details">Уточнить детали</button><button class="hc-btn hc-btn-blue" type="button" data-template="need_photos">Попросить фото</button><button class="hc-btn hc-btn-blue" type="button" data-template="reminder">Напомнить</button><button class="hc-btn hc-btn-blue" type="button" data-template="manager_callback">Связаться</button></div><div class="card ops-admin-note"><label>Внутренняя заметка</label><textarea data-admin-note maxlength="1200" placeholder="Например: позвонить за 10 минут">${escapeHtml(order.admin_note||'')}</textarea><div><small>Клиент её не видит.</small><button class="hc-btn hc-btn-blue" type="button" data-save-note>Сохранить</button></div></div><div class="ops-title-row"><div><h2>Фото объекта</h2><p>${photos?`${photos} фото`:'Фото нет'}</p></div></div><div class="admin-photo-grid" data-admin-photo-grid>${photos?Array.from({length:photos},(_,i)=>`<button type="button" class="admin-photo-tile loading" data-photo-index="${i}"><span>${i+1}</span></button>`).join(''):'<div class="ops-empty card"><strong>Фото не прикреплены</strong></div>'}</div><div class="card ops-status-box"><label>Статус заявки</label><select data-status>${statusOptions(order.status)}</select></div><div class="hc-order-actions"><button class="hc-btn hc-btn-blue" type="button" data-chat-client="${escapeHtml(order.client_telegram_id)}">Написать клиенту</button>${order.phone?`<button class="hc-btn hc-btn-green" type="button" data-call="${escapeHtml(order.phone)}">Позвонить</button>`:''}</div></div>`;
  root.querySelector('[data-back]').onclick=()=>{section='orders';renderSection(root,navigate);};
  root.querySelectorAll('[data-template]').forEach((button)=>button.onclick=()=>sendTemplate(button,order,button.dataset.template));
  root.querySelector('[data-chat-client]').onclick=()=>openClientChat(order.client_telegram_id);
  root.querySelector('[data-call]')?.addEventListener('click',()=>callPhone(order.phone));
  root.querySelector('[data-save-note]').onclick=async()=>{const button=root.querySelector('[data-save-note]');button.disabled=true;try{const data=await postJson('/api/demo-admin-note',{client_telegram_id:order.client_telegram_id,order_number:order.order_number,note:root.querySelector('[data-admin-note]').value});order.admin_note=data?.order?.admin_note??'';showToast('Заметка сохранена');}catch(error){showToast(error.message||'Не удалось сохранить заметку',true);}finally{button.disabled=false;}};
  const select=root.querySelector('[data-status]'); select.onchange=async()=>{const next=select.value;if(next===order.status)return;const isDanger=next==='CANCELLED';if(['CONFIRMED','CANCELLED'].includes(next)){const ok=await modal({title:isDanger?'Точно отменить заявку?':'Точно подтвердить заявку?',text:isDanger?'Клиент получит уведомление об отмене.':'Клиент получит подтверждение.',confirmText:isDanger?'Да, отменить':'Да, подтвердить',cancelText:'Назад',danger:isDanger});if(!ok){select.value=order.status;return;}}select.disabled=true;try{await api.adminSetStatus(order,next);order.status=next;showToast('Статус обновлён');orders=(await api.adminOrders()).orders||orders;renderSection(root,navigate);}catch(error){select.value=order.status;select.disabled=false;showToast(error.message||'Не удалось изменить статус',true);}};
  if(photos)loadPhotos(root,order,photos);
}

function clientsView() {
  const all=aggregateClients(orders); const q=clientSearch.trim().toLowerCase(); const visible=all.filter((client)=>!q||[client.name,client.phone,client.phone2,client.id].some((v)=>String(v||'').toLowerCase().includes(q))).sort((a,b)=>b.completed-a.completed||b.orders.length-a.orders.length);
  return `<div class="ops-search hc-admin-search"><input type="search" data-client-search value="${escapeHtml(clientSearch)}" placeholder="Поиск клиента"><span>${q?(visible.length?`Найдено: ${visible.length}`:'Ничего не найдено'):`Всего клиентов: ${all.length}`}</span></div><div class="ops-client-list">${visible.length?visible.map(clientCard).join(''):'<div class="ops-empty card"><strong>Ничего не найдено</strong></div>'}</div>`;
}
function clientCard(client) { const discount=client.completed>=10?10:client.completed>=3?5:0; return `<button class="ops-client-card card" type="button" data-client-card="${escapeHtml(client.id)}"><div class="ops-client-avatar">${escapeHtml((client.name||'К').charAt(0).toUpperCase())}</div><span><strong>${escapeHtml(client.name||'Клиент')}</strong><small>${escapeHtml(client.phone||'')}${client.phone2?` · ${escapeHtml(client.phone2)}`:''}</small><em>${client.orders.length} ${plural(client.orders.length,'заявка','заявки','заявок')} · ${client.completed} завершено</em></span><b>${discount?`${discount}%`:'›'}</b></button>`; }
function bindClients(root,navigate) { const input=root.querySelector('[data-client-search]'); if(input)input.oninput=()=>{clientSearch=input.value;renderSection(root,navigate);const next=root.querySelector('[data-client-search]');if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length);}};root.querySelectorAll('[data-client-card]').forEach((button)=>button.onclick=()=>{const client=aggregateClients(orders).find((item)=>String(item.id)===String(button.dataset.clientCard));if(client)renderClientDetail(root,navigate,client);}); }
function renderClientDetail(root,navigate,client) { const discount=client.completed>=10?10:client.completed>=3?5:0; root.innerHTML=`<div class="ops-detail-shell"><button class="ops-sticky-back hc-fixed-back" type="button" data-back>← Назад</button><header class="ops-detail-head hc-subpage-offset"><div><span>КАРТОЧКА КЛИЕНТА</span><h1>${escapeHtml(client.name||'Клиент')}</h1></div></header><section class="ops-client-stats">${stat('Всего заявок',client.orders.length)}${stat('Завершено',client.completed,'ok')}${stat('Отменено',client.cancelled,client.cancelled?'muted':'')}${stat('Скидка',`${discount}%`,discount?'attention':'')}</section><div class="card ops-detail-card">${detail('Основной телефон',client.phone||'—')}${client.phone2?detail('Доп. телефон',client.phone2):''}</div><div class="hc-order-actions"><button class="hc-btn hc-btn-blue" type="button" data-chat-client="${escapeHtml(client.id)}">Написать клиенту</button>${client.phone?`<button class="hc-btn hc-btn-green" type="button" data-call="${escapeHtml(client.phone)}">Позвонить</button>`:''}</div><div class="ops-title-row"><div><h2>История</h2><p>${client.orders.length} заявок</p></div></div><div class="ops-order-list">${client.orders.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).map(orderCard).join('')}</div></div>`; root.querySelector('[data-back]').onclick=()=>{section='clients';renderSection(root,navigate);};root.querySelector('[data-chat-client]').onclick=()=>openClientChat(client.id);root.querySelector('[data-call]')?.addEventListener('click',()=>callPhone(client.phone));bindOrderButtons(root,navigate); }

function reviewsView() {
  const q=reviewSearch.trim().toLowerCase(); const filtered=reviews.filter((r)=>(reviewFilter==='all'||Number(r.rating)===Number(reviewFilter))&&(!q||[r.customer_name,r.order_number,r.text].some((v)=>String(v||'').toLowerCase().includes(q)))); const avg=reviews.length?(reviews.reduce((s,r)=>s+Number(r.rating||0),0)/reviews.length).toFixed(1):'—';
  return `<section class="ops-extra-stats"><div><span>Всего</span><strong>${reviews.length}</strong></div><div><span>Средняя</span><strong>${avg}${avg!=='—'?' ★':''}</strong></div><div><span>5 звёзд</span><strong>${reviews.filter((r)=>Number(r.rating)===5).length}</strong></div></section><div class="ops-search hc-admin-search"><input type="search" data-review-search value="${escapeHtml(reviewSearch)}" placeholder="Поиск по отзыву"><span>${q||reviewFilter!=='all'?(filtered.length?`Найдено: ${filtered.length}`:'Ничего не найдено'):`Всего отзывов: ${reviews.length}`}</span></div><div class="ops-review-filters hc-scroll-chips">${['all',5,4,3,2,1].map((v)=>`<button type="button" class="${String(reviewFilter)===String(v)?'active':''}" data-review-filter="${v}">${v==='all'?'Все':`${v}★`}</button>`).join('')}</div><div class="ops-review-list">${filtered.length?filtered.map(reviewCard).join(''):'<div class="ops-empty card"><strong>Ничего не найдено</strong></div>'}</div>`;
}
function reviewCard(review) { const rating=Math.max(1,Math.min(5,Number(review.rating||0))); const count=Array.isArray(review.photo_file_ids)?review.photo_file_ids.length:0; return `<article class="card ops-review-card"><div class="ops-review-head"><div><strong>${'★'.repeat(rating)}<span>${'★'.repeat(5-rating)}</span></strong><small>${formatDateTime(review.created_at)}</small></div><b>${rating}/5</b></div><div class="ops-review-client"><strong>${escapeHtml(review.customer_name||'Клиент')}</strong><span>${escapeHtml(review.order_number||'')}</span></div>${review.text?`<p>${escapeHtml(review.text)}</p>`:'<p class="muted">Без текстового комментария</p>'}<div class="ops-review-photo-label">Фото: ${count?count:'нет'}</div>${count?`<div class="ops-review-photos">${Array.from({length:count},(_,index)=>`<button type="button" class="loading" data-review-photo data-user="${escapeHtml(review.client_telegram_id)}" data-order="${escapeHtml(review.order_number)}" data-index="${index}"><span>${index+1}</span></button>`).join('')}</div>`:''}</article>`; }
function bindReviews(root,navigate) { const input=root.querySelector('[data-review-search]');if(input)input.oninput=()=>{reviewSearch=input.value;renderSection(root,navigate);const next=root.querySelector('[data-review-search]');if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length);}};root.querySelectorAll('[data-review-filter]').forEach((button)=>button.onclick=()=>{reviewFilter=button.dataset.reviewFilter;renderSection(root,navigate);});loadReviewPhotos(root); }
async function loadReviewPhotos(root) { await Promise.all([...root.querySelectorAll('[data-review-photo]')].map(async(button)=>{try{const q=new URLSearchParams({user:button.dataset.user,order:button.dataset.order,index:button.dataset.index});const response=await fetch(`/api/demo-admin-review-photo?${q}`,{headers:headers()});if(!response.ok)throw new Error();const url=URL.createObjectURL(await response.blob());button.classList.remove('loading');button.innerHTML=`<img src="${url}" alt="Фото к отзыву">`;button.onclick=()=>openSinglePhoto(url);}catch{button.classList.remove('loading');button.textContent='Недоступно';}})); }

function referralsView() { const q=referralSearch.trim().toLowerCase(); const visible=referrals.filter((r)=>!q||[r.inviter_name,r.friend_name,r.inviter_id,r.friend_id].some((v)=>String(v||'').toLowerCase().includes(q))); const ordered=referrals.filter((r)=>r.order_created).length,completed=referrals.filter((r)=>r.completed).length,rewarded=referrals.filter((r)=>r.inviter_rewarded).length; return `<section class="ops-extra-stats four"><div><span>Приглашено</span><strong>${referrals.length}</strong></div><div><span>Оформили</span><strong>${ordered}</strong></div><div><span>Завершили</span><strong>${completed}</strong></div><div><span>Награждено</span><strong>${rewarded}</strong></div></section><div class="ops-search hc-admin-search"><input type="search" data-ref-search value="${escapeHtml(referralSearch)}" placeholder="Поиск реферала"><span>${q?(visible.length?`Найдено: ${visible.length}`:'Ничего не найдено'):`Всего: ${referrals.length}`}</span></div><div class="ops-ref-list">${visible.length?visible.map(referralCard).join(''):'<div class="ops-empty card"><strong>Ничего не найдено</strong></div>'}</div>`; }
function referralCard(item) { const steps=[['Перешёл по ссылке',true],['Оформил заявку',item.order_created],['Заявка подтверждена',item.order_confirmed],['Уборка завершена',item.completed],['15% начислены пригласившему',item.inviter_rewarded]]; return `<article class="card ops-ref-card"><div class="ops-ref-people"><div><span>Пригласил</span><strong>${escapeHtml(item.inviter_name||`ID ${item.inviter_id}`)}</strong></div><b>→</b><div><span>Друг</span><strong>${escapeHtml(item.friend_name||`ID ${item.friend_id}`)}</strong></div></div><div class="ops-ref-date">${escapeHtml(formatDateTime(item.registered_at))}</div><div class="ops-ref-steps">${steps.map(([label,done])=>`<div class="${done?'done':''}"><i>${done?'✓':'·'}</i><span>${escapeHtml(label)}</span></div>`).join('')}</div><div class="ops-ref-foot"><span>Доступно наград</span><strong>${Number(item.inviter_rewards_available||0)} × 15%</strong></div></article>`; }
function bindReferrals(root,navigate) { const input=root.querySelector('[data-ref-search]');if(input)input.oninput=()=>{referralSearch=input.value;renderSection(root,navigate);const next=root.querySelector('[data-ref-search]');if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length);}}; }

async function sendTemplate(button,order,template) { button.disabled=true;try{await postJson('/api/demo-admin-message',{client_telegram_id:order.client_telegram_id,order_number:order.order_number,template});showToast('Сообщение отправлено');}catch(error){showToast(error.message||'Не удалось отправить сообщение',true);}finally{button.disabled=false;} }
function openClientChat(id) { const url=`tg://user?id=${encodeURIComponent(String(id||''))}`;const tg=window.Telegram?.WebApp;if(tg?.openTelegramLink)tg.openTelegramLink(url);else window.location.href=url; }
function callPhone(phone=MANAGER_PHONE_FALLBACK) { const clean=String(phone||'').replace(/[^+\d]/g,'');if(clean)window.location.href=`tel:${clean}`; }
async function loadPhotos(root,order,count) { for(let i=0;i<count;i+=1){const tile=root.querySelector(`[data-photo-index="${i}"]`);if(!tile)continue;try{const q=new URLSearchParams({user:String(order.client_telegram_id),order:String(order.order_number),index:String(i)});const response=await fetch(`/api/demo-admin-photo?${q}`,{headers:headers()});if(!response.ok)throw new Error();const url=URL.createObjectURL(await response.blob());tile.classList.remove('loading');tile.innerHTML=`<img src="${url}" alt="Фото ${i+1}"><span>${i+1}</span>`;tile.onclick=()=>openSinglePhoto(url);}catch{tile.classList.remove('loading');tile.innerHTML='<span>Недоступно</span>';}} }
function openSinglePhoto(url) { const overlay=document.createElement('div');overlay.className='admin-lightbox';overlay.innerHTML=`<div class="admin-lightbox-top"><button type="button">×</button></div><div class="admin-lightbox-stage"><img src="${url}" alt="Фото"></div>`;document.body.appendChild(overlay);overlay.querySelector('button').onclick=()=>overlay.remove();overlay.onclick=(event)=>{if(event.target===overlay)overlay.remove();}; }

function aggregateClients(list) { const map=new Map();for(const order of list){const id=String(order.client_telegram_id||'');if(!id)continue;if(!map.has(id))map.set(id,{id,name:order.customer_name||'Клиент',phone:order.phone||'',phone2:order.profile_phone2||'',orders:[],completed:0,cancelled:0});const client=map.get(id);client.orders.push(order);if(order.status==='COMPLETED')client.completed+=1;if(order.status==='CANCELLED')client.cancelled+=1;if(order.customer_name)client.name=order.customer_name;if(order.phone)client.phone=order.phone;if(order.profile_phone2)client.phone2=order.profile_phone2;}return [...map.values()]; }
function detail(label,value) { return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value??'—'))}</strong></div>`; }
function statusOptions(current) { return [['NEW','Новая'],['REVIEW','На проверке'],['CONFIRMED','Подтверждена'],['CLEANER_ASSIGNED','Клинер назначен'],['IN_PROGRESS','В работе'],['COMPLETED','Завершена'],['CANCELLED','Отменена']].map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join(''); }
function publicStatus(status) { if(['NEW','REVIEW'].includes(status))return{label:'Новая',cls:'pending'};if(['CONFIRMED','CLEANER_ASSIGNED'].includes(status))return{label:'Подтверждена',cls:'confirmed'};if(status==='IN_PROGRESS')return{label:'В работе',cls:'progress'};if(status==='COMPLETED')return{label:'Завершена',cls:'completed'};if(status==='CANCELLED')return{label:'Отменена',cls:'cancelled'};return{label:'Заявка',cls:'neutral'}; }
function contactMethod(value) { return ({telegram:'Telegram',whatsapp:'WhatsApp',max:'MAX',call:'Звонок'})[String(value||'').toLowerCase()]||''; }
function findOrder(clientId,number) { return orders.find((o)=>String(o.client_telegram_id)===String(clientId)&&String(o.order_number)===String(number)); }
function uniqueOrders(list) { const seen=new Set();return list.filter((o)=>{const key=`${o.client_telegram_id}:${o.order_number}`;if(seen.has(key))return false;seen.add(key);return true;}); }
function ageMinutes(order) { const ts=Date.parse(order.created_at||'');return Number.isFinite(ts)?Math.max(0,Math.floor((Date.now()-ts)/60000)):0; }
function ageLabel(order) { const wait=ageMinutes(order);return wait>=60?`${Math.floor(wait/60)} ч`:`${wait} мин`; }
function urgencyScore(order) { return (order.date===moscowIso(0)?100000:0)+ageMinutes(order); }
function byTime(a,b) { return String(a.time||'').localeCompare(String(b.time||'')); }
function moscowIso(offset=0) { const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now()+offset*86400000));const get=(type)=>parts.find((p)=>p.type===type)?.value||'';return `${get('year')}-${get('month')}-${get('day')}`; }
function formatDateTime(value) { const date=new Date(value||'');if(!Number.isFinite(date.getTime()))return'—';return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date).replace(',',' ·'); }
function plural(n,one,few,many){const v=Math.abs(Number(n))%100;const d=v%10;if(v>10&&v<20)return many;if(d===1)return one;if(d>=2&&d<=4)return few;return many;}
function loading(text) { return `<div class="loading"><div><div class="spinner"></div>${escapeHtml(text)}</div></div>`; }
