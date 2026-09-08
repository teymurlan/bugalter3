import baseWorker from './demo-worker-v2.js';

const VALID_STATUSES = new Set(['CONFIRMED', 'COMPLETED', 'CANCELLED']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      return handleWebStatus(request, env, url.origin);
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET
        && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      let update;
      try { update = await request.clone().json(); }
      catch { return new Response('Bad Request', { status: 400 }); }

      if (update.callback_query && String(update.callback_query.data || '').startsWith('hc:')) {
        await handleCallback(update.callback_query, env, url.origin);
        return new Response('OK');
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleWebStatus(request, env, origin) {
  const user = await validateInitData(request.headers.get('X-Telegram-Init-Data') || '', env.TELEGRAM_BOT_TOKEN);
  if (!user || !isAdmin(env, user.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Некорректный запрос' }, 400); }

  const order = normalizeOrder(body?.order);
  const status = String(body?.status || '');
  const clientId = Number(body?.clientTelegramId || order?.client_telegram_id || 0);
  if (!order || !VALID_STATUSES.has(status) || !Number.isSafeInteger(clientId) || clientId <= 0) {
    return json({ ok: false, error: 'Недостаточно данных для уведомления клиента' }, 400);
  }

  const sent = await sendStatus(env, clientId, order, status, origin);
  return sent
    ? json({ ok: true, status, clientNotified: true })
    : json({ ok: false, error: 'Telegram не доставил уведомление клиенту' }, 502);
}

async function handleCallback(query, env, origin) {
  if (!isAdmin(env, query?.from?.id)) {
    await safeTelegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Нет доступа', show_alert: true });
    return;
  }

  const match = /^hc:(c|x|d):(\d+):(.+)$/.exec(String(query.data || ''));
  if (!match) {
    await safeTelegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Команда устарела' });
    return;
  }

  const action = match[1];
  const clientId = Number(match[2]);
  const orderNumber = decodeURIComponent(match[3]);
  const status = action === 'c' ? 'CONFIRMED' : action === 'd' ? 'COMPLETED' : 'CANCELLED';
  const order = parseOrderFromAdminMessage(query.message?.text || '', orderNumber);

  const sent = await sendStatus(env, clientId, order, status, origin);
  if (!sent) {
    await safeTelegram(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Не удалось уведомить клиента',
      show_alert: true,
    });
    return;
  }

  await safeTelegram(env, 'answerCallbackQuery', {
    callback_query_id: query.id,
    text: status === 'CONFIRMED' ? 'Заявка подтверждена' : status === 'COMPLETED' ? 'Уборка завершена' : 'Заявка отменена',
  });

  if (!query.message?.chat?.id || !query.message?.message_id) return;

  const cleanText = String(query.message.text || '')
    .replace(/\n\n(?:✅|✨|❌)?\s*Статус:[\s\S]*$/i, '')
    .trim();
  const statusLine = status === 'CONFIRMED'
    ? '✅ <b>Статус: ПОДТВЕРЖДЕНА</b>'
    : status === 'COMPLETED'
      ? '✨ <b>Статус: ЗАВЕРШЕНА</b>'
      : '❌ <b>Статус: ОТМЕНЕНА</b>';

  const panelUrl = syncUrl(origin, orderNumber, status, true);
  const replyMarkup = status === 'CONFIRMED'
    ? {
        inline_keyboard: [
          [{ text: 'Завершить уборку', callback_data: callbackData('d', clientId, orderNumber), style: 'success' }],
          [{ text: 'Отменить', callback_data: callbackData('x', clientId, orderNumber), style: 'danger' }],
          [{ text: 'Открыть панель заказов', web_app: { url: panelUrl }, style: 'primary' }],
          [{ text: 'Написать клиенту', url: `tg://user?id=${clientId}` }],
        ],
      }
    : {
        inline_keyboard: [
          [{ text: 'Открыть панель заказов', web_app: { url: panelUrl }, style: 'primary' }],
          [{ text: 'Написать клиенту', url: `tg://user?id=${clientId}` }],
        ],
      };

  await safeTelegram(env, 'editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: `${escapeHtml(cleanText)}\n\n${statusLine}`,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });
}

async function sendStatus(env, clientId, order, status, origin) {
  const title = status === 'CONFIRMED'
    ? '✅ <b>Заявка подтверждена</b>'
    : status === 'COMPLETED'
      ? '✨ <b>Уборка завершена</b>'
      : '❌ <b>Заявка отменена</b>';
  const ending = status === 'CONFIRMED'
    ? 'Уборка подтверждена. Если нужно изменить детали — свяжитесь с менеджером.'
    : status === 'COMPLETED'
      ? 'Спасибо, что выбрали HOUSE CLEANING.'
      : 'Если хотите выбрать другую дату — откройте приложение или напишите менеджеру.';

  const details = orderDetails(order);
  return safeTelegram(env, 'sendMessage', {
    chat_id: clientId,
    text: `${title}\n\n${details}\n\n${ending}`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{
        text: status === 'CONFIRMED' ? 'Открыть подтверждённую заявку' : 'Открыть заявку',
        web_app: { url: syncUrl(origin, order.order_number, status, false) },
        style: status === 'CONFIRMED' ? 'success' : 'primary',
      }]],
    },
  });
}

function syncUrl(origin, orderNumber, status, admin) {
  const params = new URLSearchParams({ demo: '1', sync_order: orderNumber, sync_status: status, route: admin ? 'admin' : 'orders' });
  if (admin) params.set('admin', '1');
  return `${origin}/?${params.toString()}`;
}

function orderDetails(order) {
  const lines = [`<b>${escapeHtml(order.order_number)}</b>`];
  if (order.service_name) lines.push(`Уборка: ${escapeHtml(order.service_name)}`);
  if (Number(order.area)) lines.push(`Площадь: <b>${Number(order.area)} м²</b>`);
  if (order.date) lines.push(`Дата: <b>${escapeHtml(order.date)} · ${escapeHtml(order.time || '—')}</b>`);
  if (order.city || order.address) lines.push(`Адрес: ${escapeHtml([order.city, order.address].filter(Boolean).join(', '))}`);
  if (order.addon_names?.length) lines.push(`Дополнительно: ${escapeHtml(order.addon_names.join(', '))}`);
  return lines.join('\n');
}

function parseOrderFromAdminMessage(text, orderNumber) {
  const value = String(text || '');
  const pick = (re) => value.match(re)?.[1]?.trim() || '';
  const area = Number(pick(/Площадь:\s*(\d+(?:[.,]\d+)?)\s*м²/i).replace(',', '.')) || 0;
  const dateTime = value.match(/Дата:\s*([^·\n]+)\s*·\s*([^\n]+)/i);
  const addressLine = pick(/Адрес:\s*([^\n]+)/i);
  const addressParts = addressLine.split(',').map((part) => part.trim()).filter(Boolean);
  const addons = pick(/Дополнительно:\s*([^\n]+)/i);
  return {
    order_number: orderNumber,
    service_name: pick(/Уборка:\s*([^\n]+)/i),
    area,
    date: dateTime?.[1]?.trim() || '',
    time: dateTime?.[2]?.trim() || '',
    city: addressParts.length > 1 ? addressParts.shift() : '',
    address: addressParts.join(', ') || addressLine,
    addon_names: addons && addons.toLowerCase() !== 'нет' ? addons.split(',').map((x) => x.trim()).filter(Boolean) : [],
  };
}

function normalizeOrder(raw) {
  if (!raw?.order_number) return null;
  return {
    ...raw,
    order_number: String(raw.order_number),
    service_name: String(raw.service_name || 'Уборка'),
    area: Number(raw.area || 0),
    date: String(raw.date || ''),
    time: String(raw.time || ''),
    city: String(raw.city || ''),
    address: String(raw.address || ''),
    addon_names: Array.isArray(raw.addon_names) ? raw.addon_names.map(String) : [],
    client_telegram_id: Number(raw.client_telegram_id || 0),
  };
}

function callbackData(action, userId, orderNumber) {
  return `hc:${action}:${userId}:${encodeURIComponent(String(orderNumber).slice(0, 28))}`.slice(0, 64);
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v)))];
}
function isAdmin(env, id) { return adminIds(env).includes(String(id)); }

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
  } catch { return null; }
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
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' } });
}
