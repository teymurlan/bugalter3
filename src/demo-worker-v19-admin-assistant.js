import baseWorker, { ConsentStore, AppStore } from './demo-worker-v18-client.js';

export { ConsentStore, AppStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const TEMPLATE_IDS = new Set(['need_details', 'need_photos', 'reminder', 'manager_callback']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-admin-message' && request.method === 'POST') {
      const admin = await validateRequestUser(request, env);
      if (!admin || !isAdmin(env, admin.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);

      let body = {};
      try { body = await request.json(); } catch {}
      const clientId = positiveInt(body.client_telegram_id);
      const orderNumber = cleanOrderNumber(body.order_number);
      const template = String(body.template || '').trim();
      if (!clientId || !orderNumber || !TEMPLATE_IDS.has(template)) return json({ ok: false, error: 'Некорректные данные' }, 400);

      const order = await appOrder(env, clientId, orderNumber);
      if (!order) return json({ ok: false, error: 'Заявка не найдена' }, 404);

      const text = templateText(template, order);
      const managerId = adminIds(env)[0];
      const replyMarkup = managerId
        ? { inline_keyboard: [[{ text: 'Написать менеджеру', url: `tg://user?id=${managerId}` }]] }
        : undefined;

      const sent = await safeTelegram(env, 'sendMessage', {
        chat_id: clientId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
      if (!sent) return json({ ok: false, error: 'Не удалось отправить сообщение' }, 502);

      return json({ ok: true, message_id: sent.message_id || null });
    }

    if (url.pathname === '/api/demo-admin-note' && request.method === 'POST') {
      const admin = await validateRequestUser(request, env);
      if (!admin || !isAdmin(env, admin.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);

      let body = {};
      try { body = await request.json(); } catch {}
      const clientId = positiveInt(body.client_telegram_id);
      const orderNumber = cleanOrderNumber(body.order_number);
      const note = String(body.note || '').trim().slice(0, 1200);
      if (!clientId || !orderNumber) return json({ ok: false, error: 'Некорректные данные' }, 400);

      const order = await appOrder(env, clientId, orderNumber);
      if (!order) return json({ ok: false, error: 'Заявка не найдена' }, 404);
      const updated = {
        ...order,
        admin_note: note,
        admin_note_updated_at: new Date().toISOString(),
        admin_note_updated_by: Number(admin.id),
      };
      const stored = await appPutOrder(env, updated);
      return json({ ok: true, order: stored || updated });
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

function templateText(template, order) {
  const number = escapeHtml(order.order_number || 'заявка');
  const date = formatDate(order.date);
  const time = formatTime(order.time);
  const lines = {
    need_details: [
      '<b>HOUSE CLEANING</b>',
      '',
      `По заявке <b>${number}</b> нужно уточнить несколько деталей.`,
      '',
      'Напишите менеджеру — это займёт пару минут и поможет быстрее подтвердить уборку.',
    ],
    need_photos: [
      '<b>HOUSE CLEANING</b>',
      '',
      `По заявке <b>${number}</b> нужны дополнительные фотографии объекта.`,
      '',
      'Отправьте их менеджеру, чтобы мы точнее оценили объём работ и стоимость.',
    ],
    reminder: [
      '<b>HOUSE CLEANING</b>',
      '',
      `Напоминаем об уборке <b>${date}</b> в <b>${time}</b>.`,
      '',
      'Если планы изменились или нужно что-то уточнить — свяжитесь с менеджером.',
    ],
    manager_callback: [
      '<b>HOUSE CLEANING</b>',
      '',
      `По заявке <b>${number}</b> менеджеру нужно связаться с вами.`,
      '',
      'Нажмите кнопку ниже, если удобно продолжить переписку сейчас.',
    ],
  };
  return (lines[template] || lines.need_details).join('\n');
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  const id = env.APP_STORE.idFromName(APP_STORE_NAME);
  return env.APP_STORE.get(id);
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
  const data = await response.json();
  return data?.order || null;
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function cleanOrderNumber(value) {
  const number = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(number) ? number : '';
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

function isAdmin(env, id) {
  return adminIds(env).includes(String(id));
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
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
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

function formatDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : escapeHtml(raw || '—');
}

function formatTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : escapeHtml(raw || '—');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
