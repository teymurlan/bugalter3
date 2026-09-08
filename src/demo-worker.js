export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        ok: true,
        mode: 'demo-bot',
        hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
        hasWebhookSecret: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
        hasAdminIds: adminIds(env).length > 0,
      });
    }

    if (url.pathname === '/api/demo-config' && request.method === 'GET') {
      let botUsername = '';
      if (env.TELEGRAM_BOT_TOKEN) {
        try {
          const me = await telegram(env.TELEGRAM_BOT_TOKEN, 'getMe', {});
          botUsername = me.username || '';
        } catch { /* config can still be returned */ }
      }
      return json({
        ok: true,
        botUsername,
        managerUsername: String(env.MANAGER_USERNAME || botUsername || '').replace(/^@/, ''),
        cancelCutoffHours: 24,
      });
    }

    if (url.pathname === '/telegram/status' && request.method === 'GET') {
      const base = {
        ok: true,
        hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
        hasWebhookSecret: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
        hasAdminIds: adminIds(env).length > 0,
        expectedWebhook: `${url.origin}/telegram/webhook`,
      };
      if (!env.TELEGRAM_BOT_TOKEN) return json(base);
      try {
        const [me, webhook] = await Promise.all([
          telegram(env.TELEGRAM_BOT_TOKEN, 'getMe', {}),
          telegram(env.TELEGRAM_BOT_TOKEN, 'getWebhookInfo', {}),
        ]);
        return json({
          ...base,
          bot: { id: me.id, username: me.username, first_name: me.first_name },
          webhook: {
            url: webhook.url || '',
            pending_update_count: webhook.pending_update_count || 0,
            last_error_date: webhook.last_error_date || null,
            last_error_message: webhook.last_error_message || '',
            max_connections: webhook.max_connections || null,
          },
        });
      } catch (error) {
        return json({ ...base, ok: false, error: error.message || 'Telegram API error' }, 500);
      }
    }

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: 'Bot token is not configured' }, 500);
      const initData = request.headers.get('X-Telegram-Init-Data') || '';
      const telegramUser = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
      if (!telegramUser) return json({ ok: false, error: 'Telegram authorization failed' }, 401);

      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Некорректный запрос' }, 400); }

      const event = body?.event === 'cancelled' ? 'cancelled' : 'created';
      const order = body?.order || {};
      if (!order.order_number || !order.customer_name || !order.date || !order.address) {
        return json({ ok: false, error: 'Недостаточно данных заявки' }, 400);
      }
      const area = Number(order.area || 0);
      if (!Number.isFinite(area) || area < 1 || area > 5000) return json({ ok: false, error: 'Некорректная площадь' }, 400);

      const ids = adminIds(env);
      if (!ids.length) return json({ ok: true, notified: 0, warning: 'ADMIN_TELEGRAM_IDS is not configured' });

      const isCancelled = event === 'cancelled';
      const heading = isCancelled ? 'ЗАЯВКА ОТМЕНЕНА' : 'НОВАЯ ЗАЯВКА';
      const icon = isCancelled ? '❌' : '🧹';
      const text = `${icon} <b>${heading} · HOUSE CLEANING</b>\n\n<b>${html(order.order_number)}</b>\nКлиент: <b>${html(order.customer_name)}</b>\nТелефон: ${html(order.phone || '—')}\nУборка: ${html(order.service_name || '—')}\nПлощадь: <b>${area} м²</b>\nДата: <b>${html(order.date)} · ${html(order.time || '—')}</b>\nАдрес: ${html(`${order.city || ''}, ${order.address || ''}`)}\nДополнительно: ${html((order.addon_names || []).join(', ') || 'нет')}\nФото: ${Number(order.photo_count || 0)}\n\nTelegram: ${telegramUser.username ? '@' + html(telegramUser.username) : 'ID ' + telegramUser.id}`;
      const markup = {
        inline_keyboard: [
          [{ text: 'Написать клиенту', url: `tg://user?id=${telegramUser.id}` }],
          [{ text: 'Панель заказов', web_app: { url: `${url.origin}/?demo=1&admin=1` }, style: 'primary' }],
        ],
      };
      const results = await Promise.allSettled(ids.map((id) => telegram(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
        chat_id: id,
        text,
        parse_mode: 'HTML',
        reply_markup: markup,
      })));
      const notified = results.filter((result) => result.status === 'fulfilled').length;
      return json({ ok: true, event, notified });
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN) return new Response('Bot token is not configured', { status: 500 });
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const incomingSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
        if (incomingSecret !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
      }

      let update;
      try { update = await request.json(); }
      catch { return new Response('Bad Request', { status: 400 }); }

      const message = update?.message || update?.edited_message;
      const chatId = message?.chat?.id;
      const text = String(message?.text || '').trim();
      if (!chatId) return new Response('OK');

      if (text === '/myid' || text === '/id') {
        await safeTelegram(env, 'sendMessage', {
          chat_id: chatId,
          text: `Ваш Telegram ID: ${chatId}\n\nДобавьте это число в Cloudflare как ADMIN_TELEGRAM_IDS, чтобы получать уведомления о новых и отменённых заказах.`,
        });
        return new Response('OK');
      }

      if (text === '/admin' && isAdmin(env, chatId)) {
        await safeTelegram(env, 'sendMessage', {
          chat_id: chatId,
          text: '<b>Панель HOUSE CLEANING</b>\n\nНовые, ожидающие, активные, завершённые и отменённые заявки собраны в одном интерфейсе.',
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: 'Открыть админ-панель', web_app: { url: `${url.origin}/?demo=1&admin=1` }, style: 'primary' }]] },
        });
        return new Response('OK');
      }

      if (text.startsWith('/start')) {
        const firstName = message?.from?.first_name || 'клиент';
        const startParam = text.split(/\s+/, 2)[1] || '';
        const appUrl = `${url.origin}/?demo=1`;

        if (startParam.startsWith('manager')) {
          await safeTelegram(env, 'sendMessage', {
            chat_id: chatId,
            text: `<b>Связь с менеджером HOUSE CLEANING</b>\n\n${html(firstName)}, напишите одним сообщением, что нужно изменить или отменить. Менеджер получит ваше сообщение вместе с Telegram-контактом.`,
            parse_mode: 'HTML',
          });
          return new Response('OK');
        }

        const keyboard = [[{ text: 'Заказать уборку', web_app: { url: appUrl }, style: 'success' }]];
        if (isAdmin(env, chatId)) keyboard.push([{ text: 'Панель администратора', web_app: { url: `${url.origin}/?demo=1&admin=1` }, style: 'primary' }]);
        const greeting = `<b>HOUSE CLEANING</b>\n\nЗдравствуйте, ${html(firstName)}.\n\nПрофессиональная уборка квартиры, дома или офиса — без долгих звонков.\n\nВ приложении вы сможете:\n• выбрать подходящую уборку\n• указать площадь и адрес\n• приложить фото объекта\n• увидеть свободные даты и время\n• отправить заявку и следить за её статусом\n\nОформление занимает около 2 минут. Нажмите кнопку ниже.`;
        await safeTelegram(env, 'sendMessage', {
          chat_id: chatId,
          text: greeting,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        });
        return new Response('OK');
      }

      if (text === '/help') {
        await safeTelegram(env, 'sendMessage', {
          chat_id: chatId,
          text: 'Откройте /start для заказа уборки. Если нужен менеджер — просто напишите вопрос сообщением в этот чат.',
        });
        return new Response('OK');
      }

      if (text && !text.startsWith('/')) {
        const ids = adminIds(env);
        if (!ids.length) {
          await safeTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Менеджер пока не подключён. Попробуйте немного позже.' });
          return new Response('OK');
        }
        const user = message?.from || {};
        const managerText = `<b>СООБЩЕНИЕ КЛИЕНТА · HOUSE CLEANING</b>\n\nКлиент: <b>${html([user.first_name, user.last_name].filter(Boolean).join(' ') || 'Клиент')}</b>\nTelegram: ${user.username ? '@' + html(user.username) : 'ID ' + chatId}\n\n${html(text)}`;
        const markup = { inline_keyboard: [[{ text: 'Ответить клиенту', url: `tg://user?id=${chatId}` }]] };
        await Promise.allSettled(ids.map((id) => telegram(env.TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: id, text: managerText, parse_mode: 'HTML', reply_markup: markup })));
        await safeTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Сообщение передано менеджеру HOUSE CLEANING. Вам ответят в Telegram.' });
      }

      return new Response('OK');
    }

    if (url.pathname === '/telegram/setup' && request.method === 'GET') {
      return new Response(setupPage(), { headers: { 'content-type': 'text/html; charset=UTF-8' } });
    }

    if (url.pathname === '/telegram/setup' && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
        return json({ ok: false, error: 'Сначала добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET в Cloudflare' }, 400);
      }
      let body = {};
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Некорректный запрос' }, 400); }
      if (body.secret !== env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false, error: 'Неверный секрет' }, 403);
      const webhookUrl = `${url.origin}/telegram/webhook`;
      try {
        const result = await telegram(env.TELEGRAM_BOT_TOKEN, 'setWebhook', {
          url: webhookUrl,
          secret_token: env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ['message', 'edited_message'],
          drop_pending_updates: false,
        });
        const webhook = await telegram(env.TELEGRAM_BOT_TOKEN, 'getWebhookInfo', {});
        return json({ ok: true, webhookUrl, telegram: result, webhook });
      } catch (error) {
        return json({ ok: false, error: error.message || 'Не удалось установить webhook' }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};

function adminIds(env) {
  return String(env.ADMIN_TELEGRAM_IDS || '').split(',').map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value));
}
function isAdmin(env, id) { return adminIds(env).includes(String(id)); }
function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

