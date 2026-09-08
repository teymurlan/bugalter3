export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, mode: 'demo-bot-v5', hasBotToken: !!env.TELEGRAM_BOT_TOKEN, hasWebhookSecret: !!env.TELEGRAM_WEBHOOK_SECRET, adminCount: admins(env).length });
    }

    if (url.pathname === '/api/demo-config') {
      let botUsername = '';
      try { botUsername = (await tg(env, 'getMe', {})).username || ''; } catch {}
      return json({ ok: true, botUsername, managerUsername: String(env.MANAGER_USERNAME || botUsername).replace(/^@/, ''), adminConfigured: admins(env).length > 0, cancelCutoffHours: 24, reminder24hReady: !!env.DB });
    }

    if (url.pathname === '/telegram/status') {
      const base = { ok: true, hasBotToken: !!env.TELEGRAM_BOT_TOKEN, hasWebhookSecret: !!env.TELEGRAM_WEBHOOK_SECRET, adminCount: admins(env).length, expectedWebhook: `${url.origin}/telegram/webhook` };
      if (!env.TELEGRAM_BOT_TOKEN) return json(base);
      try {
        const [me, hook] = await Promise.all([tg(env, 'getMe', {}), tg(env, 'getWebhookInfo', {})]);
        return json({ ...base, bot: { id: me.id, username: me.username, first_name: me.first_name }, webhook: { url: hook.url || '', pending_update_count: hook.pending_update_count || 0, last_error_message: hook.last_error_message || '', allowed_updates: hook.allowed_updates || [] } });
      } catch (e) { return json({ ...base, ok: false, error: e.message }, 500); }
    }

    if (url.pathname === '/telegram/test-admin' && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false, error: 'Сначала настройте TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET' }, 400);
      let body = {}; try { body = await request.json(); } catch {}
      if (body.secret !== env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false, error: 'Неверный TELEGRAM_WEBHOOK_SECRET' }, 403);
      const ids = admins(env);
      if (!ids.length) return json({ ok: false, error: 'ADMIN_TELEGRAM_IDS не настроен' }, 400);
      const rs = await Promise.allSettled(ids.map(id => tg(env, 'sendMessage', { chat_id: id, text: '<b>HOUSE CLEANING</b>\n\nТестовое уведомление администратору доставлено.', parse_mode: 'HTML' })));
      const sent = rs.filter(r => r.status === 'fulfilled').length;
      const errors = rs.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason));
      return json({ ok: sent > 0, sent, total: ids.length, errors }, sent > 0 ? 200 : 502);
    }

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      const user = await authUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      let body; try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректный запрос' }, 400); }
      const order = cleanOrder(body?.order);
      if (!order) return json({ ok: false, error: 'Недостаточно данных заявки' }, 400);
      const event = body?.event === 'cancelled' ? 'cancelled' : 'created';

      const adminText = event === 'created' ? newOrderText(order, user) : cancelledText(order, user);
      const adminKeyboard = event === 'created' ? { inline_keyboard: [
        [{ text: 'Подтвердить', callback_data: cb('c', user.id, order.order_number), style: 'success' }, { text: 'Отменить', callback_data: cb('x', user.id, order.order_number), style: 'danger' }],
        [{ text: 'Написать клиенту', url: `tg://user?id=${user.id}` }],
        [{ text: 'Панель заказов', web_app: { url: `${url.origin}/?demo=1&admin=1` }, style: 'primary' }],
      ] } : { inline_keyboard: [[{ text: 'Написать клиенту', url: `tg://user?id=${user.id}` }]] };

      const ids = admins(env);
      const results = await Promise.allSettled(ids.map(id => tg(env, 'sendMessage', { chat_id: id, text: adminText, parse_mode: 'HTML', reply_markup: adminKeyboard })));
      const adminNotified = results.filter(r => r.status === 'fulfilled').length;
      const adminErrors = results.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason));

      const clientText = event === 'created'
        ? `<b>Заявка получена</b>\n\n<b>${esc(order.order_number)}</b>\n${esc(order.service_name)} · ${order.area} м²\n${esc(order.date)} · ${esc(order.time || '—')}\n${esc(`${order.city}, ${order.address}`)}\n\nЗаявка передана администратору. После подтверждения бот пришлёт отдельное сообщение.`
        : `<b>Заявка отменена</b>\n\n<b>${esc(order.order_number)}</b>\nОтмена принята. Администратор уведомлён.`;
      const clientSent = await safe(env, 'sendMessage', { chat_id: user.id, text: clientText, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Открыть HOUSE CLEANING', web_app: { url: `${url.origin}/?demo=1` }, style: 'primary' }]] } });
      return json({ ok: true, event, adminConfigured: ids.length > 0, adminNotified, adminErrors, clientNotified: !!clientSent });
    }

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      const user = await authUser(request, env);
      if (!user || !isAdmin(env, user.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      let body; try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректный запрос' }, 400); }
      const order = cleanOrder(body?.order);
      const clientId = Number(body?.clientTelegramId || order?.client_telegram_id || 0);
      if (!order || !Number.isSafeInteger(clientId) || clientId <= 0) return json({ ok: false, error: 'Нет Telegram ID клиента' }, 400);
      const sent = await sendStatus(env, clientId, order.order_number, String(body?.status || ''), url.origin);
      return json({ ok: true, clientNotified: !!sent });
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN) return new Response('Bot token missing', { status: 500 });
      if (env.TELEGRAM_WEBHOOK_SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
      let update; try { update = await request.json(); } catch { return new Response('Bad Request', { status: 400 }); }

      if (update.callback_query) { await handleCallback(update.callback_query, env, url.origin); return new Response('OK'); }
      const msg = update.message || update.edited_message;
      const chatId = msg?.chat?.id;
      const text = String(msg?.text || '').trim();
      if (!chatId) return new Response('OK');

      if (text === '/myid' || text === '/id') {
        const ok = isAdmin(env, chatId);
        await safe(env, 'sendMessage', { chat_id: chatId, text: `Ваш Telegram ID: ${chatId}\n\nADMIN_TELEGRAM_IDS: ${ok ? 'подключён' : 'НЕ подключён'}${ok ? '' : `\nДобавьте ${chatId} в Cloudflare и сделайте Deploy.`}` });
        return new Response('OK');
      }

      if (text === '/notifytest') {
        if (!isAdmin(env, chatId)) { await safe(env, 'sendMessage', { chat_id: chatId, text: `Ваш ID ${chatId} отсутствует в ADMIN_TELEGRAM_IDS.` }); return new Response('OK'); }
        const ids = admins(env);
        const rs = await Promise.allSettled(ids.map(id => tg(env, 'sendMessage', { chat_id: id, text: '<b>Тест HOUSE CLEANING</b>\nУведомления администратора работают.', parse_mode: 'HTML' })));
        await safe(env, 'sendMessage', { chat_id: chatId, text: `Доставлено: ${rs.filter(r => r.status === 'fulfilled').length}/${ids.length}` });
        return new Response('OK');
      }

      if (text.startsWith('/start')) {
        if (env.TELEGRAM_WEBHOOK_SECRET) await safe(env, 'setWebhook', { url: `${url.origin}/telegram/webhook`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'edited_message', 'callback_query'], drop_pending_updates: false });
        const name = msg?.from?.first_name || 'клиент';
        const appUrl = `${url.origin}/?demo=1`;
        const keyboard = [[{ text: 'Заказать уборку', web_app: { url: appUrl }, style: 'success' }]];
        if (isAdmin(env, chatId)) keyboard.push([{ text: 'Панель администратора', web_app: { url: `${url.origin}/?demo=1&admin=1` }, style: 'primary' }]);
        await safe(env, 'sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `<b>HOUSE CLEANING</b>\n\nЗдравствуйте, ${esc(name)}.\n\nОформите уборку квартиры, дома или офиса прямо в Telegram: выберите услугу, площадь, добавьте фото и свободную дату.\n\nПосле отправки бот сообщит о получении заявки, подтверждении, завершении и отмене.`, reply_markup: { inline_keyboard: keyboard } });
        return new Response('OK');
      }

      if (text === '/admin' && isAdmin(env, chatId)) {
        await safe(env, 'sendMessage', { chat_id: chatId, text: '<b>HOUSE CLEANING · Администратор</b>', parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Открыть заказы', web_app: { url: `${url.origin}/?demo=1&admin=1` }, style: 'primary' }]] } });
        return new Response('OK');
      }

      if (text && !text.startsWith('/')) {
        const ids = admins(env);
        if (!ids.length) { await safe(env, 'sendMessage', { chat_id: chatId, text: 'Менеджер пока не подключён.' }); return new Response('OK'); }
        const u = msg.from || {};
        const body = `<b>СООБЩЕНИЕ КЛИЕНТА</b>\n\n${esc([u.first_name,u.last_name].filter(Boolean).join(' ') || 'Клиент')}\n${u.username ? '@'+esc(u.username) : 'ID '+chatId}\n\n${esc(text)}`;
        await Promise.allSettled(ids.map(id => tg(env, 'sendMessage', { chat_id: id, text: body, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Ответить', url: `tg://user?id=${chatId}` }]] } })));
        await safe(env, 'sendMessage', { chat_id: chatId, text: 'Сообщение передано менеджеру.' });
      }
      return new Response('OK');
    }

    if (url.pathname === '/telegram/setup' && request.method === 'GET') return new Response(setupPage(), { headers: { 'content-type': 'text/html; charset=UTF-8' } });
    if (url.pathname === '/telegram/setup' && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false, error: 'Добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET' }, 400);
      let body={}; try { body=await request.json(); } catch {}
      if (body.secret !== env.TELEGRAM_WEBHOOK_SECRET) return json({ ok:false,error:'Неверный секрет' },403);
      const hook = `${url.origin}/telegram/webhook`;
      try { await tg(env,'setWebhook',{url:hook,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','edited_message','callback_query'],drop_pending_updates:false}); return json({ok:true,webhookUrl:hook,webhook:await tg(env,'getWebhookInfo',{})}); }
      catch(e){ return json({ok:false,error:e.message},500); }
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleCallback(q, env, origin) {
  if (!isAdmin(env, q?.from?.id)) { await safe(env,'answerCallbackQuery',{callback_query_id:q.id,text:'Нет доступа',show_alert:true}); return; }
  const m=/^hc:(c|x|d):(\d+):(.+)$/.exec(String(q.data||''));
  if(!m){ await safe(env,'answerCallbackQuery',{callback_query_id:q.id,text:'Команда устарела'}); return; }
  const action=m[1], clientId=Number(m[2]), number=decodeURIComponent(m[3]);
  const status=action==='c'?'CONFIRMED':action==='x'?'CANCELLED':'COMPLETED';
  await sendStatus(env,clientId,number,status,origin);
  await safe(env,'answerCallbackQuery',{callback_query_id:q.id,text:status==='CONFIRMED'?'Заявка подтверждена':status==='COMPLETED'?'Уборка завершена':'Заявка отменена'});
  if(q.message?.chat?.id&&q.message?.message_id){
    const keys=action==='c'?{inline_keyboard:[[{text:'Завершить уборку',callback_data:cb('d',clientId,number),style:'success'}],[{text:'Отменить',callback_data:cb('x',clientId,number),style:'danger'}],[{text:'Написать клиенту',url:`tg://user?id=${clientId}`}]]}:{inline_keyboard:[[{text:'Написать клиенту',url:`tg://user?id=${clientId}`}]]};
    await safe(env,'editMessageReplyMarkup',{chat_id:q.message.chat.id,message_id:q.message.message_id,reply_markup:keys});
  }
}

async function sendStatus(env, clientId, number, status, origin){
  let text='';
  if(status==='CONFIRMED') text=`<b>Заявка подтверждена</b>\n\n<b>${esc(number)}</b>\nАдминистратор подтвердил уборку.`;
  if(status==='COMPLETED') text=`<b>Уборка завершена</b>\n\n<b>${esc(number)}</b>\nСпасибо, что выбрали HOUSE CLEANING.`;
  if(status==='CANCELLED') text=`<b>Заявка отменена</b>\n\n<b>${esc(number)}</b>\nЕсли нужно подобрать другую дату, напишите менеджеру.`;
  if(!text)return null;
  return safe(env,'sendMessage',{chat_id:clientId,text,parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'Открыть HOUSE CLEANING',web_app:{url:`${origin}/?demo=1`},style:'primary'}]]}});
}

function newOrderText(o,u){return `<b>НОВАЯ ЗАЯВКА · HOUSE CLEANING</b>\n\n<b>${esc(o.order_number)}</b>\nКлиент: <b>${esc(o.customer_name)}</b>\nТелефон: ${esc(o.phone||'—')}\nУборка: ${esc(o.service_name)}\nПлощадь: <b>${o.area} м²</b>\nДата: <b>${esc(o.date)} · ${esc(o.time||'—')}</b>\nАдрес: ${esc(`${o.city}, ${o.address}`)}\nДополнительно: ${esc(o.addon_names.join(', ')||'нет')}\nФото: ${o.photo_count}\n\nTelegram: ${u.username?'@'+esc(u.username):'ID '+u.id}`}
function cancelledText(o,u){return `<b>ЗАЯВКА ОТМЕНЕНА · HOUSE CLEANING</b>\n\n<b>${esc(o.order_number)}</b>\nКлиент: <b>${esc(o.customer_name)}</b>\nТелефон: ${esc(o.phone||'—')}\nДата: <b>${esc(o.date)} · ${esc(o.time||'—')}</b>\nАдрес: ${esc(`${o.city}, ${o.address}`)}\nTelegram: ${u.username?'@'+esc(u.username):'ID '+u.id}`}
function cleanOrder(r){const a=Number(r?.area||0);if(!r?.order_number||!r?.customer_name||!r?.date||!r?.address||!Number.isFinite(a)||a<1||a>5000)return null;return {...r,area:a,order_number:String(r.order_number),customer_name:String(r.customer_name),phone:String(r.phone||''),service_name:String(r.service_name||'Уборка'),city:String(r.city||''),address:String(r.address||''),date:String(r.date),time:String(r.time||''),addon_names:Array.isArray(r.addon_names)?r.addon_names.map(String):[],photo_count:Math.max(0,Number(r.photo_count||0)),client_telegram_id:Number(r.client_telegram_id||0)}}
function cb(a,id,n){return `hc:${a}:${id}:${encodeURIComponent(String(n).slice(0,28))}`.slice(0,64)}
function admins(env){const raw=[env.ADMIN_TELEGRAM_IDS,env.ADMIN_TELEGRAM_ID,env.ADMIN_ID].filter(Boolean).join(',');return [...new Set(String(raw).split(/[;,\s]+/).map(v=>v.trim()).filter(v=>/^-?\d+$/.test(v)))]}
function isAdmin(env,id){return admins(env).includes(String(id))}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))}
async function safe(env,m,p){try{return await tg(env,m,p)}catch(e){console.error(m,e);return null}}
async function tg(env,m,p){const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.description||`Telegram ${m} failed`);return d.result}
function json(d,s=200){return new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json; charset=UTF-8','cache-control':'no-store'}})}
async function authUser(request,env){return validateInitData(request.headers.get('X-Telegram-Init-Data')||'',env.TELEGRAM_BOT_TOKEN)}
async function validateInitData(data,token){if(!data||!token)return null;try{const p=new URLSearchParams(data),hash=p.get('hash');if(!hash)return null;p.delete('hash');const s=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=await hmac(new TextEncoder().encode('WebAppData'),new TextEncoder().encode(token));const calc=await hmac(secret,new TextEncoder().encode(s));const hex=[...new Uint8Array(calc)].map(b=>b.toString(16).padStart(2,'0')).join('');if(!eq(hex,hash.toLowerCase()))return null;const ad=Number(p.get('auth_date')||0);if(!ad||Math.abs(Date.now()/1000-ad)>86400)return null;const u=JSON.parse(p.get('user')||'null');return u?.id?u:null}catch{return null}}
async function hmac(k,d){const key=await crypto.subtle.importKey('raw',k,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',key,d)}
function eq(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
function setupPage(){return `<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width"><style>body{font-family:-apple-system;background:#05090c;color:#fff;max-width:560px;margin:auto;padding:28px 18px}.c{background:#101820;border:1px solid #283542;border-radius:20px;padding:18px;margin-bottom:14px}input,button{width:100%;box-sizing:border-box;padding:14px;border-radius:14px;font-size:16px;margin-top:12px}input{background:#071016;color:#fff;border:1px solid #33404a}button{border:0;background:#f7bb38;font-weight:800}button.test{background:#18331f;color:#a9e8b5;border:1px solid #2c6839}pre{white-space:pre-wrap;background:#071016;padding:12px;border-radius:12px;color:#cbd2d9}</style><h1>Telegram Setup</h1><div class="c"><button id="check">Проверить состояние</button><pre id="s"></pre><input id="secret" type="password" placeholder="TELEGRAM_WEBHOOK_SECRET"><button id="go">Установить webhook</button><button class="test" id="test">Тест уведомления админу</button><pre id="o"></pre></div><div class="c">Для уведомлений админу в Cloudflare укажите <b>ADMIN_TELEGRAM_IDS</b>. Telegram ID можно получить командой <b>/myid</b>.</div><script>check.onclick=async()=>s.textContent=JSON.stringify(await(await fetch('/telegram/status')).json(),null,2);go.onclick=async()=>o.textContent=JSON.stringify(await(await fetch('/telegram/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:secret.value})})).json(),null,2);test.onclick=async()=>o.textContent=JSON.stringify(await(await fetch('/telegram/test-admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:secret.value})})).json(),null,2)</script>`}
