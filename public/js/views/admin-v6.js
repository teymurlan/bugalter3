import { api } from '../api.js';
import { escapeHtml, formatDate, formatTime, money, showToast } from '../utils.js';

const ACTIVE = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
const PENDING = new Set(['NEW', 'REVIEW']);
const CAPACITY = 300;
let section = 'staff';
let orders = [];
let staff = [];
let selectedStaffId = null;
let orderFilter = 'all';
let orderSearch = '';

const tg = window.Telegram?.WebApp;
const headers = (extra = {}) => ({ 'X-Telegram-Init-Data': tg?.initData || '', ...extra });
async function getJson(path) {
  const r = await fetch(path, { headers: headers() });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok === false) throw new Error(d?.error || `Ошибка ${r.status}`);
  return d;
}
async function postJson(path, body = {}) {
  const r = await fetch(path, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok === false) throw new Error(d?.error || `Ошибка ${r.status}`);
  return d;
}
function haptic(type = 'selectionChanged') { try { tg?.HapticFeedback?.[type]?.(); } catch {} }
function moscowIso(offset = 0) {
  const now = new Date(Date.now() + 3 * 3600000);
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
}
function statusLabel(s) {
  return ({ NEW:'Новая', REVIEW:'Проверить', CONFIRMED:'Подтверждена', CLEANER_ASSIGNED:'Назначен', IN_PROGRESS:'В работе', COMPLETED:'Завершена', CANCELLED:'Отменена' })[s] || s || '—';
}
function statusClass(s) {
  if (s === 'COMPLETED') return 'ok';
  if (s === 'IN_PROGRESS' || s === 'CLEANER_ASSIGNED') return 'work';
  if (s === 'CANCELLED') return 'muted';
  if (PENDING.has(s)) return 'new';
  return 'wait';
}
function staffStatusLabel(s) {
  return ({ active:'На смене', free:'Свободен', break:'Перерыв', dayoff:'Выходной', suspended:'Не активен' })[s] || 'Свободен';
}
function initials(name='') { return String(name).split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase() || 'HC'; }
function photo(person) {
  return person.photo_url ? `<img src="${escapeHtml(person.photo_url)}" alt="">` : `<span>${escapeHtml(initials(person.name))}</span>`;
}
function icon(name) {
  const m = {
    staff:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c.5-4 2.6-6 6-6s5.5 2 6 6M14 15c3 .1 4.8 1.8 5.3 5"/></svg>',
    orders:'<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>',
    home:'<svg viewBox="0 0 24 24"><path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M9.5 20v-6h5v6"/></svg>',
    more:'<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
    search:'<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>',
  }; return m[name] || '';
}

