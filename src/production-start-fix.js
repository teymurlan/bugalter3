import baseWorker, { ConsentStore, AppStore } from './production-public-order.js';
import runtimeWorker from './demo-worker-v53-client-experience.js';

export { ConsentStore, AppStore };

const CONSENT_VERSION = '2026-09-09-v1';
const OPERATOR = 'ИП Царегородцева Евгения Андреевна';
const CLIENT_RELEASE = '68';
const APP_STORE_NAME = 'house-cleaning-app-v1';
const PRELAUNCH_PROTOCOL = 'locked-v2';
const PRELAUNCH_OWNER = 'production-runtime-v68';
let prelaunchNeutralized = false;
let prelaunchNeutralizePromise = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      const expectedSecret = String(env.TELEGRAM_WEBHOOK_SECRET || '').trim();
      if (expectedSecret && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== expectedSecret) {
        return new Response('Unauthorized', { status: 401 });
      }

      let update = null;
      try { update = await request.clone().json(); } catch {}
      const message = update?.message || update?.edited_message;
      const command = commandName(message?.text);

      if (message && (command === '/start' || command === '/menu')) {
        await handleStartOrMenu(message, env, url.origin);
        return new Response('OK');
      }
    }

    const guarded = url.pathname.startsWith('/api/') || url.pathname === '/telegram/webhook';
    const statusRoute = request.method === 'GET' && url.pathname === '/api/prelaunch-v66-status';
    if (guarded && !statusRoute) {
      const safe = await neutralizePrelaunchReset(env);
      if (!safe) {
        const fallback = request.clone();
        const response = await runtimeWorker.fetch(fallback, env, ctx);
        return withRuntimeHeader(response);
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function neutralizePrelaunchReset(env) {
  if (prelaunchNeutralized) return true;
  if (prelaunchNeutralizePromise) return prelaunchNeutralizePromise;

  prelaunchNeutralizePromise = (async () => {
    const stub = appStub(env);
    if (!stub) return false;

    try {
      const statusResponse = await stub.fetch('https://app.internal/system/prelaunch-reset-v66/status');
      const statusData = statusResponse.ok ? await statusResponse.json().catch(() => ({})) : {};
      const marker = statusData?.marker || null;
      if (marker?.status === 'complete' && marker?.protocol === PRELAUNCH_PROTOCOL) {
        prelaunchNeutralized = true;
        return true;
      }

      const claimResponse = await stub.fetch('https://app.internal/system/prelaunch-reset-v66/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: PRELAUNCH_OWNER }),
      });
      if (!claimResponse.ok) return false;
      const claim = await claimResponse.json().catch(() => ({}));
      if (claim?.complete) {
        prelaunchNeutralized = true;
        return true;
      }
      if (!claim?.claimed) return false;

      // Release 66 cleanup must never delete live production data anymore.
      // Mark the old one-time protocol complete without running its destructive storage/D1 cleanup.
      const finishResponse = await stub.fetch('https://app.internal/system/prelaunch-reset-v66/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner: PRELAUNCH_OWNER,
          d1_orders_deleted: 0,
          d1_drafts_deleted: 0,
          d1_profiles_reset: 0,
        }),
      });
      if (!finishResponse.ok) return false;
      const finished = await finishResponse.json().catch(() => ({}));
      const complete = finished?.marker?.status === 'complete';
      if (complete) prelaunchNeutralized = true;
      return complete;
    } catch (error) {
      console.warn('Prelaunch v66 neutralization deferred', error?.message || error);
      return false;
    }
  })().finally(() => {
    prelaunchNeutralizePromise = null;
  });

  return prelaunchNeutralizePromise;
}

function withRuntimeHeader(response) {
  const headers = new Headers(response.headers);
  headers.set('X-HC-Runtime-Fallback', 'v68');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleStartOrMenu(message, env, origin) {
  const chatId = positiveInt(message?.chat?.id);
  const userId = positiveInt(message?.from?.id);
  if (!chatId || !userId) return;

  await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: Number(message?.message_id || 0) });

  const previous = await getMenuId(env, userId);
  if (previous) await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: previous });

  const consent = await getConsent(env, userId);
  let text = consentText(message?.from);
  let replyMarkup = consentKeyboard(origin);

  if (consent?.status === 'accepted' && consent?.version === CONSENT_VERSION) {
    text = mainText(message?.from);
    replyMarkup = roleKeyboard(env, userId, origin);
  } else if (consent?.status === 'declined' && consent?.version === CONSENT_VERSION) {
    text = blockedText();
    replyMarkup = contactKeyboard(env);
  }

  const sent = await safeTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });

  if (sent?.message_id) await saveMenuId(env, userId, sent.message_id);
}

function commandName(value) {
  const first = String(value || '').trim().split(/\s+/, 1)[0].toLowerCase();
  return first.split('@', 1)[0];
}

function consentText(user) {
  return [
    '🏠 <b>HOUSE CLEANING</b>',
    '',
    `Здравствуйте, ${escapeHtml(user?.first_name || 'клиент')}.`,
    '',
    'Для оформления уборки нужно подтвердить согласие на обработку персональных данных.',
    '',
    `Оператор: <b>${OPERATOR}</b>`,
  ].join('\n');
}

function mainText(user) {
  return [
    '🏠 <b>HOUSE CLEANING</b>',
    '',
    `Здравствуйте, ${escapeHtml(user?.first_name || 'клиент')}!`,
    '',
    'Запись на уборку, заявки и управление сервисом — в одном месте.',
  ].join('\n');
}

function blockedText() {
  return [
    '🏠 <b>HOUSE CLEANING</b>',
    '',
    '<b>Доступ к записи ограничен</b>',
    '',
    'Вы не предоставили согласие на обработку персональных данных.',
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
    web_app: { url: `${origin}/?demo=1&release=${CLIENT_RELEASE}` },
    style: 'primary',
  }]];

  if (isFullAdmin(env, userId)) {
    rows.push([{
      text: 'Панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1&release=${CLIENT_RELEASE}` },
      style: 'danger',
    }]);
  }

  return { inline_keyboard: rows };
}

function contactKeyboard(env) {
  const adminId = fullAdminIds(env)[0];
  return {
    inline_keyboard: adminId ? [[{ text: 'Написать администратору', url: `tg://user?id=${adminId}` }]] : [],
  };
}

async function getConsent(env, userId) {
  if (!env.CONSENT_STORE || !userId) return null;
  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const response = await env.CONSENT_STORE.get(id).fetch('https://consent.internal/record');
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function getMenuId(env, userId) {
  const stub = appStub(env);
  if (!stub) return 0;
  try {
    const response = await stub.fetch(`https://app.internal/menu?user=${encodeURIComponent(userId)}`);
    if (!response.ok) return 0;
    return Number((await response.json())?.message_id || 0);
  } catch { return 0; }
}

async function saveMenuId(env, userId, messageId) {
  const stub = appStub(env);
  if (!stub) return;
  try {
    await stub.fetch('https://app.internal/menu', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: String(userId), message_id: Number(messageId) }),
    });
  } catch {}
}

function parseIds(values) {
  return [...new Set(values.filter(Boolean).join(',').split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}
function fullAdminIds(env) { return parseIds([env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]); }
function isFullAdmin(env, id) { return fullAdminIds(env).includes(String(id)); }
function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] || char));
}

async function safeTelegram(env, method, payload) {
  try { return await telegram(env, method, payload); }
  catch (error) { console.error(`Telegram ${method} failed`, error?.message || error); return null; }
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
