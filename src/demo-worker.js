export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        ok: true,
        mode: 'demo-bot',
        hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
        hasWebhookSecret: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
      });
    }

    if (url.pathname === '/telegram/status' && request.method === 'GET') {
      const base = {
        ok: true,
        hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
        hasWebhookSecret: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
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
          bot: {
            id: me.id,
            username: me.username,
            first_name: me.first_name,
          },
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

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN) return new Response('Bot token is not configured', { status: 500 });

      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const incomingSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
        if (incomingSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
          return new Response('Unauthorized', { status: 401 });
        }
      }

      let update;
      try {
        update = await request.json();
      } catch {
        return new Response('Bad Request', { status: 400 });
      }

      const message = update?.message || update?.edited_message;
      const chatId = message?.chat?.id;
      if (chatId) {
        const firstName = message?.from?.first_name || 'клиент';
        const appUrl = `${url.origin}/?demo=1`;
        const text = `Здравствуйте, ${firstName}.\n\nHOUSE CLEANING — запись на уборку. Нажмите кнопку ниже, чтобы открыть приложение.`;

        try {
          await telegram(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
            chat_id: chatId,
            text,
            reply_markup: {
              inline_keyboard: [[
                { text: 'Открыть HOUSE CLEANING', web_app: { url: appUrl } },
              ]],
            },
          });
        } catch (error) {
          console.error('Telegram sendMessage failed', error);
          return new Response('Telegram sendMessage failed', { status: 500 });
        }
      }

      return new Response('OK');
    }

    if (url.pathname === '/telegram/setup' && request.method === 'GET') {
      return new Response(setupPage(url.origin), {
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      });
    }

    if (url.pathname === '/telegram/setup' && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
        return json({ ok: false, error: 'Сначала добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET в Cloudflare' }, 400);
      }

      let body = {};
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректный запрос' }, 400); }
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

function setupPage(origin) {
  return `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HOUSE CLEANING Bot Setup</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#05090c;color:#f6f7f8;max-width:560px;margin:0 auto;padding:32px 20px}h1{font-size:28px}.card{background:#101820;border:1px solid #26313a;border-radius:20px;padding:20px;margin-bottom:14px}.muted{color:#8d98a8;line-height:1.5}input,button{width:100%;box-sizing:border-box;border-radius:14px;padding:14px 16px;font-size:16px}input{background:#071016;color:white;border:1px solid #33404a;margin:12px 0}button{background:#f7bb38;color:#0b0d0f;border:0;font-weight:800}button.secondary{background:#202b33;color:#f6f7f8;margin-top:10px}pre{white-space:pre-wrap;word-break:break-word;color:#cbd2d9;background:#071016;border-radius:12px;padding:12px;font-size:13px}</style></head><body><h1>Подключение Telegram</h1><div class="card"><p class="muted">Сначала проверьте состояние бота. Здесь не показывается токен.</p><button class="secondary" id="check">Проверить состояние</button><pre id="status">Нажмите «Проверить состояние»</pre></div><div class="card"><p class="muted">Введите значение TELEGRAM_WEBHOOK_SECRET, которое добавлено в Cloudflare. Токен бота здесь вводить не нужно.</p><input id="secret" type="password" placeholder="TELEGRAM_WEBHOOK_SECRET"><button id="go">Установить webhook</button><pre id="out"></pre></div><script>async function check(){const el=document.getElementById('status');el.textContent='Проверяем...';try{const r=await fetch('/telegram/status');const d=await r.json();el.textContent=JSON.stringify(d,null,2)}catch(e){el.textContent='Ошибка: '+e.message}}document.getElementById('check').onclick=check;document.getElementById('go').onclick=async()=>{const out=document.getElementById('out');out.textContent='Настраиваем...';try{const r=await fetch('/telegram/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:document.getElementById('secret').value})});const d=await r.json();out.textContent=JSON.stringify(d,null,2);if(d.ok)check()}catch(e){out.textContent='Ошибка: '+e.message}}</script></body></html>`;
}
