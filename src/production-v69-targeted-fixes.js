import baseWorker, { ConsentStore as BaseConsentStore, AppStore as BaseAppStore } from './production-start-fix.js';

const APP_STORE_NAME = 'house-cleaning-app-v1';
const BOT_USER_PREFIX = 'bot-user:v69:';
const ACTIVE = new Set(['NEW','REVIEW','CONFIRMED','CLEANER_ASSIGNED','IN_PROGRESS']);

export class ConsentStore extends BaseConsentStore {}

export class AppStore extends BaseAppStore {
  constructor(state, env) {
    super(state, env);
    this.v69State = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/v69/bot-user' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const id = positiveInt(body?.telegram_id || body?.id);
      if (!id) return json({ ok:false, error:'Invalid user' },400);
      const key = `${BOT_USER_PREFIX}${id}`;
      const previous = await this.v69State.storage.get(key) || {};
      const row = {
        ...previous,
        telegram_id:id,
        first_name:clean(body.first_name || previous.first_name,120),
        last_name:clean(body.last_name || previous.last_name,120),
        username:clean(body.username || previous.username,120),
        last_seen_at:new Date().toISOString(),
      };
      await this.v69State.storage.put(key,row);
      return json({ok:true,user:row});
    }
    if (url.pathname === '/v69/bot-users' && request.method === 'GET') {
      const rows = await this.v69State.storage.list({prefix:BOT_USER_PREFIX});
      return json({ok:true,users:[...rows.values()].filter(Boolean)});
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      let update = null;
      try { update = await request.clone().json(); } catch {}
      const actor = update?.message?.from || update?.edited_message?.from || update?.callback_query?.from;
      if (positiveInt(actor?.id)) {
        const task = registerBotUser(env, actor);
        if (ctx?.waitUntil) ctx.waitUntil(task); else await task;
      }

      const match = /^hc:(?:c|yc|d):(\d+):(.+)$/.exec(String(update?.callback_query?.data || ''));
      if (match) {
        const clientId = positiveInt(match[1]);
        const number = decodeOrderNumber(match[2]);
        const current = await appOrder(env,clientId,number);
        if (current?.status === 'CANCELLED') {
          await telegramSafe(env,'answerCallbackQuery',{
            callback_query_id:update.callback_query.id,
            text:'Заявка уже отменена клиентом. Изменить статус нельзя.',
            show_alert:true,
          });
          return new Response('OK');
        }
      }
    }

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      let body = {};
      try { body = await request.clone().json(); } catch {}
      const nextStatus = String(body?.status || '');
      const clientId = positiveInt(body?.clientTelegramId || body?.order?.client_telegram_id);
      const number = cleanOrderNumber(body?.order?.order_number);
      if (clientId && number && nextStatus && nextStatus !== 'CANCELLED') {
        const current = await appOrder(env,clientId,number);
        if (current?.status === 'CANCELLED') {
          return json({ok:false,error:'Заявка отменена клиентом. Подтвердить или завершить её нельзя.',status:'CANCELLED'},409);
        }
      }
    }

    if (url.pathname === '/api/admin-ultra7/broadcast' && request.method === 'POST') {
      const auth = await adminSnapshot(request,env,ctx);
      if (!auth?.ok) return json({ok:false,error:'Недостаточно прав'},403);
      let body = {};
      try { body = await request.json(); } catch {}
      return sendBroadcastV69(env,body,auth.data);
    }

    if (url.pathname === '/api/admin-ultra7' && request.method === 'GET') {
      const response = await baseWorker.fetch(request,env,ctx);
      if (!response.ok) return response;
      const data = await response.json().catch(()=>({}));
      const extra = await broadcastAudience(env,data);
      return json({...data,counts:{...(data.counts||{}),...extra.counts}});
    }

    return baseWorker.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller,env,ctx);
  },
};

async function adminSnapshot(request,env,ctx) {
  const target = new URL('/api/admin-ultra7',request.url);
  const probe = new Request(target,{headers:{'X-Telegram-Init-Data':request.headers.get('X-Telegram-Init-Data')||''}});
  const response = await baseWorker.fetch(probe,env,ctx);
  if (!response.ok) return {ok:false,data:null};
  return {ok:true,data:await response.json().catch(()=>({}))};
}

