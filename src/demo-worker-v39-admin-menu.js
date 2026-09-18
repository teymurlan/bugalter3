import baseWorker, { ConsentStore, AppStore } from './demo-worker-v38-staff.js';

export { ConsentStore, AppStore };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/telegram/webhook' && request.method === 'POST' && webhookSecretValid(request, env)) {
      let update = null;
      try { update = await request.clone().json(); } catch {}

      const message = update?.message;
      const chatId = positiveInt(message?.chat?.id);
      const userId = positiveInt(message?.from?.id);
      const command = commandName(message?.text);

      if (chatId && userId && isAdminId(env, userId) && command === '/admin') {
        await exposeAdminPanel(env, chatId, url.origin);
        return json({ ok: true });
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function exposeAdminPanel(env, chatId, origin) {
  const adminUrl = `${origin}/?admin=1`;

  await Promise.allSettled([
    telegram(env, 'setChatMenuButton', {
      chat_id: chatId,
      menu_button: {
        type: 'web_app',
        text: 'Админ-панель',
        web_app: { url: adminUrl },
      },
    }),
    telegram(env, 'sendMessage', {
      chat_id: chatId,
      text: '<b>HOUSE CLEANING · Администратор</b>\n\nОткрывайте здесь сотрудников, заявки, назначения и обучение команды.',
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

function isAdminId(env, userId) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return String(raw)
    .split(/[;,\s]+/)
    .map((value) => Number(value))
    .some((value) => Number.isInteger(value) && value === Number(userId));
}

function webhookSecretValid(request, env) {
  const expected = String(env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!expected) return false;
  const actual = String(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '');
  return actual === expected;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
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
