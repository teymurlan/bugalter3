import baseWorker, { ConsentStore, AppStore } from './demo-worker-v29-automation.js';

export { ConsentStore, AppStore };

const MANAGER_PHONE = '+79992107977';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/manager-contact' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      const managerId = positiveInt(adminIds(env)[0]);
      const chat = managerId ? await safeTelegram(env, 'getChat', { chat_id: managerId }) : null;
      return json({
        ok: true,
        telegram_id: managerId,
        username: cleanUsername(chat?.username),
        phone: MANAGER_PHONE,
      });
    }

    if (url.pathname === '/api/admin-client-contact' && request.method === 'GET') {
      const admin = await validateRequestUser(request, env);
      if (!admin || !isAdmin(env, admin.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      const clientId = positiveInt(url.searchParams.get('user'));
      if (!clientId) return json({ ok: false, error: 'Client is required' }, 400);
      const chat = await safeTelegram(env, 'getChat', { chat_id: clientId });
      return json({
        ok: true,
        telegram_id: clientId,
        username: cleanUsername(chat?.username),
      });
    }

    if (url.pathname === '/api/contact-manager-fallback' && request.method === 'POST') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      const managerId = positiveInt(adminIds(env)[0]);
      if (!managerId) return json({ ok: false, error: 'Контакт менеджера не настроен' }, 503);
      const sent = await safeTelegram(env, 'sendMessage', {
        chat_id: Number(user.id),
        text: '<b>Связь с менеджером</b>\n\nНажмите кнопку ниже — Telegram откроет личный чат с менеджером.',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '✉️ Открыть чат с менеджером', url: `tg://user?id=${managerId}`, style: 'primary' }]],
        },
      });
      return sent ? json({ ok: true }) : json({ ok: false, error: 'Не удалось подготовить чат' }, 502);
    }

    if (url.pathname === '/api/admin-client-chat-fallback' && request.method === 'POST') {
      const admin = await validateRequestUser(request, env);
      if (!admin || !isAdmin(env, admin.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      let body = {};
      try { body = await request.json(); } catch {}
      const clientId = positiveInt(body.client_telegram_id);
      if (!clientId) return json({ ok: false, error: 'Клиент не найден' }, 400);
      const sent = await safeTelegram(env, 'sendMessage', {
        chat_id: Number(admin.id),
        text: '<b>Связь с клиентом</b>\n\nУ клиента нет публичного username. Нажмите кнопку ниже — Telegram попробует открыть личный чат по ID.',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '✉️ Открыть чат с клиентом', url: `tg://user?id=${clientId}`, style: 'primary' }]],
        },
      });
      return sent ? json({ ok: true }) : json({ ok: false, error: 'Не удалось подготовить чат' }, 502);
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

function cleanUsername(value) {
  const username = String(value || '').trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : '';
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

function isAdmin(env, id) { return adminIds(env).includes(String(id)); }

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

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
