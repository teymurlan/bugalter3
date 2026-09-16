import baseWorker, { ConsentStore, AppStore } from './demo-worker-v43-cache-bust.js';

export { ConsentStore, AppStore };

const RELEASE = '44';
const CONSENT_VERSION = '2026-09-09-v1';
const APP_STORE_NAME = 'house-cleaning-app-v1';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/release-version') {
      return json({ ok: true, release: RELEASE, worker: 'demo-worker-v44-production' });
    }

    if (isKpPath(url.pathname)) {
      if (request.method === 'GET' && (url.pathname === '/kp' || url.pathname === '/kp/')) {
        const target = new URL('/', url.origin);
        target.searchParams.set('demo', '1');
        target.searchParams.set('release', RELEASE);
        return new Response(null, {
          status: 302,
          headers: {
            location: target.toString(),
            'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
            'x-house-cleaning-release': RELEASE,
          },
        });
      }
      return json({ ok: false, error: 'Раздел КП отключён' }, 404);
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      let update = null;
      try { update = await request.clone().json(); } catch {}

      const message = update?.message || update?.edited_message;
      const command = commandName(message?.text);
      const chatId = positiveInt(message?.chat?.id);
      const userId = positiveInt(message?.from?.id || update?.callback_query?.from?.id);

      // KP is intentionally removed from the production bot. Intercept the old
      // command before legacy workers in the chain can recreate its button.
      if (command === '/kp') {
        if (chatId && message?.message_id) {
          await telegramSafe(env, 'deleteMessage', {
            chat_id: chatId,
            message_id: Number(message.message_id),
          });
        }
        return json({ ok: true, kp_disabled: true });
      }

      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok || !update || !userId) return withRelease(response);

      const callbackData = String(update?.callback_query?.data || '');
      const accepted = callbackData === `pd:accept:${CONSENT_VERSION}`;
      if (command === '/start' || command === '/menu' || accepted) {
        await forceCleanTelegramMenu(env, userId, url.origin, { forceAccepted: accepted });
      }
      return withRelease(response);
    }

    const response = await baseWorker.fetch(request, env, ctx);
    return withRelease(response);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

function isKpPath(pathname) {
  return pathname === '/kp' || pathname.startsWith('/kp/') || pathname === '/api/kp' || pathname.startsWith('/api/kp/');
}

async function forceCleanTelegramMenu(env, userId, origin, { forceAccepted = false } = {}) {
  const consent = forceAccepted ? { status: 'accepted', version: CONSENT_VERSION } : await getConsent(env, userId);
  if (!(consent?.status === 'accepted' && consent?.version === CONSENT_VERSION)) return;

  const keyboard = roleKeyboard(env, userId, origin);
  const menuId = await getMenuId(env, userId);
  const clientUrl = `${origin}/?demo=1&release=${RELEASE}`;

  const tasks = [
    telegramSafe(env, 'setChatMenuButton', {
      chat_id: userId,
      menu_button: {
        type: 'web_app',
        text: 'HOUSE CLEANING',
        web_app: { url: clientUrl },
      },
    }),
  ];

  if (menuId) {
    tasks.push(telegramSafe(env, 'editMessageReplyMarkup', {
      chat_id: userId,
      message_id: menuId,
      reply_markup: keyboard,
    }));
  }

  await Promise.allSettled(tasks);
}

function roleKeyboard(env, userId, origin) {
  const rows = [[{
    text: 'Открыть HOUSE CLEANING',
    web_app: { url: `${origin}/?demo=1&release=${RELEASE}` },
    style: 'primary',
  }]];

  if (isFullAdmin(env, userId)) {
    rows.push([{
      text: 'Панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1&release=${RELEASE}` },
      style: 'danger',
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
    const id = env.APP_STORE.idFromName(APP_STORE_NAME);
    const response = await env.APP_STORE.get(id).fetch(`https://app.internal/menu?user=${encodeURIComponent(userId)}`);
    if (!response.ok) return 0;
    return Number((await response.json())?.message_id || 0);
  } catch { return 0; }
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}
function isFullAdmin(env, id) { return adminIds(env).includes(String(id)); }
function commandName(value) {
  const first = String(value || '').trim().split(/\s+/, 1)[0].toLowerCase();
  return first.split('@', 1)[0];
}
function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function withRelease(response) {
  const headers = new Headers(response.headers);
  headers.set('x-house-cleaning-release', RELEASE);
  if ((headers.get('content-type') || '').includes('text/html')) {
    headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
    headers.set('pragma', 'no-cache');
    headers.set('expires', '0');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'x-house-cleaning-release': RELEASE,
    },
  });
}