async function safeTelegram(env, method, payload) {
  try { return await telegram(env.TELEGRAM_BOT_TOKEN, method, payload); }
  catch (error) { console.error(`Telegram ${method} failed`, error); return null; }
}
async function telegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    params.delete('signature');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretKey = await hmac(new TextEncoder().encode('WebAppData'), new TextEncoder().encode(botToken));
    const calculated = await hmac(secretKey, new TextEncoder().encode(dataCheckString));
    const calculatedHex = [...new Uint8Array(calculated)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (!constantEqual(calculatedHex, hash.toLowerCase())) return null;
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
    return JSON.parse(params.get('user') || 'null');
  } catch { return null; }
}
async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, dataBytes);
}
function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function setupPage() {
  return `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HOUSE CLEANING Bot Setup</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#05090c;color:#f6f7f8;max-width:560px;margin:0 auto;padding:32px 20px}h1{font-size:28px}.card{background:#101820;border:1px solid #26313a;border-radius:20px;padding:20px;margin-bottom:14px}.muted{color:#8d98a8;line-height:1.5}input,button{width:100%;box-sizing:border-box;border-radius:14px;padding:14px 16px;font-size:16px}input{background:#071016;color:white;border:1px solid #33404a;margin:12px 0}button{background:#f7bb38;color:#0b0d0f;border:0;font-weight:800}button.secondary{background:#202b33;color:#f6f7f8;margin-top:10px}pre{white-space:pre-wrap;word-break:break-word;color:#cbd2d9;background:#071016;border-radius:12px;padding:12px;font-size:13px}</style></head><body><h1>Подключение Telegram</h1><div class="card"><p class="muted">Проверка токена, webhook и ADMIN_TELEGRAM_IDS. Значения секретов здесь не отображаются.</p><button class="secondary" id="check">Проверить состояние</button><pre id="status">Нажмите «Проверить состояние»</pre></div><div class="card"><p class="muted">Введите TELEGRAM_WEBHOOK_SECRET из Cloudflare.</p><input id="secret" type="password" placeholder="TELEGRAM_WEBHOOK_SECRET"><button id="go">Установить webhook</button><pre id="out"></pre></div><script>async function check(){const el=document.getElementById('status');el.textContent='Проверяем...';try{const r=await fetch('/telegram/status');const d=await r.json();el.textContent=JSON.stringify(d,null,2)}catch(e){el.textContent='Ошибка: '+e.message}}document.getElementById('check').onclick=check;document.getElementById('go').onclick=async()=>{const out=document.getElementById('out');out.textContent='Настраиваем...';try{const r=await fetch('/telegram/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:document.getElementById('secret').value})});const d=await r.json();out.textContent=JSON.stringify(d,null,2);if(d.ok)check()}catch(e){out.textContent='Ошибка: '+e.message}}</script></body></html>`;
}
