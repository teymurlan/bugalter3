import baseWorker, { ConsentStore, AppStore } from './demo-worker-v8.js';

export { ConsentStore, AppStore };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-client-orders' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      const orders = await appOrders(env);
      return json({ ok: true, orders: orders.filter((order) => Number(order.client_telegram_id) === Number(user.id)) });
    }

    if (url.pathname === '/api/demo-client-order' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      const number = String(url.searchParams.get('order') || '').trim();
      if (!number) return json({ ok: false, error: 'Order is required' }, 400);
      const order = await appOrder(env, user.id, number);
      if (!order) return json({ ok: false, error: 'Order not found' }, 404);
      return json({ ok: true, order });
    }

    if (url.pathname === '/api/demo-client-photo' && request.method === 'GET') {
      return handleClientPhoto(request, env);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

function appStub(env) {
  if (!env.APP_STORE) return null;
  const id = env.APP_STORE.idFromName('house-cleaning-app-v1');
  return env.APP_STORE.get(id);
}

async function appOrders(env) {
  const stub = appStub(env);
  if (!stub) return [];
  const response = await stub.fetch('https://app.internal/orders');
  if (!response.ok) return [];
  return (await response.json()).orders || [];
}

async function appOrder(env, clientId, number) {
  const stub = appStub(env);
  if (!stub) return null;
  const response = await stub.fetch(`https://app.internal/order?user=${encodeURIComponent(clientId)}&number=${encodeURIComponent(number)}`);
  return response.ok ? await response.json() : null;
}

async function handleClientPhoto(request, env) {
  const user = await validateRequestUser(request, env);
  if (!user) return new Response('Forbidden', { status: 403 });

  const url = new URL(request.url);
  const number = String(url.searchParams.get('order') || '').trim();
  const index = Number(url.searchParams.get('index') || 0);
  if (!number || !Number.isInteger(index) || index < 0 || index > 9) return new Response('Bad Request', { status: 400 });

  const order = await appOrder(env, user.id, number);
  const fileId = order?.photo_file_ids?.[index];
  if (!fileId) return new Response('Photo not found', { status: 404 });

  const file = await telegram(env, 'getFile', { file_id: fileId });
  if (!file?.file_path) return new Response('Photo not found', { status: 404 });

  const upstream = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!upstream.ok) return new Response('Photo unavailable', { status: 502 });

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') || 'image/jpeg');
  headers.set('cache-control', 'private, max-age=300');
  return new Response(upstream.body, { status: 200, headers });
}

async function validateRequestUser(request, env) {
  return validateInitData(request.headers.get('X-Telegram-Init-Data') || '', env.TELEGRAM_BOT_TOKEN);
}

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const receivedHash = (params.get('hash') || '').toLowerCase();
    const authDate = Number(params.get('auth_date') || 0);
    const userRaw = params.get('user');
    if (!receivedHash || !authDate || !userRaw || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
    params.delete('hash');
    const entries = [...params.entries()];
    const candidates = [entries, entries.filter(([key]) => key !== 'signature')];
    const encoder = new TextEncoder();
    const secret = await hmac(encoder.encode('WebAppData'), encoder.encode(botToken));
    for (const candidate of candidates) {
      const check = [...candidate].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
      const digest = await hmac(secret, encoder.encode(check));
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (constantEqual(hex, receivedHash)) {
        const user = JSON.parse(userRaw);
        return user?.id ? user : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, dataBytes);
}

function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
