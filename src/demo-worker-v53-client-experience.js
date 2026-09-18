import baseWorker, { ConsentStore, AppStore } from './demo-worker-v50-shared-booking.js';

export { ConsentStore, AppStore };

const CONSENT_VERSION = '2026-09-09-v1';
const APP_STORE_NAME = 'house-cleaning-app-v1';
const DAILY_CAPACITY_M2 = 300;
const MIN_BOOKING_LEAD_MS = 6 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
let orderSchemaReady = false;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const silentClient = request.headers.get('X-HC-Silent-Client') === '1';

    if (silentClient && url.pathname === '/api/demo-order' && request.method === 'POST') {
      let body = null;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Некорректная заявка' }, 400); }
      const event = String(body?.event || 'created');
      if (event === 'created') return createOrderWithoutClientMessage(request, env, ctx, url.origin, body);
      if (event === 'cancelled') return cancelOrderWithoutClientMessage(request, env, ctx, url.origin, body);
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function createOrderWithoutClientMessage(request, env, ctx, origin, body) {
  const user = await validateRequestUser(request, env);
  if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);

  const consent = await getConsent(env, user.id);
  if (!(consent?.status === 'accepted' && consent?.version === CONSENT_VERSION)) {
    return json({ ok: false, error: 'Сначала подтвердите согласие на обработку персональных данных командой /start.', consentRequired: true }, 403);
  }

  const order = normalizeCreatedOrder(body?.order, user);
  if (!order) return json({ ok: false, error: 'Проверьте данные заявки' }, 400);
  if (order.area > DAILY_CAPACITY_M2) {
    return json({ ok: false, error: 'Для площади больше 300 м² напишите менеджеру — онлайн-запись недоступна.' }, 409);
  }

  const start = Date.parse(`${order.date}T${order.time}:00+03:00`);
  if (!Number.isFinite(start) || start < Date.now() + MIN_BOOKING_LEAD_MS) {
    return json({ ok: false, error: 'Уборку можно оформить минимум за 6 часов до начала. Выберите более позднее время.' }, 409);
  }

  const existingOrders = await allOrders(env);
  const duplicate = existingOrders.find((item) => String(item?.order_number || '') === order.order_number);
  if (duplicate) {
    if (Number(duplicate.client_telegram_id || 0) !== Number(user.id)) {
      return json({ ok: false, error: 'Номер заявки уже используется' }, 409);
    }
    return json({
      ok: true,
      event: 'created',
      duplicate: true,
      adminNotified: 0,
      adminErrors: [],
      clientNotified: false,
      notificationSuppressed: true,
      photoNotified: Number(duplicate.photo_count || 0) < 1,
      order: duplicate,
    });
  }

  const sameDay = existingOrders.filter((item) => !item?.is_test
    && String(item?.date || '') === order.date
    && ACTIVE_STATUSES.has(String(item?.status || 'NEW')));
  const usedM2 = Math.max(0, sameDay.reduce((sum, item) => sum + Math.max(0, Number(item?.area || 0)), 0));
  const remainingM2 = Math.max(0, DAILY_CAPACITY_M2 - usedM2);
  if (order.area > remainingM2) {
    return json({ ok: false, error: `На эту дату осталось только ${remainingM2} м²` }, 409);
  }
  if (sameDay.some((item) => normalizeTime(item?.time) === order.time)) {
    return json({ ok: false, error: `Время ${order.time} уже занято. Выберите другое время.` }, 409);
  }

  const ids = adminIds(env);
  if (!ids.length) return json({ ok: false, error: 'Администратор не настроен', adminNotified: 0 }, 503);

  const adminText = newOrderAdminText(order, user);
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Подтвердить', callback_data: callbackData('c', user.id, order.order_number), style: 'success' },
        { text: 'Отменить', callback_data: callbackData('x', user.id, order.order_number), style: 'danger' },
      ],
      [{ text: 'Написать клиенту', url: `tg://user?id=${user.id}` }],
      [{ text: 'Панель заказов', web_app: { url: `${origin}/?demo=1&admin=1` }, style: 'primary' }],
    ],
  };

  const deliveredAdmins = [];
  const errors = [];
  for (const id of ids) {
    try {
      await telegram(env, 'sendMessage', { chat_id: Number(id), text: adminText, parse_mode: 'HTML', reply_markup: keyboard });
      deliveredAdmins.push(id);
    } catch (error) {
      errors.push(String(error?.message || error));
    }
  }
  if (!deliveredAdmins.length) {
    return json({ ok: false, error: `Telegram не доставил заявку администратору${errors[0] ? `: ${errors[0]}` : ''}`, adminNotified: 0, adminErrors: errors }, 502);
  }

  const stored = await appPutOrder(env, order);
  if (!stored) return json({ ok: false, error: 'Не удалось сохранить заявку. Повторите ещё раз.' }, 503);
  await mirrorOrder(env, stored);

  return json({
    ok: true,
    event: 'created',
    adminNotified: deliveredAdmins.length,
    adminErrors: errors,
    clientNotified: false,
    notificationSuppressed: true,
    photoNotified: Number(stored.photo_count || 0) < 1,
    order: stored,
  });
}

