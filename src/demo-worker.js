export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, mode: 'demo-bot', hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN) });
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

        await telegram(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
          chat_id: chatId,
          text,
          reply_markup: {
            inline_keyboard: [[
              { text: 'Открыть HOUSE CLEANING', web_app: { url: appUrl } },
            ]],
          },
        });
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
      const result = await telegram(env.TELEGRAM_BOT_TOKEN, 'setWebhook', {
        url: webhookUrl,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'edited_message'],
      });

      return json({ ok: true, webhookUrl, telegram: result });
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
  return data;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}

function setupPage(origin) {
  return `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HOUSE CLEANING Bot Setup</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#05090c;color:#f6f7f8;max-width:560px;margin:0 auto;padding:32px 20px}h1{font-size:28px}.card{background:#101820;border:1px solid #26313a;border-radius:20px;padding:20px}.muted{color:#8d98a8;line-height:1.5}input,button{width:100%;box-sizing:border-box;border-radius:14px;padding:14px 16px;font-size:16px}input{background:#071016;color:white;border:1px solid #33404a;margin:12px 0}button{background:#f7bb38;color:#0b0d0f;border:0;font-weight:800}pre{white-space:pre-wrap;color:#cbd2d9}</style></head><body><h1>Подключение Telegram</h1><div class="card"><p class="muted">Введите значение TELEGRAM_WEBHOOK_SECRET, которое вы добавили в Cloudflare. Токен бота здесь вводить не нужно.</p><input id="secret" type="password" placeholder="TELEGRAM_WEBHOOK_SECRET"><button id="go">Установить webhook</button><pre id="out"></pre></div><script>document.getElementById('go').onclick=async()=>{const out=document.getElementById('out');out.textContent='Настраиваем...';try{const r=await fetch('/telegram/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:document.getElementById('secret').value})});const d=await r.json();out.textContent=d.ok?'Готово. Webhook: '+d.webhookUrl:(d.error||'Ошибка');}catch(e){out.textContent='Ошибка: '+e.message}}</script></body></html>`;
}
