import baseWorker, { ConsentStore, AppStore } from './demo-worker-v32-multipart-boundary.js';

export { ConsentStore, AppStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-order-photo' && request.method === 'POST') {
      return handleOrderPhoto(request, env, url);
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(controller, env, ctx);
    }
  },
};

async function handleOrderPhoto(request, env, url) {
  try {
    const user = await validateRequestUser(request, env);
    if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);

    const orderNumber = cleanOrderNumber(url.searchParams.get('order'));
    const index = Math.max(0, Math.min(9, Number(url.searchParams.get('index') || 0)));
    const total = Math.max(1, Math.min(10, Number(url.searchParams.get('count') || 1)));
    if (!orderNumber || !Number.isInteger(index)) {
      return json({ ok: false, error: 'Некорректные параметры фотографии' }, 400);
    }

    const order = await appOrder(env, user.id, orderNumber);
    if (!order) return json({ ok: false, error: 'Заявка не найдена' }, 404);

    const existingIds = Array.isArray(order.photo_file_ids) ? [...order.photo_file_ids] : [];
    if (existingIds[index]) {
      return json({ ok: true, duplicate: true, file_id: existingIds[index], order });
    }

    const contentType = String(request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      return json({ ok: false, error: 'Поддерживаются только изображения' }, 415);
    }

    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return json({ ok: false, error: 'Файл пустой' }, 400);
    if (bytes.byteLength > MAX_PHOTO_BYTES) return json({ ok: false, error: 'Фотография слишком большая' }, 413);

    const rawName = decodeURIComponentSafe(request.headers.get('x-file-name') || `object-${index + 1}.jpg`);
    const filename = safeFilename(rawName, index);
    const admins = adminIds(env);
    if (!admins.length) return json({ ok: false, error: 'Администратор не настроен' }, 503);

    const blob = new Blob([bytes], { type: contentType });
    const caption = `Фото к заявке ${orderNumber} · ${index + 1}/${total}`;

    let fileId = '';
    let lastError = '';
    for (let attempt = 0; attempt < 2 && !fileId; attempt += 1) {
      try {
        const form = new FormData();
        form.append('chat_id', String(admins[0]));
        form.append('caption', caption);
        form.append('photo', blob, filename);
        const message = await telegramMultipart(env, 'sendPhoto', form);
        fileId = largestPhotoId(message);
      } catch (error) {
        lastError = String(error?.message || error);
      }
    }

    if (!fileId) {
      return json({ ok: false, error: `Не удалось отправить фотографию администратору${lastError ? `: ${lastError}` : ''}` }, 502);
    }

    for (const adminId of admins.slice(1)) {
      await safeTelegram(env, 'sendPhoto', { chat_id: adminId, photo: fileId, caption });
    }

    const nextIds = [...existingIds];
    nextIds[index] = fileId;
    const stored = await appPutOrder(env, {
      ...order,
      photo_count: Math.max(Number(order.photo_count || 0), total, nextIds.filter(Boolean).length),
      photo_file_ids: nextIds,
    });

    return json({ ok: true, file_id: fileId, index, order: stored || order });
  } catch (error) {
    console.error('Raw order photo upload failed', error);
    return json({ ok: false, error: `Не удалось загрузить фотографию: ${safeError(error)}` }, 500);
  }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function appOrder(env, clientId, number) {
  const stub = appStub(env);
  if (!stub) return null;
  const response = await stub.fetch(`https://app.internal/order?user=${encodeURIComponent(clientId)}&number=${encodeURIComponent(number)}`);
  return response.ok ? await response.json() : null;
}

async function appPutOrder(env, order) {
  const stub = appStub(env);
  if (!stub) return null;
  const response = await stub.fetch('https://app.internal/order', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(order),
  });
  if (!response.ok) return null;
  return (await response.json())?.order || null;
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v)))];
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
      const check = [...candidate].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
      const digest = await hmac(secret, encoder.encode(check));
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (constantEqual(hex, receivedHash)) {
        const user = JSON.parse(userRaw);
        return user?.id ? user : null;
      }
    }
  } catch {}
  return null;
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

async function telegramMultipart(env, method, form) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) throw new Error(data?.description || `Telegram ${method} failed`);
  return data.result;
}

async function telegram(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) throw new Error(data?.description || `Telegram ${method} failed`);
  return data.result;
}

async function safeTelegram(env, method, payload) {
  try { return await telegram(env, method, payload); }
  catch (error) { console.error(`Telegram ${method} failed`, error); return null; }
}

function largestPhotoId(message) {
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  return photos.length ? String(photos[photos.length - 1]?.file_id || '') : '';
}

function cleanOrderNumber(value) {
  const v = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(v) ? v : '';
}

function safeFilename(value, index) {
  const clean = String(value || '').replace(/[\\/\r\n\t\0]/g, '_').slice(0, 120).trim();
  return clean || `object-${index + 1}.jpg`;
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(String(value || '')); }
  catch { return String(value || ''); }
}

function safeError(error) {
  return String(error?.message || error || 'неизвестная ошибка').slice(0, 500);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  });
}