async function cancelOrderWithoutClientMessage(request, env, ctx, origin, body) {
  const user = await validateRequestUser(request, env);
  if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);

  const number = cleanOrderNumber(body?.order?.order_number);
  if (!number) return json({ ok: false, error: 'Заявка не найдена' }, 400);
  const current = await appOrder(env, user.id, number);
  if (!current) return json({ ok: false, error: 'Заявка не найдена' }, 404);

  const next = {
    ...current,
    ...(body?.order && typeof body.order === 'object' ? body.order : {}),
    client_telegram_id: Number(user.id),
    order_number: number,
    status: 'CANCELLED',
    cancelled_at: body?.order?.cancelled_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const ids = adminIds(env);
  const deliveredAdmins = [];
  const errors = [];
  const text = cancelledAdminText(next, user);
  for (const id of ids) {
    try {
      await telegram(env, 'sendMessage', {
        chat_id: Number(id),
        text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'Панель заказов', web_app: { url: `${origin}/?demo=1&admin=1` }, style: 'primary' }]] },
      });
      deliveredAdmins.push(id);
    } catch (error) {
      errors.push(String(error?.message || error));
    }
  }
  if (ids.length && !deliveredAdmins.length) {
    return json({ ok: false, error: `Не удалось уведомить администратора${errors[0] ? `: ${errors[0]}` : ''}`, adminNotified: 0, adminErrors: errors }, 502);
  }

  const stored = await appPutOrder(env, next);
  if (!stored) return json({ ok: false, error: 'Не удалось сохранить отмену' }, 503);
  await mirrorOrder(env, stored);

  return json({
    ok: true,
    event: 'cancelled',
    adminNotified: deliveredAdmins.length,
    adminErrors: errors,
    clientNotified: false,
    notificationSuppressed: true,
    photoNotified: true,
    order: stored,
  });
}

function normalizeCreatedOrder(raw, user) {
  if (!raw || typeof raw !== 'object') return null;
  const orderNumber = cleanOrderNumber(raw.order_number);
  const date = String(raw.date || '').trim();
  const time = normalizeTime(raw.time);
  const area = Number(raw.area || 0);
  if (!orderNumber || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !Number.isFinite(area) || area < 10) return null;

  return {
    ...raw,
    order_number: orderNumber,
    status: 'NEW',
    service_name: cleanText(raw.service_name, 160) || 'Уборка',
    property_type: cleanText(raw.property_type, 80),
    area,
    rooms: Math.max(0, Number(raw.rooms || 0)),
    bathrooms: Math.max(0, Number(raw.bathrooms || 0)),
    pets: Boolean(raw.pets),
    city: cleanText(raw.city, 120),
    address: cleanText(raw.address, 350),
    apartment: cleanText(raw.apartment, 80),
    entrance: cleanText(raw.entrance, 80),
    floor: cleanText(raw.floor, 80),
    address_comment: cleanText(raw.address_comment, 800),
    date,
    time,
    customer_name: cleanText(raw.customer_name, 180) || cleanText([user.first_name, user.last_name].filter(Boolean).join(' '), 180) || 'Клиент',
    phone: cleanText(raw.phone, 80),
    contact_method: cleanText(raw.contact_method, 40) || 'telegram',
    comment: cleanText(raw.comment, 1200),
    addon_ids: Array.isArray(raw.addon_ids) ? raw.addon_ids.slice(0, 50).map(Number).filter(Number.isFinite) : [],
    addon_names: Array.isArray(raw.addon_names) ? raw.addon_names.slice(0, 50).map((value) => cleanText(value, 160)).filter(Boolean) : [],
    photo_count: Math.max(0, Math.min(10, Number(raw.photo_count || 0))),
    price_per_m2: Math.max(0, Number(raw.price_per_m2 || 0)),
    estimated_price: Math.max(0, Number(raw.estimated_price || 0)) || null,
    client_telegram_id: Number(user.id),
    created_at: String(raw.created_at || new Date().toISOString()),
    updated_at: new Date().toISOString(),
    is_test: false,
  };
}

function newOrderAdminText(order, user) {
  const address = [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : '', order.entrance ? `подъезд ${order.entrance}` : '', order.floor ? `этаж ${order.floor}` : ''].filter(Boolean).join(', ');
  const addons = Array.isArray(order.addon_names) && order.addon_names.length ? order.addon_names.join(', ') : 'Нет';
  return [
    '<b>НОВАЯ ЗАЯВКА · HOUSE CLEANING</b>',
    '',
    `<b>${escapeHtml(order.order_number)}</b>`,
    `Клиент: <b>${escapeHtml(order.customer_name)}</b>`,
    `Telegram ID: <code>${Number(user.id)}</code>`,
    order.phone ? `Телефон: <b>${escapeHtml(order.phone)}</b>` : '',
    `Услуга: <b>${escapeHtml(order.service_name)}</b>`,
    `Площадь: <b>${escapeHtml(String(order.area))} м²</b>`,
    `Дата и время: <b>${escapeHtml(formatDisplayDate(order.date))} · ${escapeHtml(order.time)}</b>`,
    `Адрес: <b>${escapeHtml(address || 'Не указан')}</b>`,
    `Дополнительно: ${escapeHtml(addons)}`,
    Number(order.estimated_price || 0) > 0 ? `Предварительно: <b>${money(order.estimated_price)}</b>` : '',
    Number(order.photo_count || 0) > 0 ? `Фото объекта: ${Number(order.photo_count)} шт. (загрузятся отдельным сообщением)` : 'Фото объекта: нет',
    order.comment ? `Комментарий: ${escapeHtml(order.comment)}` : '',
  ].filter(Boolean).join('\n');
}

