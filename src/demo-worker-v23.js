import baseWorker, { ConsentStore, AppStore } from './demo-worker-v20.js';

export { ConsentStore, AppStore };

const KP_VERSION = '23';
const SESSION_TTL_SECONDS = 60 * 60 * 24;
const CONSENT_VERSION = '2026-09-09-v1';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/kp/health') {
      return json({ ok: true, version: KP_VERSION, time: new Date().toISOString() });
    }

    if (request.method === 'GET' && url.pathname === '/kp') {
      const target = new URL(request.url);
      target.pathname = '/kp-v23';
      target.searchParams.set('build', KP_VERSION);
      return Response.redirect(target.toString(), 302);
    }

    if (request.method === 'GET' && (url.pathname === '/kp-v23' || url.pathname === '/kp-v23/')) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/kp/index.html';
      assetUrl.search = '';
      const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
      return noStore(response, 'text/html; charset=UTF-8');
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET
        && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      let update;
      try { update = await request.clone().json(); }
      catch { return new Response('Bad Request', { status: 400 }); }

      const message = update?.message || update?.edited_message;
      const query = update?.callback_query;
      const text = String(message?.text || '').trim().toLowerCase();
      const userId = Number(message?.from?.id || query?.from?.id || 0);
      const chatId = Number(message?.chat?.id || query?.message?.chat?.id || userId || 0);

      if (text === '/kp' && userId && chatId && canUseKp(env, userId)) {
        await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: Number(message?.message_id || 0) });
        const updated = await refreshSignedMenu(env, userId, chatId, url.origin);
        if (!updated) await sendIntegratedMenu(env, userId, chatId, url.origin);
        return new Response('OK');
      }

      if ((text.startsWith('/start') || text === '/menu') && userId && chatId) {
        const response = await baseWorker.fetch(request, env, ctx);
        if (canUseKp(env, userId)) await refreshSignedMenu(env, userId, chatId, url.origin);
        return response;
      }

      if (query && /^pd:accept:/.test(String(query.data || '')) && userId && chatId) {
        const response = await baseWorker.fetch(request, env, ctx);
        if (canUseKp(env, userId)) {
          const messageId = Number(query?.message?.message_id || 0);
          if (messageId) {
            await safeTelegram(env, 'editMessageReplyMarkup', {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: await roleKeyboard(env, userId, url.origin),
            });
          } else {
            await refreshSignedMenu(env, userId, chatId, url.origin);
          }
        }
        return response;
      }
    }

    if (url.pathname.startsWith('/api/kp/')) {
      const session = request.headers.get('X-KP-Session') || url.searchParams.get('s') || '';
      const userId = await verifySession(env, session);
      if (userId) {
        const initData = await makeSignedInitData(env, userId);
        const headers = new Headers(request.headers);
        headers.set('X-Telegram-Init-Data', initData);
        headers.delete('X-KP-Session');
        return baseWorker.fetch(new Request(request, { headers }), env, ctx);
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function refreshSignedMenu(env, userId, chatId, origin) {
  const consent = await getConsent(env, userId);
  if (!(consent?.status === 'accepted' && consent?.version === CONSENT_VERSION)) return false;
  const menuId = await getMenuIdWithRetry(env, userId);
  if (!menuId) return false;
  const result = await safeTelegram(env, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: menuId,
    reply_markup: await roleKeyboard(env, userId, origin),
  });
  return Boolean(result);
}

async function sendIntegratedMenu(env, userId, chatId, origin) {
  await safeTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: '<b>HOUSE CLEANING</b>\n\nМеню администратора.',
    parse_mode: 'HTML',
    reply_markup: await roleKeyboard(env, userId, origin),
  });
}

