import baseWorker, { ConsentStore, AppStore } from './demo-worker-v40-admin-diagnostic.js';
import { handleHouseCleaningStaff, staffAppUrl } from './house-cleaning-staff.js';

export { ConsentStore, AppStore };

export default {
  async fetch(request, env, ctx) {
    const staffResponse = await handleHouseCleaningStaff(request, env, ctx, baseWorker);
    if (staffResponse) return staffResponse;

    const url = new URL(request.url);
    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      let update = null;
      try { update = await request.clone().json(); } catch {}
      const message = update?.message || update?.edited_message;
      const chatId = positiveInt(message?.chat?.id);
      const userId = positiveInt(message?.from?.id);
      const command = commandName(message?.text);

      if (chatId && userId && command === '/admin') {
        if (isFullAdmin(env,userId)) {
          await openStaffApp(env,chatId,'admin',url.origin);
          return json({ok:true,role:'admin'});
        }
        await telegramSafe(env,'sendMessage',{chat_id:chatId,text:'Полный доступ HOUSE CLEANING STAFF есть только у главного администратора.'});
        return json({ok:true,role:'none'});
      }

      if (chatId && userId && command === '/staff') {
        const role = isFullAdmin(env,userId) ? 'admin' : (await staffExists(env,userId) ? 'staff' : 'none');
        if (role !== 'none') {
          await openStaffApp(env, chatId, role, url.origin);
          return json({ ok:true, role });
        }
        await telegramSafe(env,'sendMessage',{ chat_id:chatId, text:'Доступ к HOUSE CLEANING STAFF ещё не выдан. Обратитесь к руководителю.' });
        return json({ ok:true, role:'none' });
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function openStaffApp(env, chatId, role, origin) {
  const url = staffAppUrl(origin);
  const title = role === 'admin' ? 'HOUSE CLEANING STAFF · Руководитель' : 'HOUSE CLEANING STAFF';
  const text = role === 'admin'
    ? '<b>HOUSE CLEANING STAFF</b>\n\nЗаказы, сотрудники, назначения и фотоотчёты — в одном рабочем приложении.'
    : '<b>HOUSE CLEANING STAFF</b>\n\nВаши задания, фотоотчёты, график и рабочий профиль.';
  await Promise.allSettled([
    telegramSafe(env,'setChatMenuButton',{ chat_id:chatId, menu_button:{ type:'web_app', text:'HOUSE CLEANING STAFF', web_app:{url} } }),
    telegramSafe(env,'sendMessage',{ chat_id:chatId, text, parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:title, web_app:{url} }]] } }),
  ]);
}

async function staffExists(env,id){try{if(!env.APP_STORE)return false;const stub=env.APP_STORE.get(env.APP_STORE.idFromName('house-cleaning-app-v1'));const r=await stub.fetch(`https://app.internal/staff/get?id=${encodeURIComponent(id)}`);return Boolean(r?.ok)}catch{return false}}
function isFullAdmin(env,id){const raw=[env.ADMIN_TELEGRAM_IDS,env.ADMIN_TELEGRAM_ID,env.ADMIN_ID].filter(Boolean).join(',');return raw.split(/[;,\s]+/).map(v=>v.trim()).filter(Boolean).includes(String(id))}
function commandName(v){const first=String(v||'').trim().split(/\s+/,1)[0].toLowerCase();return first.split('@',1)[0]}
function positiveInt(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:0}
async function telegramSafe(env,method,payload){try{return await telegram(env,method,payload)}catch(e){console.error('HOUSE CLEANING STAFF Telegram error',e);return null}}
async function telegram(env,method,payload){if(!env.TELEGRAM_BOT_TOKEN)throw new Error('Bot token missing');const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.description||'Telegram error');return d.result}
function json(v,status=200){return new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store'}})}
