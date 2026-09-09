import baseWorker from './demo-worker-v5.js';

const CONSENT_VERSION = '2026-09-09-v1';
const OPERATOR = 'ИП Царегородцева Евгения Андреевна';

export class ConsentStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.method === 'GET') {
      const record = await this.state.storage.get('consent');
      return json(record || null);
    }

    if (request.method === 'PUT') {
      let record;
      try { record = await request.json(); }
      catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
      await this.state.storage.put('consent', record);
      return json({ ok: true });
    }

    return new Response('Method Not Allowed', { status: 405 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET
        && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
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

        return baseWorker.fetch(request, env, ctx);
      }

      if (text === '/revoke') {
        if (message?.from?.id) await saveConsent(env, message.from, 'revoked');
        return baseWorker.fetch(request, env, ctx);
      }

      const query = update?.callback_query;
      const match = /^pd:(accept|decline):(.+)$/.exec(String(query?.data || ''));

      if (query && match) {
        const action = match[1];
        const version = match[2];

        if (version !== CONSENT_VERSION) {
          return baseWorker.fetch(request, env, ctx);
        }

        if (action === 'decline') {
          await saveConsent(env, query.from, 'declined');
          return baseWorker.fetch(request, env, ctx);
        }

        await saveConsent(env, query.from, 'accepted');
        await logConsentToAdmins(env, query.from, url.origin);
        await safeTelegram(env, 'answerCallbackQuery', {
          callback_query_id: query.id,
          text: 'Согласие сохранено',
        });

        if (query.message?.chat?.id && query.message?.message_id) {
          await safeTelegram(env, 'editMessageText', {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            text: mainMenuText(query.from),
            parse_mode: 'HTML',
            reply_markup: mainKeyboard(env, query.from.id, url.origin),
          });
        }

        return new Response('OK');
      }
    }

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      const userId = telegramUserIdFromInitData(request.headers.get('X-Telegram-Init-Data') || '');
      if (userId) {
        const consent = await getConsent(env, userId);
        if (!(consent?.status === 'accepted' && consent?.version === CONSENT_VERSION)) {
          return json({
            ok: false,
            error: 'Сначала подтвердите согласие на обработку персональных данных в Telegram-боте командой /start.',
            consentRequired: true,
          }, 403);
        }
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
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Consent durable read failed', error);
    return null;
  }
}

async function saveConsent(env, user, status) {
  const userId = Number(user?.id || 0);
  if (!env.CONSENT_STORE || !userId) return false;

  const now = new Date().toISOString();
  const previous = await getConsent(env, userId);
  const record = {
    telegram_id: userId,
    username: user?.username || null,
    first_name: user?.first_name || '',
    last_name: user?.last_name || null,
    status,
    version: CONSENT_VERSION,
    accepted_at: status === 'accepted' ? now : previous?.accepted_at || null,
    revoked_at: status === 'revoked' ? now : null,
    updated_at: now,
  };

  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const stub = env.CONSENT_STORE.get(id);
    const response = await stub.fetch('https://consent.internal/record', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    });
    return response.ok;
  } catch (error) {
    console.error('Consent durable write failed', error);
    return false;
  }
}

async function sendMainMenu(message, env, origin) {
  if (!message?.chat?.id || !message?.from?.id) return;
  await safeTelegram(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: mainMenuText(message.from),
    parse_mode: 'HTML',
    reply_markup: mainKeyboard(env, message.from.id, origin),
  });
}

function mainMenuText(user) {
  const firstName = escapeHtml(user?.first_name || 'клиент');
  return [
    '<b>HOUSE CLEANING</b>',
    '',
    `Здравствуйте, ${firstName}.`,
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
  const rows = [
    [{
      text: 'Открыть HOUSE CLEANING',
      web_app: { url: `${origin}/?demo=1` },
      style: 'success',
    }],
  ];

  if (isAdmin(env, userId)) {
    rows.push([{
      text: 'Панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1` },
      style: 'primary',
    }]);
  }

  rows.push([{ text: 'Политика обработки персональных данных', url: `${origin}/privacy` }]);
  return { inline_keyboard: rows };
}

async function logConsentToAdmins(env, user, origin) {
  const ids = adminIds(env);
  if (!ids.length) return;

  const text = [
    '<b>СОГЛАСИЕ · ПЕРСОНАЛЬНЫЕ ДАННЫЕ</b>',
    '',
    `Telegram ID: <code>${escapeHtml(user?.id)}</code>`,
    `Пользователь: ${user?.username ? `@${escapeHtml(user.username)}` : escapeHtml([user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'не указан')}`,
    `Версия: <code>${CONSENT_VERSION}</code>`,
    `UTC: <code>${new Date().toISOString()}</code>`,
    `Оператор: ${OPERATOR}`,
  ].join('\n');

  await Promise.allSettled(ids.map((id) => safeTelegram(env, 'sendMessage', {
    chat_id: id,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Политика', url: `${origin}/privacy` }]] },
  })));
}

function telegramUserIdFromInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const raw = params.get('user');
    if (!raw) return 0;
    const user = JSON.parse(raw);
    const id = Number(user?.id || 0);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  } catch {
    return 0;
  }
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]
    .filter(Boolean)
    .join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

function isAdmin(env, id) {
  return adminIds(env).includes(String(id));
}

async function safeTelegram(env, method, payload) {
  try { return await telegram(env, method, payload); }
  catch (error) { console.error(`Telegram ${method} failed`, error); return null; }
}

async function telegram(env, method, payload) {
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
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] || char));
}