export async function renderAdmin(root, navigate) {
  document.body.classList.add('admin-ops-mode','hc-admin-mobile');
  root.innerHTML = '<div class="hc-mobile-loading"><span></span>Открываем управление…</div>';
  await reload();
  paint(root);
}
async function reload() {
  const [o, s] = await Promise.allSettled([api.adminOrders(), getJson('/api/admin-staff')]);
  if (o.status === 'fulfilled') orders = Array.isArray(o.value?.orders) ? o.value.orders : [];
  else throw o.reason;
  staff = s.status === 'fulfilled' && Array.isArray(s.value?.staff) ? s.value.staff : [];
}
function paint(root) {
  const body = selectedStaffId ? staffProfile() : section === 'orders' ? ordersView() : section === 'home' ? homeView() : section === 'more' ? moreView() : staffView();
  root.innerHTML = `<div class="hc-mobile-shell">${body}${selectedStaffId ? '' : bottomNav()}</div>`;
  bind(root);
}
function top(title, subtitle='') {
  return `<header class="hc-m-head"><div class="hc-m-brand"><span class="hc-m-logo">HC</span><div><strong>House Cleaning</strong><small>Админ</small></div></div><button class="hc-m-bell" type="button" data-refresh aria-label="Обновить">↻</button></header><div class="hc-m-title"><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>`:''}</div>`;
}
function bottomNav() {
  const items = [['home','Главная'],['orders','Заявки'],['staff','Сотрудники'],['more','Ещё']];
  return `<nav class="hc-m-nav">${items.map(([id,l])=>`<button class="${section===id?'active':''}" data-sec="${id}" type="button"><span>${icon(id)}</span><small>${l}</small></button>`).join('')}</nav>`;
}
function staffView() {
  const counts = { all:staff.length, active:staff.filter(x=>x.status==='active').length, free:staff.filter(x=>x.status==='free').length, off:staff.filter(x=>['dayoff','suspended'].includes(x.status)).length };
  return `${top('Сотрудники','Команда, графики и готовность к заказам')}
    <section class="hc-m-toolbar"><label class="hc-m-search">${icon('search')}<input data-staff-search placeholder="Поиск сотрудника"></label><button class="hc-m-filter" data-add-staff type="button">＋</button></section>
    <section class="hc-m-pills"><button class="active">Все <b>${counts.all}</b></button><button>На смене <b>${counts.active}</b></button><button>Свободны <b>${counts.free}</b></button><button>Выходной <b>${counts.off}</b></button></section>
    <section class="hc-m-kpis"><div><span>Команда</span><b>${counts.all}</b></div><div><span>На смене</span><b>${counts.active}</b></div><div><span>Свободны</span><b>${counts.free}</b></div></section>
    <div class="hc-m-section-row"><h2>Команда</h2><button data-add-staff>Добавить</button></div>
    <section class="hc-staff-list">${staff.length ? staff.map(staffCard).join('') : emptyStaff()}</section>`;
}
function emptyStaff() {
  return `<div class="hc-empty"><div>👥</div><h3>Добавьте первого сотрудника</h3><p>После добавления сотрудник получит доступ к регламенту и обязательному обучению.</p><button class="hc-primary" data-add-staff>Добавить сотрудника</button></div>`;
}
function staffCard(p) {
  const activeOrder = orders.find(o => String(o.assigned_staff_id||'') === String(p.telegram_id) && ['CLEANER_ASSIGNED','IN_PROGRESS'].includes(o.status));
  const training = Number(p.training_progress || 0);
  return `<article class="hc-staff-card" data-staff-card="${escapeHtml(String(p.telegram_id))}">
    <button class="hc-staff-main" type="button" data-open-staff="${escapeHtml(String(p.telegram_id))}"><span class="hc-avatar">${photo(p)}</span><span class="hc-staff-copy"><b>${escapeHtml(p.name || 'Сотрудник')}</b><small>${escapeHtml(p.role || 'Клинер')}</small><span class="hc-staff-meta">★ ${Number(p.rating||5).toFixed(1)} · ${Number(p.orders_completed||0)} заказов</span></span><span class="hc-state ${escapeHtml(p.status||'free')}"><i></i>${escapeHtml(staffStatusLabel(p.status))}</span></button>
    ${activeOrder ? `<div class="hc-live-order"><span>Сейчас</span><b>${escapeHtml(activeOrder.address || activeOrder.service_name || 'Заказ')}</b><small>до ${escapeHtml(formatTime(activeOrder.time_end || activeOrder.time || '')) || 'завершения'}</small></div>` : `<div class="hc-training-mini"><span>Обучение</span><div><i style="width:${training}%"></i></div><b>${training}%</b></div>`}
    <div class="hc-card-actions"><button data-assign-staff="${escapeHtml(String(p.telegram_id))}">Назначить</button><button data-contact-staff="${escapeHtml(String(p.telegram_id))}">Связаться</button><button data-open-staff="${escapeHtml(String(p.telegram_id))}">Кабинет</button></div>
  </article>`;
}
function staffProfile() {
  const p = staff.find(x => String(x.telegram_id) === String(selectedStaffId));
  if (!p) { selectedStaffId = null; return staffView(); }
  const assigned = orders.filter(o=>String(o.assigned_staff_id||'')===String(p.telegram_id));
  const active = assigned.filter(o=>ACTIVE.has(o.status));
  const today = active.filter(o=>o.date===moscowIso(0)).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  return `<header class="hc-profile-top"><button data-back-staff>‹ Назад</button><b>Карточка сотрудника</b><button data-edit-staff="${escapeHtml(String(p.telegram_id))}">•••</button></header>
    <main class="hc-profile-body"><section class="hc-profile-hero"><span class="hc-avatar big">${photo(p)}</span><div><h1>${escapeHtml(p.name)}</h1><p>${escapeHtml(p.role||'Клинер')}</p><span class="hc-state ${escapeHtml(p.status||'free')}"><i></i>${escapeHtml(staffStatusLabel(p.status))}</span></div></section>
    <section class="hc-profile-kpis"><div><span>Рейтинг</span><b>${Number(p.rating||5).toFixed(1)}</b></div><div><span>Заказов</span><b>${Number(p.orders_completed||0)}</b></div><div><span>Обучение</span><b>${Number(p.training_progress||0)}%</b></div><div><span>Пунктуальность</span><b>${Number(p.punctuality||100)}%</b></div></section>
    <section class="hc-profile-actions"><button class="primary" data-contact-staff="${escapeHtml(String(p.telegram_id))}">☎︎ / 💬 Связаться</button><button data-assign-staff="${escapeHtml(String(p.telegram_id))}">Назначить</button><button data-edit-staff="${escapeHtml(String(p.telegram_id))}">Изменить</button></section>
    <section class="hc-block"><div class="hc-block-head"><h2>Сегодня</h2><span>${today.length} ${today.length===1?'заказ':'заказа'}</span></div>${today.length?today.map(orderCompact).join(''):'<p class="hc-muted">Сегодня заказов нет.</p>'}</section>
    <section class="hc-block"><div class="hc-block-head"><h2>Обучение и регламент</h2><span>${Number(p.training_progress||0)}%</span></div><div class="hc-progress"><i style="width:${Number(p.training_progress||0)}%"></i></div><div class="hc-info-row"><span>Регламент</span><b>${p.regulations_accepted?'Ознакомлен':'Не подтверждён'}</b></div><div class="hc-info-row"><span>Тест</span><b>${Number(p.quiz_score||0)}%</b></div><div class="hc-info-row"><span>Шпаргалка</span><b>${p.training_complete?'Доступна':'После обучения'}</b></div></section>
    <section class="hc-block"><div class="hc-block-head"><h2>Навыки</h2></div><div class="hc-tags">${(Array.isArray(p.skills)?p.skills:['Генеральная уборка','После ремонта']).map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div></section>
    </main>`;
}
function homeView() {
  const today = moscowIso(0);
  const list = orders.filter(o=>o.date===today && o.status!=='CANCELLED');
  const used = list.filter(o=>o.status!=='COMPLETED').reduce((s,o)=>s+Number(o.area||0),0);
  const pending = orders.filter(o=>PENDING.has(o.status)).length;
  const free = staff.filter(s=>s.status==='free').length;
  return `${top('Сегодня','Главное без лишнего')}
    <section class="hc-home-kpis"><button data-sec="orders"><span>Новые заявки</span><b>${pending}</b><small>требуют внимания</small></button><button data-sec="staff"><span>Свободны</span><b>${free}</b><small>можно назначить</small></button><div><span>Загрузка</span><b>${used}/${CAPACITY}</b><small>м² сегодня</small></div></section>
    <section class="hc-block"><div class="hc-block-head"><h2>Расписание</h2><span>${list.length}</span></div>${list.length?list.sort((a,b)=>String(a.time).localeCompare(String(b.time))).map(orderCompact).join(''):'<p class="hc-muted">Заказов на сегодня нет.</p>'}</section>
    <section class="hc-block"><div class="hc-block-head"><h2>Требует внимания</h2></div>${orders.filter(o=>PENDING.has(o.status)).slice(0,5).map(orderCompact).join('')||'<p class="hc-muted">Всё обработано.</p>'}</section>`;
}
function orderCompact(o) {
  return `<button class="hc-order-compact" data-order-detail="${escapeHtml(o.order_number||'')}"><time>${escapeHtml(formatTime(o.time)||'—')}</time><span><b>${escapeHtml(o.customer_name||o.service_name||'Заказ')}</b><small>${escapeHtml(o.address||'')}</small></span><em class="${statusClass(o.status)}">${escapeHtml(statusLabel(o.status))}</em></button>`;
}
function ordersView() {
  const q = orderSearch.trim().toLowerCase();
  const filtered = orders.filter(o => {
    if (orderFilter==='new' && !PENDING.has(o.status)) return false;
    if (orderFilter==='work' && !['CONFIRMED','CLEANER_ASSIGNED','IN_PROGRESS'].includes(o.status)) return false;
    if (orderFilter==='done' && o.status!=='COMPLETED') return false;
    if (q && ![o.customer_name,o.address,o.order_number,o.service_name].some(v=>String(v||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  return `${top('Заявки','Контроль заказов, статусов и назначения')}
    <section class="hc-m-toolbar"><label class="hc-m-search">${icon('search')}<input data-order-search value="${escapeHtml(orderSearch)}" placeholder="Клиент, адрес или номер"></label></section>
    <section class="hc-m-pills"><button class="${orderFilter==='all'?'active':''}" data-filter="all">Все <b>${orders.length}</b></button><button class="${orderFilter==='new'?'active':''}" data-filter="new">Новые <b>${orders.filter(o=>PENDING.has(o.status)).length}</b></button><button class="${orderFilter==='work'?'active':''}" data-filter="work">В работе <b>${orders.filter(o=>['CONFIRMED','CLEANER_ASSIGNED','IN_PROGRESS'].includes(o.status)).length}</b></button><button class="${orderFilter==='done'?'active':''}" data-filter="done">Готово <b>${orders.filter(o=>o.status==='COMPLETED').length}</b></button></section>
    <section class="hc-orders-list">${filtered.length?filtered.map(orderCard).join(''):'<div class="hc-empty"><h3>Ничего не найдено</h3><p>Измените фильтр или поиск.</p></div>'}</section>`;
}
function orderCard(o) {
  const assigned = staff.find(s=>String(s.telegram_id)===String(o.assigned_staff_id||''));
  return `<article class="hc-order-card"><div class="hc-order-time"><b>${escapeHtml(formatTime(o.time)||'—')}</b><small>${o.date===moscowIso(0)?'Сегодня':escapeHtml(formatDate(o.date))}</small></div><div class="hc-order-main"><div class="hc-order-line"><h3>${escapeHtml(o.customer_name||'Клиент')}</h3><span class="hc-order-status ${statusClass(o.status)}"><i></i>${escapeHtml(statusLabel(o.status))}</span></div><p>${escapeHtml(o.service_name||'Уборка')} · ${Number(o.area||0)} м²</p><p class="addr">⌖ ${escapeHtml(o.address||'Адрес не указан')}</p><div class="hc-order-bottom"><b>${Number(o.estimated_price||0)?money(o.estimated_price):'Цена уточняется'}</b><span>${assigned?`👤 ${escapeHtml(assigned.name)}`:'Не назначен'}</span></div></div><div class="hc-card-actions four"><button data-assign-order="${escapeHtml(o.order_number||'')}">Назначить</button><button data-contact-order="${escapeHtml(o.order_number||'')}">Связаться</button><button data-reschedule="${escapeHtml(o.order_number||'')}">Перенести</button><button data-order-detail="${escapeHtml(o.order_number||'')}">Подробнее</button></div></article>`;
}
function moreView() {
  return `${top('Ещё','Настройки управления')}
    <section class="hc-block hc-menu-list"><button data-sec="home"><span>⌂</span><div><b>Обзор дня</b><small>Загрузка и важные события</small></div>›</button><button data-sec="orders"><span>▤</span><div><b>Все заявки</b><small>Поиск, статусы и назначения</small></div>›</button><button data-sec="staff"><span>👥</span><div><b>Сотрудники</b><small>Команда и обучение</small></div>›</button><button data-refresh><span>↻</span><div><b>Обновить данные</b><small>Получить актуальную информацию</small></div>›</button></section>`;
}

function bind(root) {
  root.querySelectorAll('[data-sec]').forEach(b=>b.onclick=()=>{ section=b.dataset.sec; selectedStaffId=null; haptic(); paint(root); });
  root.querySelectorAll('[data-refresh]').forEach(b=>b.onclick=async()=>{ b.disabled=true; try{await reload();showToast('Данные обновлены');paint(root);}catch(e){showToast(e.message,true)}finally{b.disabled=false;} });
  root.querySelectorAll('[data-open-staff]').forEach(b=>b.onclick=()=>{selectedStaffId=b.dataset.openStaff;paint(root);});
  root.querySelector('[data-back-staff]')?.addEventListener('click',()=>{selectedStaffId=null;paint(root);});
  root.querySelectorAll('[data-add-staff]').forEach(b=>b.onclick=()=>staffEditor(root));
  root.querySelectorAll('[data-edit-staff]').forEach(b=>b.onclick=()=>staffEditor(root, staff.find(x=>String(x.telegram_id)===String(b.dataset.editStaff))));
  root.querySelectorAll('[data-contact-staff]').forEach(b=>b.onclick=()=>contactStaff(staff.find(x=>String(x.telegram_id)===String(b.dataset.contactStaff))));
  root.querySelectorAll('[data-assign-staff]').forEach(b=>b.onclick=()=>chooseOrderForStaff(root,b.dataset.assignStaff));
  root.querySelectorAll('[data-assign-order]').forEach(b=>b.onclick=()=>chooseStaffForOrder(root,b.dataset.assignOrder));
  root.querySelectorAll('[data-contact-order]').forEach(b=>b.onclick=()=>contactOrder(orders.find(x=>String(x.order_number)===String(b.dataset.contactOrder))));
  root.querySelectorAll('[data-reschedule]').forEach(b=>b.onclick=()=>reschedule(root,orders.find(x=>String(x.order_number)===String(b.dataset.reschedule))));
  root.querySelectorAll('[data-order-detail]').forEach(b=>b.onclick=()=>orderDetails(root,orders.find(x=>String(x.order_number)===String(b.dataset.orderDetail))));
  root.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{orderFilter=b.dataset.filter;paint(root);});
  const os = root.querySelector('[data-order-search]'); if(os) os.oninput=()=>{orderSearch=os.value; clearTimeout(os._t); os._t=setTimeout(()=>paint(root),180);};
}
function sheet(html) {
  document.querySelector('.hc-sheet-wrap')?.remove();
  const el=document.createElement('div');el.className='hc-sheet-wrap';el.innerHTML=`<button class="hc-sheet-backdrop" aria-label="Закрыть"></button><div class="hc-sheet"><div class="hc-sheet-grab"></div>${html}</div>`;document.body.appendChild(el);el.querySelector('.hc-sheet-backdrop').onclick=()=>el.remove();return el;
}
function staffEditor(root, p={}) {
  const el=sheet(`<div class="hc-sheet-head"><h2>${p.telegram_id?'Сотрудник':'Новый сотрудник'}</h2><button data-close>×</button></div><form class="hc-form"><label>Telegram ID<input name="telegram_id" inputmode="numeric" value="${escapeHtml(String(p.telegram_id||''))}" ${p.telegram_id?'readonly':''} required></label><label>Имя и фамилия<input name="name" value="${escapeHtml(p.name||'')}" required></label><label>Должность<select name="role"><option>Клинер</option><option ${p.role==='Старший клинер'?'selected':''}>Старший клинер</option><option ${p.role==='Менеджер'?'selected':''}>Менеджер</option></select></label><label>Телефон<input name="phone" value="${escapeHtml(p.phone||'')}" placeholder="+7..."></label><label>Статус<select name="status">${[['free','Свободен'],['active','На смене'],['break','Перерыв'],['dayoff','Выходной'],['suspended','Не активен']].map(([v,l])=>`<option value="${v}" ${p.status===v?'selected':''}>${l}</option>`).join('')}</select></label><button class="hc-primary" type="submit">${p.telegram_id?'Сохранить':'Добавить и отправить обучение'}</button></form>`);
  el.querySelector('[data-close]').onclick=()=>el.remove();
  el.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const body=Object.fromEntries(f.entries());const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;try{const d=await postJson('/api/admin-staff',body);staff=d.staff||staff;showToast(d.invite_sent===false&& !p.telegram_id?'Сотрудник добавлен. Сначала он должен запустить бота, затем отправьте обучение повторно.':'Сохранено');el.remove();paint(root);}catch(err){showToast(err.message,true);btn.disabled=false;}};
}
function contactStaff(p) { if(!p)return; const user=String(p.telegram_id||'').replace(/\D/g,''); const tel=String(p.phone||'').replace(/[^+\d]/g,''); const el=sheet(`<div class="hc-sheet-head"><h2>Связаться</h2><button data-close>×</button></div><p class="hc-sheet-sub">${escapeHtml(p.name||'Сотрудник')}</p><div class="hc-contact-grid">${tel?`<a href="tel:${escapeHtml(tel)}">☎︎<b>Позвонить</b></a>`:''}${user?`<a href="tg://user?id=${escapeHtml(user)}">💬<b>Telegram</b></a>`:''}</div>`); el.querySelector('[data-close]').onclick=()=>el.remove(); }
function contactOrder(o) { if(!o)return; const tel=String(o.phone||'').replace(/[^+\d]/g,''); const user=String(o.client_telegram_id||'').replace(/\D/g,''); const el=sheet(`<div class="hc-sheet-head"><h2>Связаться с клиентом</h2><button data-close>×</button></div><p class="hc-sheet-sub">${escapeHtml(o.customer_name||'Клиент')}</p><div class="hc-contact-grid">${tel?`<a href="tel:${escapeHtml(tel)}">☎︎<b>Позвонить</b></a>`:''}${user?`<a href="tg://user?id=${escapeHtml(user)}">💬<b>Telegram</b></a>`:''}</div>`);el.querySelector('[data-close]').onclick=()=>el.remove(); }
function chooseStaffForOrder(root, number) {
  const o=orders.find(x=>String(x.order_number)===String(number)); if(!o)return;
  const available=staff.filter(s=>!['suspended','dayoff'].includes(s.status));
  const el=sheet(`<div class="hc-sheet-head"><h2>Назначить сотрудника</h2><button data-close>×</button></div><p class="hc-sheet-sub">${escapeHtml(o.service_name||'Уборка')} · ${Number(o.area||0)} м² · ${escapeHtml(formatDate(o.date))} ${escapeHtml(formatTime(o.time))}</p><div class="hc-pick-list">${available.map(p=>`<button data-pick="${escapeHtml(String(p.telegram_id))}"><span class="hc-avatar mini">${photo(p)}</span><span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(staffStatusLabel(p.status))} · обучение ${Number(p.training_progress||0)}%</small></span><em>Выбрать</em></button>`).join('')||'<p>Нет доступных сотрудников.</p>'}</div>`);el.querySelector('[data-close]').onclick=()=>el.remove(); el.querySelectorAll('[data-pick]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await postJson('/api/admin-assign-staff',{order:o,staff_id:b.dataset.pick});await reload();showToast('Сотрудник назначен');el.remove();paint(root);}catch(e){showToast(e.message,true);b.disabled=false;}});
}
function chooseOrderForStaff(root, staffId) {
  const p=staff.find(x=>String(x.telegram_id)===String(staffId)); if(!p)return;
  const list=orders.filter(o=>ACTIVE.has(o.status)&&o.status!=='IN_PROGRESS').sort((a,b)=>`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0,20);
  const el=sheet(`<div class="hc-sheet-head"><h2>Назначить заказ</h2><button data-close>×</button></div><p class="hc-sheet-sub">${escapeHtml(p.name)}</p><div class="hc-pick-list">${list.map(o=>`<button data-pick-order="${escapeHtml(o.order_number||'')}"><span class="hc-datebox"><b>${escapeHtml(formatTime(o.time))}</b><small>${escapeHtml(formatDate(o.date))}</small></span><span><b>${escapeHtml(o.customer_name||o.service_name)}</b><small>${escapeHtml(o.address||'')} · ${Number(o.area||0)} м²</small></span><em>Назначить</em></button>`).join('')||'<p>Нет активных заказов.</p>'}</div>`);el.querySelector('[data-close]').onclick=()=>el.remove();el.querySelectorAll('[data-pick-order]').forEach(b=>b.onclick=async()=>{const o=orders.find(x=>String(x.order_number)===String(b.dataset.pickOrder));if(!o)return;b.disabled=true;try{await postJson('/api/admin-assign-staff',{order:o,staff_id:staffId});await reload();showToast('Заказ назначен');el.remove();paint(root);}catch(e){showToast(e.message,true);b.disabled=false;}});
}
function reschedule(root,o){ if(!o)return; const el=sheet(`<div class="hc-sheet-head"><h2>Перенести заявку</h2><button data-close>×</button></div><form class="hc-form"><label>Новая дата<input type="date" name="date" value="${escapeHtml(o.date||'')}" required></label><label>Новое время<input type="time" name="time" value="${escapeHtml(String(o.time||'').slice(0,5))}" required></label><button class="hc-primary" type="submit">Сохранить и уведомить клиента</button></form>`);el.querySelector('[data-close]').onclick=()=>el.remove();el.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const b=e.currentTarget.querySelector('button');b.disabled=true;try{await postJson('/api/admin-reschedule-order',{order:o,date:f.get('date'),time:f.get('time')});await reload();showToast('Заявка перенесена');el.remove();paint(root);}catch(err){showToast(err.message,true);b.disabled=false;}}; }
function orderDetails(root,o){ if(!o)return; const assigned=staff.find(s=>String(s.telegram_id)===String(o.assigned_staff_id||'')); const el=sheet(`<div class="hc-sheet-head"><h2>${escapeHtml(o.order_number||'Заявка')}</h2><button data-close>×</button></div><div class="hc-detail"><span class="hc-order-status ${statusClass(o.status)}"><i></i>${escapeHtml(statusLabel(o.status))}</span><h3>${escapeHtml(o.customer_name||'Клиент')}</h3><p>${escapeHtml(o.service_name||'Уборка')} · ${Number(o.area||0)} м²</p><dl><div><dt>Когда</dt><dd>${escapeHtml(formatDate(o.date))} · ${escapeHtml(formatTime(o.time))}</dd></div><div><dt>Адрес</dt><dd>${escapeHtml([o.city,o.address,o.apartment?`кв./офис ${o.apartment}`:''].filter(Boolean).join(', '))}</dd></div><div><dt>Сотрудник</dt><dd>${assigned?escapeHtml(assigned.name):'Не назначен'}</dd></div><div><dt>Комментарий</dt><dd>${escapeHtml(o.comment||o.address_comment||'—')}</dd></div></dl><div class="hc-detail-actions"><button data-d-assign>Назначить</button><button data-d-contact>Связаться</button>${o.status!=='IN_PROGRESS'&&o.status!=='COMPLETED'?'<button data-d-start>Начать</button>':''}${o.status==='IN_PROGRESS'?'<button data-d-done>Завершить</button>':''}</div></div>`);el.querySelector('[data-close]').onclick=()=>el.remove();el.querySelector('[data-d-assign]')?.addEventListener('click',()=>{el.remove();chooseStaffForOrder(root,o.order_number)});el.querySelector('[data-d-contact]')?.addEventListener('click',()=>{el.remove();contactOrder(o)});el.querySelector('[data-d-start]')?.addEventListener('click',async()=>{try{await api.adminSetStatus(o,'IN_PROGRESS');await reload();el.remove();paint(root);showToast('Уборка начата');}catch(e){showToast(e.message,true)}});el.querySelector('[data-d-done]')?.addEventListener('click',async()=>{try{await api.adminSetStatus(o,'COMPLETED');await reload();el.remove();paint(root);showToast('Заявка завершена');}catch(e){showToast(e.message,true)}}); }
