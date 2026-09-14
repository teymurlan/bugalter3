import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v37-booking-resilience.js';

export { ConsentStore };
const APP_STORE_NAME = 'house-cleaning-app-v1';
const LESSON_IDS = ['rules','general','safety','chemistry','photos','client'];
const QUIZ_KEYS = [1,1,1,1,1];

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/staff/list' && request.method === 'GET') {
      const rows = await this.state.storage.list({ prefix: 'staff:' });
      const out = [];
      for (const row of rows.values()) {
        const training = await this.state.storage.get(`training:${row.telegram_id}`) || defaultTraining();
        out.push(withTraining(row, training));
      }
      out.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ru'));
      return json({ ok:true, staff:out });
    }

    if (url.pathname === '/staff/get' && request.method === 'GET') {
      const id = positiveInt(url.searchParams.get('id'));
      if (!id) return json({ ok:false, error:'Некорректный сотрудник' },400);
      const row = await this.state.storage.get(`staff:${id}`);
      if (!row) return json({ ok:false, error:'Сотрудник не найден' },404);
      const training = await this.state.storage.get(`training:${id}`) || defaultTraining();
      return json({ ok:true, staff:withTraining(row, training) });
    }

    if (url.pathname === '/staff/save' && request.method === 'POST') {
      let body={}; try{body=await request.json();}catch{}
      const id=positiveInt(body.telegram_id);
      const name=clean(body.name,120);
      if(!id||!name) return json({ok:false,error:'Укажите Telegram ID и имя'},400);
      const current=await this.state.storage.get(`staff:${id}`) || {};
      const now=new Date().toISOString();
      const row={
        ...current,
        telegram_id:id,
        name,
        role:clean(body.role||current.role||'Клинер',80),
        phone:clean(body.phone||current.phone||'',40),
        username:clean(body.username||current.username||'',80),
        photo_url:clean(body.photo_url||current.photo_url||'',500),
        status:staffStatus(body.status||current.status||'free'),
        shift_start:clean(body.shift_start||current.shift_start||'08:00',5),
        shift_end:clean(body.shift_end||current.shift_end||'18:00',5),
        skills:Array.isArray(body.skills)?body.skills.map(x=>clean(x,80)).filter(Boolean).slice(0,20):(current.skills||['Генеральная уборка','После ремонта']),
        rating:finite(body.rating,current.rating,5),
        punctuality:finite(body.punctuality,current.punctuality,100),
        orders_completed:Math.max(0,Math.round(finite(body.orders_completed,current.orders_completed,0))),
        area_total:Math.max(0,finite(body.area_total,current.area_total,0)),
        hired_at:current.hired_at||now,
        updated_at:now,
      };
      await this.state.storage.put(`staff:${id}`,row);
      if(!(await this.state.storage.get(`training:${id}`))) await this.state.storage.put(`training:${id}`,defaultTraining());
      const training=await this.state.storage.get(`training:${id}`) || defaultTraining();
      return json({ok:true,staff:withTraining(row,training)});
    }

    if (url.pathname === '/staff/training/get' && request.method === 'GET') {
      const id=positiveInt(url.searchParams.get('id')); if(!id)return json({ok:false},400);
      const staff=await this.state.storage.get(`staff:${id}`); if(!staff)return json({ok:false,error:'Сотрудник не найден'},404);
      const training=await this.state.storage.get(`training:${id}`) || defaultTraining();
      return json({ok:true,training:normalizedTraining(training)});
    }

    if (url.pathname === '/staff/training/update' && request.method === 'POST') {
      let body={}; try{body=await request.json();}catch{}
      const id=positiveInt(body.telegram_id); if(!id)return json({ok:false},400);
      const staff=await this.state.storage.get(`staff:${id}`); if(!staff)return json({ok:false,error:'Сотрудник не найден'},404);
      let tr=normalizedTraining(await this.state.storage.get(`training:${id}`) || defaultTraining());
      const action=String(body.action||'');
      if(action==='accept_regulations') tr.regulations_accepted=true;
      if(action==='lesson') {
        const lesson=String(body.lesson_id||'');
        if(!LESSON_IDS.includes(lesson)) return json({ok:false,error:'Урок не найден'},400);
        tr.lessons_done=[...new Set([...(tr.lessons_done||[]),lesson])];
      }
      let score=Number(tr.quiz_score||0);
      if(action==='quiz') {
        const answers=Array.isArray(body.answers)?body.answers:[];
        let correct=0; QUIZ_KEYS.forEach((key,i)=>{if(Number(answers[i])===key)correct+=1;});
        score=Math.round(correct/QUIZ_KEYS.length*100);
        tr.quiz_score=Math.max(score,Number(tr.quiz_score||0));
      }
      if(action==='finish') {
        if(!readyToFinish(tr)) return json({ok:false,error:'Сначала завершите уроки, сдайте тест минимум на 80% и подтвердите регламент.'},409);
        tr.completed=true; tr.completed_at=new Date().toISOString();
      }
      tr.updated_at=new Date().toISOString(); tr.progress=trainingProgress(tr);
      await this.state.storage.put(`training:${id}`,tr);
      if(tr.completed) await this.state.storage.put(`staff:${id}`,{...staff,training_complete:true,updated_at:new Date().toISOString()});
      return json({ok:true,training:tr,score});
    }

    if (url.pathname === '/staff/orders' && request.method === 'GET') {
      const id=positiveInt(url.searchParams.get('id')); const date=String(url.searchParams.get('date')||'');
      if(!id)return json({ok:false},400);
      const rows=await this.state.storage.list({prefix:'order:'});
      const list=[];
      for(const order of rows.values()){
        if(String(order?.assigned_staff_id||'')!==String(id)) continue;
        if(date && String(order?.date||'')!==date) continue;
        if(order?.is_test) continue;
        list.push(order);
      }
      list.sort((a,b)=>`${a.date||''} ${a.time||''}`.localeCompare(`${b.date||''} ${b.time||''}`));
      return json({ok:true,orders:list});
    }

    if (url.pathname === '/staff/assign' && request.method === 'POST') {
      let body={};try{body=await request.json();}catch{}
      const staffId=positiveInt(body.staff_id); const order=body.order && typeof body.order==='object'?body.order:null;
      if(!staffId||!order?.order_number) return json({ok:false,error:'Не хватает данных для назначения'},400);
      const person=await this.state.storage.get(`staff:${staffId}`); if(!person)return json({ok:false,error:'Сотрудник не найден'},404);
      const next={...order,assigned_staff_id:staffId,assigned_staff_name:person.name,status:order.status==='IN_PROGRESS'?'IN_PROGRESS':'CLEANER_ASSIGNED',updated_at:new Date().toISOString()};
      const response=await super.fetch(new Request('https://app.internal/order',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(next)}));
      if(!response.ok)return response;
      return json({ok:true,order:(await response.json()).order||next,staff:person});
    }

    if (url.pathname === '/staff/order-update' && request.method === 'POST') {
      let body={};try{body=await request.json();}catch{}
      const order=body.order&&typeof body.order==='object'?body.order:null;
      if(!order?.order_number)return json({ok:false,error:'Заявка не найдена'},400);
      const response=await super.fetch(new Request('https://app.internal/order',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(order)}));
      return response;
    }

    return super.fetch(request);
  }
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);

    if(url.pathname==='/api/admin-staff' && request.method==='GET'){
      if(!(await authorizedAdmin(request,env,ctx)))return json({ok:false,error:'Admin authorization failed'},403);
      const r=await appStub(env)?.fetch('https://app.internal/staff/list');
      return r?proxy(r):json({ok:false,error:'Хранилище сотрудников недоступно'},503);
    }

    if(url.pathname==='/api/admin-staff' && request.method==='POST'){
      const admin=await authorizedAdmin(request,env,ctx); if(!admin)return json({ok:false,error:'Admin authorization failed'},403);
      let body={};try{body=await request.json();}catch{return json({ok:false,error:'Некорректные данные'},400);}
      const id=positiveInt(body.telegram_id); const isNew=id?!(await getStaff(env,id)):false;
      const r=await appStub(env)?.fetch('https://app.internal/staff/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      if(!r)return json({ok:false,error:'Хранилище сотрудников недоступно'},503);
      const data=await r.json().catch(()=>({})); if(!r.ok||!data.ok)return json(data,r.status);
      let inviteSent=null;
      if(isNew && id){
        inviteSent=Boolean(await safeTelegram(env,'sendMessage',{chat_id:id,text:'<b>HOUSE CLEANING · Добро пожаловать в команду</b>\n\nПеред первым заказом необходимо пройти регламент и обучение в рабочем кабинете.',parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'Начать обучение',web_app:{url:`${url.origin}/?staff=1`},style:'primary'}]]}}));
      }
      const all=await appStub(env)?.fetch('https://app.internal/staff/list'); const list=all?.ok?(await all.json()).staff||[]:[];
      return json({ok:true,staff:list,saved:data.staff,invite_sent:inviteSent});
    }

    if(url.pathname==='/api/admin-assign-staff' && request.method==='POST'){
      if(!(await authorizedAdmin(request,env,ctx)))return json({ok:false,error:'Admin authorization failed'},403);
      let body={};try{body=await request.json();}catch{return json({ok:false,error:'Некорректные данные'},400);}
      const staffId=positiveInt(body.staff_id); const person=await getStaff(env,staffId); if(!person)return json({ok:false,error:'Сотрудник не найден'},404);
      const tr=await getTraining(env,staffId); if(!tr?.completed)return json({ok:false,error:'Нельзя назначить сотрудника: обучение ещё не завершено.'},409);
      const r=await appStub(env)?.fetch('https://app.internal/staff/assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      if(!r)return json({ok:false,error:'Не удалось сохранить назначение'},503); const data=await r.json().catch(()=>({})); if(!r.ok)return json(data,r.status);
      const o=data.order||body.order;
      await safeTelegram(env,'sendMessage',{chat_id:staffId,text:['<b>Новый заказ назначен</b>','',`Дата: <b>${formatDate(o.date)}</b> · <b>${esc(String(o.time||'').slice(0,5))}</b>`,`Уборка: ${esc(o.service_name||'Уборка')}`,`Площадь: ${Number(o.area||0)} м²`,`Адрес: ${esc([o.city,o.address,o.apartment?`кв./офис ${o.apartment}`:''].filter(Boolean).join(', '))}`].join('\n'),parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'Открыть кабинет',web_app:{url:`${url.origin}/?staff=1`},style:'primary'}]]}});
      return json({ok:true,...data});
    }

    if(url.pathname==='/api/admin-reschedule-order' && request.method==='POST'){
      if(!(await authorizedAdmin(request,env,ctx)))return json({ok:false,error:'Admin authorization failed'},403);
      let body={};try{body=await request.json();}catch{return json({ok:false,error:'Некорректные данные'},400);}
      const order=body.order&&typeof body.order==='object'?body.order:null; const date=validDate(body.date); const time=validTime(body.time);
      if(!order?.order_number||!date||!time)return json({ok:false,error:'Укажите корректные дату и время'},400);
      const next={...order,date,time,updated_at:new Date().toISOString()};
      const r=await appStub(env)?.fetch('https://app.internal/staff/order-update',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({order:next})});
      if(!r?.ok)return json({ok:false,error:'Не удалось перенести заявку'},503);
      if(Number(next.client_telegram_id)>0) await safeTelegram(env,'sendMessage',{chat_id:Number(next.client_telegram_id),text:`<b>Время уборки изменено</b>\n\nЗаявка ${esc(next.order_number)}\nНовая дата: <b>${formatDate(date)}</b>\nНовое время: <b>${esc(time)}</b>`,parse_mode:'HTML'});
      if(Number(next.assigned_staff_id)>0) await safeTelegram(env,'sendMessage',{chat_id:Number(next.assigned_staff_id),text:`<b>Изменение в заказе</b>\n\n${esc(next.order_number)} перенесён на <b>${formatDate(date)} ${esc(time)}</b>.`,parse_mode:'HTML'});
      return json({ok:true,order:(await r.json().catch(()=>({}))).order||next});
    }

    if(url.pathname==='/api/staff-me' && request.method==='GET'){
      const user=await authorizedUser(request,env,ctx); if(!user)return json({ok:false,error:'Сначала откройте бота и подтвердите согласие на обработку данных.'},401);
      const person=await getStaff(env,user.id); if(!person)return json({ok:false,error:'Ваш профиль сотрудника ещё не активирован. Администратор должен добавить ваш Telegram ID.'},403);
      const tr=await getTraining(env,user.id); const ord=await appStub(env)?.fetch(`https://app.internal/staff/orders?id=${encodeURIComponent(user.id)}&date=${encodeURIComponent(moscowDate())}`); const orders=ord?.ok?(await ord.json()).orders||[]:[];
      return json({ok:true,staff:{...person,...trainingFields(tr),orders,manager_telegram_id:primaryAdminId(env),manager_phone:String(env.MANAGER_PHONE||'')}});
    }

    if(url.pathname==='/api/staff-training' && request.method==='GET'){
      const user=await authorizedUser(request,env,ctx); if(!user)return json({ok:false,error:'Telegram authorization failed'},401);
      if(!(await getStaff(env,user.id)))return json({ok:false,error:'Профиль сотрудника не активирован'},403);
      const r=await appStub(env)?.fetch(`https://app.internal/staff/training/get?id=${encodeURIComponent(user.id)}`); return r?proxy(r):json({ok:false,error:'Хранилище недоступно'},503);
    }

    if(url.pathname==='/api/staff-training' && request.method==='POST'){
      const user=await authorizedUser(request,env,ctx); if(!user)return json({ok:false,error:'Telegram authorization failed'},401);
      if(!(await getStaff(env,user.id)))return json({ok:false,error:'Профиль сотрудника не активирован'},403);
      let body={};try{body=await request.json();}catch{}
      const r=await appStub(env)?.fetch('https://app.internal/staff/training/update',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,telegram_id:user.id})});
      return r?proxy(r):json({ok:false,error:'Хранилище недоступно'},503);
    }

    return baseWorker.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){if(typeof baseWorker.scheduled==='function')return baseWorker.scheduled(controller,env,ctx);}
};

