import baseWorker, { ConsentStore, AppStore } from './demo-worker-v20.js';

export { ConsentStore, AppStore };

const KP_VERSION = '21';
const SESSION_TTL_SECONDS = 60 * 60 * 24;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/kp/health') {
      return json({ ok: true, version: KP_VERSION, time: new Date().toISOString() });
    }

    if (request.method === 'GET' && url.pathname === '/kp') {
      const target = new URL(request.url);
      target.pathname = '/kp-v21';
      target.searchParams.set('build', KP_VERSION);
      return Response.redirect(target.toString(), 302);
    }

    if (request.method === 'GET' && (url.pathname === '/kp-v21' || url.pathname === '/kp-v21/')) {
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

      let update = null;
      try { update = await request.clone().json(); } catch {}
      const message = update?.message || update?.edited_message;
      const text = String(message?.text || '').trim().toLowerCase();
      const userId = Number(message?.from?.id || 0);
      const chatId = Number(message?.chat?.id || 0);

      if (text === '/kp' && userId && chatId && canUseKp(env, userId)) {
        const session = await createSession(env, userId);
        const launchUrl = `${url.origin}/kp-v21?s=${encodeURIComponent(session)}&build=${KP_VERSION}`;
        await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: Number(message?.message_id || 0) });
        await safeTelegram(env, 'sendMessage', {
          chat_id: chatId,
          text: '<b>HOUSE CLEANING · Коммерческие предложения</b>\n\nОткройте генератор КП кнопкой ниже.',
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{
              text: 'Открыть КП',
              web_app: { url: launchUrl },
              style: 'success',
            }]],
          },
        });
        return new Response('OK');
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

function canUseKp(env, id) {
  const values = [
    env.MAIN_ADMIN_TELEGRAM_ID,
    env.ADMIN_TELEGRAM_IDS,
    env.ADMIN_TELEGRAM_ID,
    env.ADMIN_ID,
    env.KP_ADMIN_TELEGRAM_IDS,
    env.KP_ADMIN_TELEGRAM_ID,
  ];
  const ids = values.filter(Boolean).join(',').split(/[;,\s]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v));
  return ids.includes(String(id));
}

async function createSession(env, userId) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const body = `${userId}.${exp}`;
  const sig = await hmacHex(String(env.TELEGRAM_BOT_TOKEN || ''), body);
  return `${body}.${sig}`;
}

async function verifySession(env, token) {
  const match = String(token || '').match(/^(-?\d+)\.(\d+)\.([a-f0-9]{64})$/i);
  if (!match) return 0;
  const userId = Number(match[1]);
  const exp = Number(match[2]);
  if (!userId || !exp || exp < Math.floor(Date.now() / 1000)) return 0;
  if (!canUseKp(env, userId)) return 0;
  const expected = await hmacHex(String(env.TELEGRAM_BOT_TOKEN || ''), `${match[1]}.${match[2]}`);
  return constantEqual(expected, match[3].toLowerCase()) ? userId : 0;
}

async function makeSignedInitData(env, userId) {
  const botToken = String(env.TELEGRAM_BOT_TOKEN || '');
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: Number(userId), first_name: 'Admin' });
  const params = new URLSearchParams({ auth_date: authDate, user });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const encoder = new TextEncoder();
  const secret = await hmacBytes(encoder.encode('WebAppData'), encoder.encode(botToken));
  const digest = await hmacBytes(secret, encoder.encode(check));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  params.set('hash', hash);
  return params.toString();
}

async function hmacHex(secret, text) {
  const encoder = new TextEncoder();
  const digest = await hmacBytes(encoder.encode(secret), encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return data?.ok ? data.result : null;
  } catch {
    return null;
  }
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
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
