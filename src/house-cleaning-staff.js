const APP_STORE_NAME = 'house-cleaning-app-v1';
const STAFF_STAGES = ['assigned','accepted','departure_confirmed','started','before_photos','checklist','after_photos','completed','awaiting_review','verified'];

export async function handleHouseCleaningStaff(request, env, ctx, baseWorker) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/staff-v1/')) return null;

  const user = await validateTelegramUser(request, env);
  if (!user) return json({ ok:false, error:'Откройте HOUSE CLEANING STAFF из Telegram.' }, 401);
  const role = isFullAdmin(env, user.id) ? 'admin' : (await getStaff(env, user.id) ? 'staff' : 'none');

  if (url.pathname === '/api/staff-v1/session' && request.method === 'GET') {
    if (role === 'none') return json({ ok:false, error:'Доступ к HOUSE CLEANING STAFF ещё не выдан.' }, 403);
    return json({ ok:true, role, user:{ id:user.id, first_name:user.first_name||'', last_name:user.last_name||'', username:user.username||'' } });
  }

  if (url.pathname === '/api/staff-v1/admin/bootstrap' && request.method === 'GET') {
    if (role !== 'admin') return forbidden();
    const [orders, staff] = await Promise.all([getOrders(env), getStaffList(env)]);
    return json({ ok:true, role:'admin', orders, staff, overview:buildOverview(orders, staff), attention:buildAttention(orders, staff) });
  }

  if (url.pathname === '/api/staff-v1/admin/assign' && request.method === 'POST') {
    if (role !== 'admin') return forbidden();
    const body = await bodyJson(request);
    const order = (await getOrders(env)).find(o => String(o.order_number||'') === String(body.order_number||''));
    if (!order) return json({ ok:false, error:'Заявка не найдена.' }, 404);
    const ids = [...new Set((Array.isArray(body.staff_ids)?body.staff_ids:[]).map(positiveInt).filter(Boolean))].slice(0,8);
    if (!ids.length) return json({ ok:false, error:'Выберите хотя бы одного сотрудника.' }, 400);
    const people = [];
    for (const id of ids) {
      const person = await getStaff(env, id);
      if (!person) return json({ ok:false, error:`Сотрудник ${id} не найден.` }, 404);
      if (!person.training_complete) return json({ ok:false, error:`${person.name || 'Сотрудник'} ещё не допущен к заказам: обучение не завершено.` }, 409);
      if (['dayoff','suspended'].includes(String(person.status||''))) return json({ ok:false, error:`${person.name || 'Сотрудник'} сейчас недоступен.` }, 409);
      people.push(person);
    }
    const now = new Date().toISOString();
    const progress = { ...(order.staff_progress || {}) };
    ids.forEach(id => { progress[String(id)] = progress[String(id)] || { stage:'assigned', assigned_at:now }; });
    const next = {
      ...order,
      assigned_staff_id: ids[0],
      assigned_staff_name: people[0]?.name || '',
      assigned_staff_ids: ids,
      assigned_staff_names: people.map(p=>p.name||`ID ${p.telegram_id}`),
      staff_progress: progress,
      status: ['NEW','REVIEW','CONFIRMED'].includes(order.status) ? 'CLEANER_ASSIGNED' : order.status,
      updated_at: now,
      activity_log: appendLog(order.activity_log, { at:now, actor_role:'admin', actor_id:user.id, action:'team_assigned', detail:people.map(p=>p.name).join(', ') }),
    };
    const saved = await saveOrder(env, next);
    await Promise.allSettled(people.map(person => sendTelegram(env, 'sendMessage', {
      chat_id: person.telegram_id,
      text: [`<b>Новая уборка · HOUSE CLEANING STAFF</b>`,'',`Заявка: <b>${esc(saved.order_number||'')}</b>`,`Дата: <b>${esc(saved.date||'')}</b> · <b>${esc(String(saved.time||'').slice(0,5))}</b>`,`Адрес: ${esc([saved.city,saved.address].filter(Boolean).join(', '))}`,`Уборка: ${esc(saved.service_name||'Уборка')}`,`Площадь: ${Number(saved.area||0)} м²`].join('\n'),
      parse_mode:'HTML',
      reply_markup:{ inline_keyboard:[[{ text:'Открыть задание', web_app:{ url:`${url.origin}/staff/` } }]] },
    })));
    return json({ ok:true, order:saved });
  }

  if (url.pathname === '/api/staff-v1/me/bootstrap' && request.method === 'GET') {
    if (role !== 'staff') return forbidden();
    const [person, orders] = await Promise.all([getStaff(env,user.id), getOrders(env)]);
    const mine = orders.filter(o => assignedTo(o,user.id)).sort(orderSort);
    return json({ ok:true, role:'staff', staff:person, orders:mine, today:mine.filter(o=>o.date===moscowDate()) });
  }

  if (url.pathname === '/api/staff-v1/task/action' && request.method === 'POST') {
    if (role !== 'staff') return forbidden();
    const body = await bodyJson(request);
    const action = String(body.action||'');
    const allowed = new Set(['accept','confirm_departure','start','complete']);
    if (!allowed.has(action)) return json({ ok:false, error:'Неизвестное действие.' }, 400);
    const order = (await getOrders(env)).find(o => String(o.order_number||'') === String(body.order_number||''));
    if (!order || !assignedTo(order,user.id)) return json({ ok:false, error:'Задание не найдено.' }, 404);
    const now = new Date().toISOString();
    const progress = { ...(order.staff_progress||{}) };
    const current = { ...(progress[String(user.id)]||{ stage:'assigned' }) };
    if (action === 'accept') Object.assign(current,{ stage:'accepted', accepted_at:now });
    if (action === 'confirm_departure') Object.assign(current,{ stage:'departure_confirmed', departure_confirmed_at:now });
    if (action === 'start') Object.assign(current,{ stage:'started', started_at:now });
    if (action === 'complete') {
      const report = normalizeReport(order.staff_report);
      if (report.before_count < report.required_before || report.after_count < report.required_after) return json({ ok:false, error:`Нельзя завершить уборку: нужны фото ДО ${report.required_before} и ПОСЛЕ ${report.required_after}.` }, 409);
      if (!report.checklist_complete) return json({ ok:false, error:'Сначала завершите обязательный чек-лист.' }, 409);
      Object.assign(current,{ stage:'completed', completed_at:now });
    }
    progress[String(user.id)] = current;
    const stages = Object.values(progress).map(x=>STAFF_STAGES.indexOf(String(x?.stage||'assigned'))).filter(x=>x>=0);
    const minStage = stages.length ? Math.min(...stages) : 0;
    const overall = STAFF_STAGES[minStage] || 'assigned';
    const next = {
      ...order,
      staff_progress:progress,
      staff_stage:overall,
      status: action==='start' ? 'IN_PROGRESS' : (action==='complete' && Object.values(progress).every(x=>x?.stage==='completed') ? 'IN_PROGRESS' : order.status),
      updated_at:now,
      activity_log:appendLog(order.activity_log,{ at:now, actor_role:'staff', actor_id:user.id, action, detail:'' }),
    };
    return json({ ok:true, order:await saveOrder(env,next) });
  }

  return json({ ok:false, error:'Not found' }, 404);
}

