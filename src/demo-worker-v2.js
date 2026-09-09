import baseWorker from './demo-worker.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      return handleOrderEvent(request, env, url.origin);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleOrderEvent(request, env, origin) {
  const user = await validateInitData(
    request.headers.get('X-Telegram-Init-Data') || '',
    env.TELEGRAM_BOT_TOKEN,
  );
  if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Некорректный запрос' }, 400); }

  const order = cleanOrder(body?.order);
  if (!order) return json({ ok: false, error: 'Недостаточно данных заявки' }, 400);
  const event = body?.event === 'cancelled' ? 'cancelled' : 'created';

  const ids = adminIds(env);
  if (!ids.length) {
    return json({
      ok: false,
      error: 'ADMIN_TELEGRAM_IDS не настроен. Администратор не получит заявку.',
      adminNotified: 0,
    }, 503);
  }

  const adminText = event === 'created'
    ? newOrderAdminText(order, user)
    : cancelledAdminText(order, user);

  const adminKeyboard = event === 'created'
    ? {
        inline_keyboard: [
          [
            { text: 'Подтвердить', callback_data: callbackData('c', user.id, order.order_number), style: 'success' },
            { text: 'Отменить', callback_data: callbackData('x', user.id, order.order_number), style: 'danger' },
          ],
          [{ text: 'Написать клиенту', url: `tg://user?id=${user.id}` }],
          [{ text: 'Панель заказов', web_app: { url: `${origin}/?demo=1&admin=1` }, style: 'primary' }],
        ],
      }
    : {
        inline_keyboard: [[{ text: 'Написать клиенту', url: `tg://user?id=${user.id}` }]],
      };

  const results = await Promise.allSettled(ids.map((id) => telegram(env, 'sendMessage', {
    chat_id: id,
    text: adminText,
    parse_mode: 'HTML',
    reply_markup: adminKeyboard,
  })));

  const adminNotified = results.filter((item) => item.status === 'fulfilled').length;
  const adminErrors = results
    .filter((item) => item.status === 'rejected')
    .map((item) => String(item.reason?.message || item.reason));

  if (adminNotified < 1) {
    return json({
      ok: false,
      error: `Telegram не доставил уведомление администратору${adminErrors[0] ? `: ${adminErrors[0]}` : ''}`,
      adminNotified,
      adminErrors,
    }, 502);
  }

  const clientText = event === 'created'
    ? [
        '🧹 <b>Заявка получена</b>',
        '',
        orderDetails(order),
        '',
        'Стоимость указана предварительно. Точную стоимость рассчитает менеджер после оценки объекта и фотографий.',
        '',
        '✅ Администратор уже получил вашу заявку.',
        'После подтверждения бот пришлёт отдельное сообщение.',
      ].join('\n')
    : [
        '❌ <b>Заявка отменена</b>',
        '',
        orderDetails(order),
        '',
        'Администратор уведомлён об отмене.',
      ].join('\n');

  const clientSent = await safeTelegram(env, 'sendMessage', {
    chat_id: user.id,
    text: clientText,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{
        text: 'Открыть HOUSE CLEANING',
        web_app: { url: `${origin}/?demo=1` },
        style: 'primary',
      }]],
    },
  });

  return json({
    ok: true,
    event,
    adminNotified,
    adminErrors,
    clientNotified: Boolean(clientSent),
  });
}

function orderDetails(order) {
  const lines = [`<b>${escapeHtml(order.order_number)}</b>`];
  if (order.service_name) lines.push(`Уборка: ${escapeHtml(order.service_name)}`);
  if (Number(order.area)) lines.push(`Площадь: <b>${Number(order.area)} м²</b>`);
  if (order.date) lines.push(`Дата: <b>${formatDateShort(order.date)}</b>`);
  if (order.time) lines.push(`Время: <b>${formatTimeShort(order.time)}</b>`);
  if (order.city || order.address) lines.push(`Адрес: ${escapeHtml([order.city, order.address].filter(Boolean).join(', '))}`);
  if (order.addon_names.length) lines.push(`Дополнительно: ${escapeHtml(order.addon_names.join(', '))}`);
  if (Number(order.estimated_price) > 0) lines.push(`Предварительная стоимость: <b>от ${money(order.estimated_price)}</b>`);
  return lines.join('\n');
}