function cancelledAdminText(order, user) {
  return [
    '<b>КЛИЕНТ ОТМЕНИЛ ЗАЯВКУ</b>',
    '',
    `<b>${escapeHtml(order.order_number)}</b>`,
    `Клиент: <b>${escapeHtml(order.customer_name || user.first_name || 'Клиент')}</b>`,
    `Telegram ID: <code>${Number(user.id)}</code>`,
    order.date ? `Дата: <b>${escapeHtml(formatDisplayDate(order.date))} · ${escapeHtml(normalizeTime(order.time) || '')}</b>` : '',
    order.address ? `Адрес: <b>${escapeHtml([order.city, order.address].filter(Boolean).join(', '))}</b>` : '',
  ].filter(Boolean).join('\n');
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function allOrders(env) {
  const stub = appStub(env);
  if (!stub) return [];
  try {
    const response = await stub.fetch('https://app.internal/orders');
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data?.orders) ? data.orders : [];
  } catch { return []; }
}

async function appOrder(env, userId, orderNumber) {
  const stub = appStub(env);
  if (!stub) return null;
  try {
    const response = await stub.fetch(`https://app.internal/order?user=${encodeURIComponent(userId)}&number=${encodeURIComponent(orderNumber)}`);
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function appPutOrder(env, order) {
  const stub = appStub(env);
  if (!stub) return null;
  try {
    const response = await stub.fetch('https://app.internal/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    return data?.order || order;
  } catch { return null; }
}

async function getConsent(env, userId) {
  if (!env.CONSENT_STORE || !userId) return null;
  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const stub = env.CONSENT_STORE.get(id);
    const response = await stub.fetch('https://consent.internal/record');
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

async function validateRequestUser(request, env) {
  return validateInitData(request.headers.get('X-Telegram-Init-Data') || '', env.TELEGRAM_BOT_TOKEN);
}

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const receivedHash = String(params.get('hash') || '').toLowerCase();
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

function callbackData(action, userId, orderNumber) {
  return `hc:${action}:${userId}:${encodeURIComponent(String(orderNumber).slice(0, 28))}`.slice(0, 64);
}

function formatDisplayDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : raw;
}

function normalizeTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function cleanOrderNumber(value) {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(raw) ? raw : '';
}

function cleanText(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`;
}

function findD1(env) {
  for (const name of ['DB', 'D1', 'DATABASE']) {
    const value = env?.[name];
    if (value && typeof value.prepare === 'function') return value;
  }
  for (const value of Object.values(env || {})) {
    if (value && typeof value.prepare === 'function' && typeof value.batch === 'function') return value;
  }
  return null;
}

async function ensureOrderSchema(db) {
  if (orderSchemaReady || !db) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS hc_orders (order_number TEXT PRIMARY KEY, client_telegram_id INTEGER, status TEXT, service_name TEXT, area REAL, date TEXT, time TEXT, address_key TEXT, is_test INTEGER DEFAULT 0, order_json TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS hc_orders_client_idx ON hc_orders(client_telegram_id, status, date)').run();
  orderSchemaReady = true;
}

function addressKey(order) {
  return [order?.city, order?.address, order?.apartment]
    .map((value) => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim())
    .filter(Boolean)
    .join('|');
}

async function mirrorOrder(env, order) {
  const db = findD1(env);
  if (!db || !order?.order_number) return;
  try {
    await ensureOrderSchema(db);
    const now = new Date().toISOString();
    await db.prepare('INSERT INTO hc_orders (order_number, client_telegram_id, status, service_name, area, date, time, address_key, is_test, order_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(order_number) DO UPDATE SET client_telegram_id=excluded.client_telegram_id, status=excluded.status, service_name=excluded.service_name, area=excluded.area, date=excluded.date, time=excluded.time, address_key=excluded.address_key, is_test=excluded.is_test, order_json=excluded.order_json, updated_at=excluded.updated_at')
      .bind(String(order.order_number), Number(order.client_telegram_id || 0), String(order.status || ''), String(order.service_name || ''), Number(order.area || 0), String(order.date || ''), String(order.time || ''), addressKey(order), order.is_test ? 1 : 0, JSON.stringify(order), now).run();
  } catch (error) {
    console.error('Release 53 order mirror failed', error);
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
