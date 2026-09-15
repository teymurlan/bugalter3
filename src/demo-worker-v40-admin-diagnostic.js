import baseWorker, { ConsentStore, AppStore } from './demo-worker-v39-admin-menu.js';

export { ConsentStore, AppStore };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      let update = null;
      try { update = await request.clone().json(); } catch {}

      const message = update?.message || update?.edited_message;
      const chatId = positiveInt(message?.chat?.id);
      const userId = positiveInt(message?.from?.id);
      const command = commandName(message?.text);

      if (chatId && userId && command === '/admin') {
        const adminConfigured = hasAdminConfig(env);
        const adminMatch = isAdminId(env, userId);
        console.log('HC_ADMIN_DIAGNOSTIC', JSON.stringify({ userId, adminConfigured, adminMatch }));

        if (adminMatch) {
          await exposeAdminPanel(env, chatId, url.origin);
        } else {
          await telegramSafe(env, 'sendMessage', {
            chat_id: chatId,
            text: [
              '<b>HOUSE CLEANING · Доступ администратора</b>',
              '',
              'Команда <code>/admin</code> дошла до рабочего Worker.',
              '',
              adminConfigured
                ? 'Этот Telegram ID пока не найден среди администраторов.'
                : 'В Cloudflare не найден администратор.',
              '',
              `Ваш Telegram ID: <code>${userId}</code>`,
              '',
              'Разрешённые переменные: <code>ADMIN_TELEGRAM_ID</code>, <code>ADMIN_TELEGRAM_IDS</code>, <code>ADMIN_ID</code>, а также существующие <code>KP_ADMIN_TELEGRAM_ID</code> / <code>KP_ADMIN_TELEGRAM_IDS</code>.',
            ].join('\n'),
            parse_mode: 'HTML',
          });
        }
        return json({ ok: true, adminMatch });
      }

      if (chatId && userId && ['/start', '/menu'].includes(command) && isAdminId(env, userId)) {
        const response = await baseWorker.fetch(request, env, ctx);
        const setup = exposeAdminPanel(env, chatId, url.origin);
        if (ctx?.waitUntil) ctx.waitUntil(setup);
        else await setup;
        return response;
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

function adminValues(env) {
  return [
    env.ADMIN_TELEGRAM_IDS,
    env.ADMIN_TELEGRAM_ID,
    env.ADMIN_ID,
    env.KP_ADMIN_TELEGRAM_IDS,
    env.KP_ADMIN_TELEGRAM_ID,
  ]
    .filter(Boolean)
    .join(',')
    .split(/[;,\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));
}

function hasAdminConfig(env) { return adminValues(env).length > 0; }
function isAdminId(env, userId) { return adminValues(env).includes(String(userId)); }

async function exposeAdminPanel(env, chatId, origin) {
  const adminUrl = `${origin}/?demo=1&admin=1`;
  await Promise.allSettled([
    telegramSafe(env, 'setChatMenuButton', {
      chat_id: chatId,
      menu_button: {
        type: 'web_app',
        text: 'Админ-панель',
        web_app: { url: adminUrl },
      },
    }),
    telegramSafe(env, 'sendMessage', {
      chat_id: chatId,
      text: '<b>HOUSE CLEANING · Администратор</b>\n\nСотрудники, заявки, назначения и обучение команды.',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '⚙️ Открыть админ-панель',
          web_app: { url: adminUrl },
          style: 'primary',
        }]],
      },
    }),
  ]);
}

function commandName(value) {
  const first = String(value || '').trim().split(/\s+/, 1)[0].toLowerCase();
  return first.split('@', 1)[0];
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

async function telegramSafe(env, method, payload) {
  try { return await telegram(env, method, payload); }
  catch (error) { console.error(`Telegram ${method} failed`, error); return null; }
}

async function telegram(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Bot token missing');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