function newOrderAdminText(order, user) {
  return [
    '🧹 <b>НОВАЯ ЗАЯВКА · HOUSE CLEANING</b>',
    '',
    `<b>${escapeHtml(order.order_number)}</b>`,
    `Клиент: <b>${escapeHtml(order.customer_name)}</b>`,
    `Телефон: ${escapeHtml(order.phone || '—')}`,
    `Уборка: ${escapeHtml(order.service_name)}`,
    `Площадь: <b>${order.area} м²</b>`,
    `Дата: <b>${formatDateShort(order.date)}</b>`,
    `Время: <b>${formatTimeShort(order.time)}</b>`,
    `Адрес: ${escapeHtml(`${order.city}, ${order.address}`)}`,
    `Дополнительно: ${escapeHtml(order.addon_names.join(', ') || 'нет')}`,
    `Фото: ${order.photo_count}`,
    Number(order.estimated_price) > 0 ? `Предварительная стоимость: <b>от ${money(order.estimated_price)}</b>` : 'Предварительная стоимость: рассчитает менеджер',
    '<i>Точная стоимость — после оценки объекта и фотографий.</i>',
    '',
    `Telegram: ${user.username ? `@${escapeHtml(user.username)}` : `ID ${user.id}`}`,
  ].join('\n');
}

function cancelledAdminText(order, user) {
  return [
    '❌ <b>ЗАЯВКА ОТМЕНЕНА · HOUSE CLEANING</b>',
    '',
    `<b>${escapeHtml(order.order_number)}</b>`,
    `Клиент: <b>${escapeHtml(order.customer_name)}</b>`,
    `Телефон: ${escapeHtml(order.phone || '—')}`,
    `Уборка: ${escapeHtml(order.service_name)}`,
    `Площадь: <b>${order.area} м²</b>`,
    `Дата: <b>${formatDateShort(order.date)}</b>`,
    `Время: <b>${formatTimeShort(order.time)}</b>`,
    `Адрес: ${escapeHtml(`${order.city}, ${order.address}`)}`,
    Number(order.estimated_price) > 0 ? `Предварительная стоимость: <b>от ${money(order.estimated_price)}</b>` : '',
    '',
    `Telegram: ${user.username ? `@${escapeHtml(user.username)}` : `ID ${user.id}`}`,
  ].filter(Boolean).join('\n');
}

function cleanOrder(raw) {
  const area = Number(raw?.area || 0);
  if (!raw?.order_number || !raw?.customer_name || !raw?.date || !raw?.address
    || !Number.isFinite(area) || area < 1 || area > 5000) {
    return null;
  }

  return {
    ...raw,
    area,
    order_number: String(raw.order_number),
    customer_name: String(raw.customer_name),
    phone: String(raw.phone || ''),
    service_name: String(raw.service_name || 'Уборка'),
    city: String(raw.city || ''),
    address: String(raw.address || ''),
    date: String(raw.date),
    time: String(raw.time || ''),
    addon_names: Array.isArray(raw.addon_names) ? raw.addon_names.map(String) : [],
    photo_count: Math.max(0, Number(raw.photo_count || 0)),
    price_per_m2: Math.max(0, Number(raw.price_per_m2 || 0)),
    estimated_price: Math.max(0, Number(raw.estimated_price || 0)),
    client_telegram_id: Number(raw.client_telegram_id || 0),
  };
}

function formatDateShort(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1].slice(-2)}`;
  const ru = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{2}|\d{4})$/);
  if (ru) return `${ru[1]}/${ru[2]}/${ru[3].slice(-2)}`;
  return escapeHtml(raw || '—');
}

function formatTimeShort(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return escapeHtml(raw || '—');
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`;
}

function callbackData(action, userId, orderNumber) {
  return `hc:${action}:${userId}:${encodeURIComponent(String(orderNumber).slice(0, 28))}`.slice(0, 64);
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]
    .filter(Boolean)
    .join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
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
    const allEntries = [...params.entries()];
    const candidates = [allEntries, allEntries.filter(([key]) => key !== 'signature')];
    const encoder = new TextEncoder();
    const secret = await hmac(encoder.encode('WebAppData'), encoder.encode(botToken));
    for (const entries of candidates) {
      const checkString = [...entries]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      const digest = await hmac(secret, encoder.encode(checkString));
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] || char));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}