export function staffAppUrl(origin) { return `${origin}/staff/`; }

function buildOverview(orders, staff) {
  const today = moscowDate();
  const todays = orders.filter(o=>o.date===today && o.status!=='CANCELLED');
  return {
    today:todays.length,
    unassigned:todays.filter(o=>!assignedIds(o).length && ['CONFIRMED','CLEANER_ASSIGNED','IN_PROGRESS'].includes(o.status)).length,
    staff_working:staff.filter(s=>['active','free','break'].includes(String(s.status))).length,
    in_progress:todays.filter(o=>o.status==='IN_PROGRESS').length,
    completed:todays.filter(o=>o.status==='COMPLETED').length,
    reports_review:todays.filter(o=>normalizeReport(o.staff_report).status==='review').length,
  };
}
function buildAttention(orders, staff) {
  const today = moscowDate();
  const out=[];
  orders.filter(o=>o.date===today && o.status!=='CANCELLED').forEach(o=>{
    if (!assignedIds(o).length && ['CONFIRMED','CLEANER_ASSIGNED'].includes(o.status)) out.push({ type:'danger', order_number:o.order_number, text:`${o.time||''} · сотрудник не назначен` });
    if (assignedIds(o).length && !Object.values(o.staff_progress||{}).some(x=>['accepted','departure_confirmed','started','completed'].includes(x?.stage))) out.push({ type:'warn', order_number:o.order_number, text:'Команда ещё не подтвердила выход' });
    const r=normalizeReport(o.staff_report); if (o.status==='IN_PROGRESS' && r.after_count<r.required_after) out.push({ type:'warn', order_number:o.order_number, text:'Фото ПОСЛЕ ещё не загружены' });
  });
  const pendingTraining=staff.filter(s=>!s.training_complete).length;
  if(pendingTraining) out.push({type:'info',text:`${pendingTraining} сотрудник(а) ещё проходят обучение`});
  return out.slice(0,10);
}
function normalizeReport(v){const x=v&&typeof v==='object'?v:{};return{before_count:Math.max(0,Number(x.before_count||0)),after_count:Math.max(0,Number(x.after_count||0)),required_before:Math.max(1,Number(x.required_before||3)),required_after:Math.max(1,Number(x.required_after||3)),checklist_complete:Boolean(x.checklist_complete),status:String(x.status||'waiting')}}
function assignedIds(order){const a=Array.isArray(order?.assigned_staff_ids)?order.assigned_staff_ids.map(positiveInt).filter(Boolean):[];const p=positiveInt(order?.assigned_staff_id);return [...new Set(p?[p,...a]:a)]}
function assignedTo(order,id){return assignedIds(order).includes(Number(id))}
function orderSort(a,b){return `${a.date||''} ${a.time||''}`.localeCompare(`${b.date||''} ${b.time||''}`)}
function appendLog(log,entry){return [...(Array.isArray(log)?log:[]).slice(-199),entry]}
function moscowDate(){return new Date(Date.now()+3*3600000).toISOString().slice(0,10)}
function positiveInt(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:0}
function appStub(env){return env.APP_STORE?env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME)):null}
async function getOrders(env){const r=await appStub(env)?.fetch('https://app.internal/orders');if(!r?.ok)return[];return (await r.json()).orders||[]}
async function getStaffList(env){const r=await appStub(env)?.fetch('https://app.internal/staff/list');if(!r?.ok)return[];return (await r.json()).staff||[]}
async function getStaff(env,id){const r=await appStub(env)?.fetch(`https://app.internal/staff/get?id=${encodeURIComponent(id)}`);if(!r?.ok)return null;return (await r.json()).staff||null}
async function saveOrder(env,order){const r=await appStub(env)?.fetch('https://app.internal/order',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(order)});if(!r?.ok)throw new Error('Не удалось сохранить заявку');return (await r.json()).order||order}
function isFullAdmin(env,id){const raw=[env.ADMIN_TELEGRAM_IDS,env.ADMIN_TELEGRAM_ID,env.ADMIN_ID].filter(Boolean).join(',');return raw.split(/[;,\s]+/).map(v=>v.trim()).filter(Boolean).includes(String(id))}
async function validateTelegramUser(request,env){const init=request.headers.get('X-Telegram-Init-Data')||'';if(!init||!env.TELEGRAM_BOT_TOKEN)return null;try{const p=new URLSearchParams(init);const hash=(p.get('hash')||'').toLowerCase();const auth=Number(p.get('auth_date')||0);const raw=p.get('user');if(!hash||!auth||!raw||Math.abs(Date.now()/1000-auth)>86400)return null;p.delete('hash');const all=[...p.entries()];const candidates=[all,all.filter(([k])=>k!=='signature')];const enc=new TextEncoder();const secret=await hmac(enc.encode('WebAppData'),enc.encode(env.TELEGRAM_BOT_TOKEN));for(const entries of candidates){const check=[...entries].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const digest=await hmac(secret,enc.encode(check));const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');if(constantEqual(hex,hash)){const user=JSON.parse(raw);return positiveInt(user?.id)?user:null}}return null}catch{return null}}
async function hmac(k,d){const key=await crypto.subtle.importKey('raw',k,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',key,d)}
function constantEqual(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
async function bodyJson(r){try{return await r.json()}catch{return{}}}
async function sendTelegram(env,method,payload){if(!env.TELEGRAM_BOT_TOKEN)return null;const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.description||'Telegram error');return d.result}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function forbidden(){return json({ok:false,error:'Недостаточно прав.'},403)}
function json(v,status=200){return new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store'}})}