async function broadcastAudience(env,adminData={}) {
  const stub = appStub(env);
  const [registeredRes,staffRes] = await Promise.all([
    stub?.fetch('https://app.internal/v69/bot-users'),
    stub?.fetch('https://app.internal/staff/list'),
  ]);
  const registered = registeredRes?.ok ? (await registeredRes.json().catch(()=>({}))).users || [] : [];
  const staff = staffRes?.ok ? (await staffRes.json().catch(()=>({}))).staff || [] : [];
  const clients = Array.isArray(adminData?.clients) ? adminData.clients : [];
  const byId = new Map();
  for (const row of [...registered,...clients,...staff]) {
    const id = positiveInt(row?.telegram_id);
    if (id) byId.set(id,{...(byId.get(id)||{}),...row,telegram_id:id});
  }
  const staffIds = new Set(staff.map(x=>positiveInt(x?.telegram_id)).filter(Boolean));
  const activeIds = new Set(clients.filter(x=>Number(x?.active_count||0)>0).map(x=>positiveInt(x.telegram_id)).filter(Boolean));
  const clientIds = new Set(clients.map(x=>positiveInt(x?.telegram_id)).filter(Boolean));
  const all = [...byId.values()];
  return {
    all, staffIds, activeIds, clientIds,
    counts:{
      all_users:all.length,
      staff:all.filter(x=>staffIds.has(x.telegram_id)).length,
      active:all.filter(x=>activeIds.has(x.telegram_id)).length,
      inactive:all.filter(x=>!staffIds.has(x.telegram_id) && !activeIds.has(x.telegram_id)).length,
    },
  };
}

async function sendBroadcastV69(env,body,adminData) {
  if (!env?.TELEGRAM_BOT_TOKEN) return json({ok:false,error:'Telegram bot token is not configured'},503);
  const title = clean(body.title,160);
  const message = cleanMultiline(body.message,3500);
  const segment = ['all','staff','active','inactive'].includes(String(body.segment||'')) ? String(body.segment) : 'all';
  if (!message) return json({ok:false,error:'Введите текст рассылки'},400);
  const audience = await broadcastAudience(env,adminData);
  let recipients = audience.all;
  if (segment === 'staff') recipients = recipients.filter(x=>audience.staffIds.has(x.telegram_id));
  if (segment === 'active') recipients = recipients.filter(x=>audience.activeIds.has(x.telegram_id));
  if (segment === 'inactive') recipients = recipients.filter(x=>!audience.staffIds.has(x.telegram_id) && !audience.activeIds.has(x.telegram_id));
  recipients = [...new Map(recipients.map(x=>[x.telegram_id,x])).values()];
  if (!recipients.length) return json({ok:false,error:'В выбранном сегменте нет получателей'},409);

  const text = [title?`<b>${escapeHtml(title)}</b>`:'',escapeHtml(message)].filter(Boolean).join('\n\n');
  const buttonText = clean(body.button_text,60);
  const buttonUrl = safeButtonUrl(body.button_url);
  const markup = buttonText && buttonUrl ? {inline_keyboard:[[{text:buttonText,url:buttonUrl}]]} : undefined;
  let sent=0,failed=0;
  for (let i=0;i<recipients.length;i+=12) {
    const chunk=recipients.slice(i,i+12);
    const results=await Promise.allSettled(chunk.map(x=>telegram(env,'sendMessage',{
      chat_id:Number(x.telegram_id),text,parse_mode:'HTML',...(markup?{reply_markup:markup}:{})
    })));
    for (const result of results) result.status==='fulfilled'?sent++:failed++;
    if (i+12<recipients.length) await delay(80);
  }
  try {
    await appStub(env)?.fetch('https://app.internal/ultra7/broadcast-log',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title,message,segment,sent,failed,skipped:0})
    });
  } catch {}
  return json({ok:true,sent,failed,skipped:0,segment,audience:recipients.length});
}

async function registerBotUser(env,user) {
  try {
    await appStub(env)?.fetch('https://app.internal/v69/bot-user',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        telegram_id:positiveInt(user?.id),first_name:user?.first_name||'',last_name:user?.last_name||'',username:user?.username||''
      })
    });
  } catch {}
}
function appStub(env){return env.APP_STORE?env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME)):null;}
async function appOrder(env,userId,number){try{const r=await appStub(env)?.fetch(`https://app.internal/order?user=${encodeURIComponent(userId)}&number=${encodeURIComponent(number)}`);return r?.ok?r.json():null}catch{return null}}
function decodeOrderNumber(value){try{return cleanOrderNumber(decodeURIComponent(value))}catch{return cleanOrderNumber(value)}}
function cleanOrderNumber(value){const v=String(value||'').trim();return /^[A-Za-z0-9._-]{3,80}$/.test(v)?v:''}
function positiveInt(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:0}
function clean(value,max=160){return String(value||'').trim().replace(/\s+/g,' ').slice(0,max)}
function cleanMultiline(value,max=3500){return String(value||'').replace(/\r/g,'').trim().slice(0,max)}
function safeButtonUrl(value){const raw=String(value||'').trim();if(!raw)return '';try{const u=new URL(raw);return ['http:','https:','tg:'].includes(u.protocol)?u.toString():''}catch{return ''}}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}
async function telegramSafe(env,method,payload){try{return await telegram(env,method,payload)}catch{return null}}
async function telegram(env,method,payload){const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.description||`Telegram ${method} failed`);return d.result}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store'}})}
