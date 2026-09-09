import baseWorker, { ConsentStore } from './demo-worker-v6.js';

export { ConsentStore };

const CONSENT_VERSION = '2026-09-09-v1';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      let update;
      try { update = await request.clone().json(); }
      catch { return new Response('Bad Request', { status: 400 }); }

      const message = update?.message || update?.edited_message;
      const text = String(message?.text || '').trim().toLowerCase();

      if (text.startsWith('/start')) {
        const userId = Number(message?.from?.id || 0);
        const consent = userId ? await getConsent(env, userId) : null;

        if (consent?.status === 'accepted' && consent?.version === CONSENT_VERSION) {
          await sendMainMenu(message, env, url.origin);
          return new Response('OK');
        }

        if (consent?.status === 'declined' && consent?.version === CONSENT_VERSION) {
          await sendBlocked(message?.chat?.id, env);
          return new Response('OK');
        }

        return baseWorker.fetch(request, env, ctx);
      }

      const query = update?.callback_query;
      const match = /^pd:(accept|decline):(.+)$/.exec(String(query?.data || ''));
      if (query && match && match[2] === CONSENT_VERSION) {
        await baseWorker.fetch(request, env, ctx);

        if (query.message?.chat?.id && query.message?.message_id) {
          if (match[1] === 'accept') {
            await editMainMenu(query, env, url.origin);
          } else {
            await editBlocked(query, env);
          }
        }
        return new Response('OK');
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function getConsent(env, userId) {
  if (!env.CONSENT_STORE || !userId) return null;
  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const stub = env.CONSENT_STORE.get(id);
    const response = await stub.fetch('https://consent.internal/record');
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function sendMainMenu(message, env, origin) {
  if (!message?.chat?.id || !message?.from?.id) return;
  await telegram(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: mainText(message.from),
    parse_mode: 'HTML',
    reply_markup: mainKeyboard(env, message.from.id, origin),
  });
}

async function editMainMenu(query, env, origin) {
  await telegram(env, 'editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: mainText(query.from),
    parse_mode: 'HTML',
    reply_markup: mainKeyboard(env, query.from.id, origin),
  });
}

function mainText(user) {
  return [
    '<b>HOUSE CLEANING</b>',
    '',
    `Здравствуйте, ${escapeHtml(user?.first_name || 'клиент')}.`,
    '',
    'Профессиональная уборка квартиры, дома или офиса — прямо в Telegram.',
    '',
    'Выберите вид уборки, укажите площадь, добавьте фото объекта и выберите удобные дату и время.',
    '',
    'После отправки заявки бот сообщит о её подтверждении, завершении или отмене.',
    '',
    'Нажмите кнопку ниже, чтобы открыть HOUSE CLEANING.',
  ].join('\n');
}

function mainKeyboard(env, userId, origin) {
  const rows = [[{ text: 'Открыть HOUSE CLEANING', web_app: { url: `${origin}/?demo=1` }, style: 'success' }]];
  if (isAdmin(env, userId)) {
    rows.push([{ text: 'Панель администратора', web_app: { url: `${origin}/?demo=1&admin=1` }, style: 'primary' }]);
  }
  return { inline_keyboard: rows };
}

async function sendBlocked(chatId, env) {
  if (!chatId) return;
  await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: blockedText(),
    parse_mode: 'HTML',
    reply_markup: contactKeyboard(env),
  });
}

async function editBlocked(query, env) {
  await telegram(env, 'editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: blockedText(),
    parse_mode: 'HTML',
    reply_markup: contactKeyboard(env),
  });
}

function blockedText() {
  return '<b>HOUSE CLEANING</b>\n\n<b>Доступ к боту ограничен</b>\n\nВы не предоставили согласие на обработку персональных данных, поэтому оформление и управление заявками через бота недоступно.\n\nЕсли у вас есть вопросы или вы хотите оформить заказ другим способом, напишите администратору.';
}

function contactKeyboard(env) {
  const adminId = adminIds(env)[0];
  return adminId ? { inline_keyboard: [[{ text: 'Написать администратору', url: `tg://user?id=${adminId}` }]] } : { inline_keyboard: [] };
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v)))];
}

function isAdmin(env, id) { return adminIds(env).includes(String(id)); }

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}
