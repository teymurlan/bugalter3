import baseWorker, { ConsentStore, AppStore } from './demo-worker-v21-admin-assistant.js';

export { ConsentStore, AppStore };

const CONSENT_VERSION = '2026-09-09-v1';
const OPERATOR = 'ИП Царегородцева Евгения Андреевна';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/telegram/webhook' || request.method !== 'POST') {
      return baseWorker.fetch(request, env, ctx);
    }

    let update = null;
    try { update = await request.clone().json(); } catch {}
    const response = await baseWorker.fetch(request, env, ctx);
    if (!response.ok || !update) return response;

    const message = update?.message || update?.edited_message;
    const text = String(message?.text || '').trim().toLowerCase();
    const userId = Number(message?.from?.id || update?.callback_query?.from?.id || 0);

    if (userId && (text.startsWith('/start') || text === '/menu')) {
      await refreshMenuAfterCommand(env, userId, url.origin);
    }

    const query = update?.callback_query;
    const consentMatch = /^pd:(accept|decline):(.+)$/.exec(String(query?.data || ''));
    if (query && consentMatch && consentMatch[2] === CONSENT_VERSION && consentMatch[1] === 'accept') {
      const chatId = Number(query?.message?.chat?.id || 0);
      const messageId = Number(query?.message?.message_id || 0);
      const queryUserId = Number(query?.from?.id || 0);
      if (chatId && messageId && queryUserId) {
        await safeTelegram(env, 'editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: mainText(),
          parse_mode: 'HTML',
          reply_markup: roleKeyboard(env, queryUserId, url.origin),
        });
      }
    }

    return response;
  },
};

async function refreshMenuAfterCommand(env, userId, origin) {
  const consent = await getConsent(env, userId);
  const menuId = await getMenuId(env, userId);
  if (!menuId) return;

  if (consent?.status === 'accepted' && consent?.version === CONSENT_VERSION) {
    await safeTelegram(env, 'editMessageText', {
      chat_id: userId,
      message_id: menuId,
      text: mainText(),
      parse_mode: 'HTML',
      reply_markup: roleKeyboard(env, userId, origin),
    });
    return;
  }

  if (!consent || consent?.version !== CONSENT_VERSION) {
    await safeTelegram(env, 'editMessageText', {
      chat_id: userId,
      message_id: menuId,
      text: consentText(),
      parse_mode: 'HTML',
      reply_markup: consentKeyboard(origin),
    });
  }
}

function consentText() {
  return [
    '🏠 <b>HOUSE CLEANING</b>',
    '',
    'Чистота начинается с хорошего сервиса ✨',
    '',
    'Оформляйте уборку, выбирайте удобное время и отправляйте фото объекта прямо в Telegram.',
    '',
    '🔐 Перед началом нужно подтвердить согласие на обработку персональных данных.',
    '',
    'Для оформления заявки используются данные Telegram, имя, номер телефона, адрес и фотографии объекта.',
    '',
    `Оператор: <b>${OPERATOR}</b>`,
    '',
    'Подробные условия доступны в политике обработки персональных данных.',
  ].join('\n');
}

function mainText() {
  return [
    '🏠 <b>HOUSE CLEANING</b>',
    '',
    'Управляйте уборкой прямо в Telegram.',
    '',
    'Запись, статус заявки, история заказов, скидки и помощь менеджера — всё в одном месте.',
    '',
    '✨ Быстро, удобно и без лишних звонков.',
    '',
    'Выберите нужный раздел ниже.',
  ].join('\n');
}

function consentKeyboard(origin) {
  return {
    inline_keyboard: [
      [{ text: 'Согласен и продолжить', callback_data: `pd:accept:${CONSENT_VERSION}`, style: 'primary' }],
      [{ text: 'Политика обработки персональных данных', url: `${origin}/privacy` }],
      [{ text: 'Не согласен', callback_data: `pd:decline:${CONSENT_VERSION}` }],
    ],
  };
}

function roleKeyboard(env, userId, origin) {
  const rows = [[{
    text: 'Открыть HOUSE CLEANING',
    web_app: { url: `${origin}/?demo=1` },
    style: 'primary',
  }]];

  if (isFullAdmin(env, userId)) {
    rows.push([{
      text: 'Панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1` },
      style: 'danger',
    }]);
  }

  if (canUseKp(env, userId)) {
    rows.push([{
      text: 'Коммерческие предложения',
      web_app: { url: `${origin}/kp` },
      style: 'success',
    }]);
  }

  return { inline_keyboard: rows };
}

async function getConsent(env, userId) {
  if (!env.CONSENT_STORE || !userId) return null;
  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const response = await env.CONSENT_STORE.get(id).fetch('https://consent.internal/record');
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function getMenuId(env, userId) {
  if (!env.APP_STORE || !userId) return 0;
  try {
    const id = env.APP_STORE.idFromName('house-cleaning-app-v1');
    const response = await env.APP_STORE.get(id).fetch(`https://app.internal/menu?user=${encodeURIComponent(userId)}`);
    if (!response.ok) return 0;
    return Number((await response.json())?.message_id || 0);
  } catch { return 0; }
}

function parseIds(values) {
  return [...new Set(values.filter(Boolean).join(',').split(/[;,\s]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v)))];
}
function fullAdminIds(env) { return parseIds([env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]); }
function kpAdminIds(env) { return parseIds([env.KP_ADMIN_TELEGRAM_IDS, env.KP_ADMIN_TELEGRAM_ID]); }
function isFullAdmin(env, id) { return fullAdminIds(env).includes(String(id)); }
function canUseKp(env, id) { return isFullAdmin(env, id) || kpAdminIds(env).includes(String(id)); }

async function safeTelegram(env, method, payload) {
  try { return await telegram(env, method, payload); }
  catch (error) { console.error(`Telegram ${method} failed`, error); return null; }
}
async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}