async function roleKeyboard(env, userId, origin) {
  const rows = [[{ text: 'Открыть HOUSE CLEANING', web_app: { url: `${origin}/?demo=1` }, style: 'success' }]];

  if (isFullAdmin(env, userId)) {
    rows.push([{ text: 'Панель администратора', web_app: { url: `${origin}/?demo=1&admin=1` }, style: 'primary' }]);
  }

  if (canUseKp(env, userId)) {
    const session = await createSession(env, userId);
    rows.push([{
      text: 'Коммерческие предложения',
      web_app: { url: `${origin}/kp-v23?s=${encodeURIComponent(session)}&build=${KP_VERSION}` },
      style: 'success',
    }]);
  }

  return { inline_keyboard: rows };
}

function parseIds(values) {
  return [...new Set(values.filter(Boolean).join(',').split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}
function fullAdminIds(env) { return parseIds([env.MAIN_ADMIN_TELEGRAM_ID, env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]); }
function kpAdminIds(env) { return parseIds([env.KP_ADMIN_TELEGRAM_IDS, env.KP_ADMIN_TELEGRAM_ID]); }
function isFullAdmin(env, id) { return fullAdminIds(env).includes(String(id)); }
function canUseKp(env, id) { return isFullAdmin(env, id) || kpAdminIds(env).includes(String(id)); }

async function getConsent(env, userId) {
  if (!env.CONSENT_STORE || !userId) return null;
  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const stub = env.CONSENT_STORE.get(id);
    const response = await stub.fetch('https://consent.internal/record');
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  const id = env.APP_STORE.idFromName('house-cleaning-app-v1');
  return env.APP_STORE.get(id);
}

async function getMenuId(env, userId) {
  const stub = appStub(env);
  if (!stub) return 0;
  try {
    const response = await stub.fetch(`https://app.internal/menu?user=${encodeURIComponent(userId)}`);
    if (!response.ok) return 0;
    const data = await response.json();
    return Number(data?.message_id || 0);
  } catch { return 0; }
}

async function getMenuIdWithRetry(env, userId) {
  for (let i = 0; i < 5; i += 1) {
    const id = await getMenuId(env, userId);
    if (id) return id;
    if (i < 4) await new Promise((resolve) => setTimeout(resolve, 120 + i * 80));
  }
  return 0;
}

async function createSession(env, userId) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const body = `${userId}.${exp}`;
  const sig = await hmacHex(token, body);
  return `${body}.${sig}`;
}

async function verifySession(env, token) {
  const match = String(token || '').match(/^(-?\d+)\.(\d+)\.([a-f0-9]{64})$/i);
  if (!match) return 0;
  const userId = Number(match[1]);
  const exp = Number(match[2]);
  if (!userId || !exp || exp < Math.floor(Date.now() / 1000) || !canUseKp(env, userId)) return 0;
  const botToken = String(env.TELEGRAM_BOT_TOKEN || '');
  if (!botToken) return 0;
  const expected = await hmacHex(botToken, `${match[1]}.${match[2]}`);
  return constantEqual(expected, match[3].toLowerCase()) ? userId : 0;
}

async function makeSignedInitData(env, userId) {
  const botToken = String(env.TELEGRAM_BOT_TOKEN || '');
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: Number(userId), first_name: 'Admin' });
  const params = new URLSearchParams({ auth_date: authDate, user });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const encoder = new TextEncoder();
  const secret = await hmacBytes(encoder.encode('WebAppData'), encoder.encode(botToken));
  const digest = await hmacBytes(secret, encoder.encode(check));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  params.set('hash', hash);
  return params.toString();
}

async function hmacHex(secret, text) {
  const encoder = new TextEncoder();
  const digest = await hmacBytes(encoder.encode(secret), encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function hmacBytes(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, dataBytes);
}
function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function safeTelegram(env, method, payload) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json();
    return data?.ok ? data.result : null;
  } catch { return null; }
}

function noStore(response, contentType = '') {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  if (contentType) headers.set('content-type', contentType);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store, no-cache, must-revalidate, max-age=0' },
  });
}