function appStub(env){return env.APP_STORE?env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME)):null;}
async function getStaff(env,id){if(!id)return null;const r=await appStub(env)?.fetch(`https://app.internal/staff/get?id=${encodeURIComponent(id)}`);if(!r?.ok)return null;return (await r.json()).staff||null;}
async function getTraining(env,id){if(!id)return null;const r=await appStub(env)?.fetch(`https://app.internal/staff/training/get?id=${encodeURIComponent(id)}`);if(!r?.ok)return null;return (await r.json()).training||null;}
async function authorizedAdmin(request,env,ctx){const init=request.headers.get('X-Telegram-Init-Data')||'';if(!init)return null;const u=new URL(request.url);u.pathname='/api/admin-system-health';u.search='';const r=await baseWorker.fetch(new Request(u,{headers:{'X-Telegram-Init-Data':init}}),env,ctx);if(!r.ok)return null;try{return JSON.parse(new URLSearchParams(init).get('user')||'{}')}catch{return null;}}
async function authorizedUser(request,env,ctx){const init=request.headers.get('X-Telegram-Init-Data')||'';if(!init)return null;const u=new URL(request.url);u.pathname='/api/referral-dashboard';u.search='';const r=await baseWorker.fetch(new Request(u,{headers:{'X-Telegram-Init-Data':init}}),env,ctx);if(!r.ok)return null;try{const user=JSON.parse(new URLSearchParams(init).get('user')||'{}');return positiveInt(user?.id)?user:null}catch{return null;}}
function defaultTraining(){return{regulations_accepted:false,lessons_done:[],quiz_score:0,completed:false,progress:0,updated_at:new Date().toISOString()};}
function normalizedTraining(t){const x={...defaultTraining(),...(t||{})};x.lessons_done=[...new Set((Array.isArray(x.lessons_done)?x.lessons_done:[]).filter(v=>LESSON_IDS.includes(v)))];x.quiz_score=Math.max(0,Math.min(100,Number(x.quiz_score||0)));x.progress=trainingProgress(x);return x;}
function trainingProgress(t){if(t.completed)return 100;let n=t.regulations_accepted?15:0;n+=Math.round((new Set(t.lessons_done||[]).size/LESSON_IDS.length)*55);if(Number(t.quiz_score||0)>=80)n+=20;return Math.min(90,n);}
function readyToFinish(t){return Boolean(t.regulations_accepted&&new Set(t.lessons_done||[]).size>=LESSON_IDS.length&&Number(t.quiz_score||0)>=80);}
function withTraining(s,t){return{...s,...trainingFields(normalizedTraining(t))};}
function trainingFields(t){const x=normalizedTraining(t||defaultTraining());return{training_complete:Boolean(x.completed),training_progress:Number(x.progress||0),regulations_accepted:Boolean(x.regulations_accepted),quiz_score:Number(x.quiz_score||0)};}
function staffStatus(s){return['active','free','break','dayoff','suspended'].includes(String(s))?String(s):'free';}
function positiveInt(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:0;}
function finite(v,fallback=0,def=0){const n=Number(v);if(Number.isFinite(n))return n;const f=Number(fallback);return Number.isFinite(f)?f:def;}
function clean(v,max=200){return String(v??'').trim().slice(0,max);}
function validDate(v){const s=String(v||'');return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';}
function validTime(v){const s=String(v||'').slice(0,5);return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)?s:'';}
function moscowDate(){return new Date(Date.now()+3*3600000).toISOString().slice(0,10);}
function primaryAdminId(env){const raw=[env.ADMIN_TELEGRAM_IDS,env.ADMIN_TELEGRAM_ID,env.ADMIN_ID].filter(Boolean).join(',');const id=String(raw).split(/[;,\s]+/).find(v=>/^\d+$/.test(v));return id?Number(id):0;}
async function safeTelegram(env,method,payload){try{return await telegram(env,method,payload)}catch(e){console.error('staff telegram failed',e);return null;}}
async function telegram(env,method,payload){if(!env.TELEGRAM_BOT_TOKEN)throw new Error('Bot token missing');const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.description||`Telegram ${method} failed`);return d.result;}
function formatDate(v){const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}.${m[1]}`:String(v||'');}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function proxy(r){return new Response(r.body,{status:r.status,headers:r.headers});}
function json(v,status=200){return new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store'}});}
