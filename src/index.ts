import type { Env, OrderPayload } from './types';
import { requireAuth } from './auth';
import { adminIds, answerCallback, sendTelegramMessage } from './telegram';
import { badRequest, json, normalizePhone, notFound, unauthorized, validDate, validTime } from './utils';

const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const ACTIVE_STATUSES = ['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS'];

async function getServices(env: Env) {
  const result = await env.DB.prepare(`
    SELECT id, code, kind, name, description, price_per_m2, fixed_price, sort_order
    FROM services WHERE is_active = 1 ORDER BY kind DESC, sort_order, id
  `).all();
  return result.results;
}

async function getUser(env: Env, dbUserId: number) {
  return env.DB.prepare(`
    SELECT id, telegram_id, username, first_name, last_name, name, phone, photo_url
    FROM users WHERE id = ?
  `).bind(dbUserId).first();
}

async function availability(env: Env, date: string) {
  if (!validDate(date)) return { date, closed: true, slots: [] };
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return { date, closed: true, slots: [] };

  const dayBlock = await env.DB.prepare('SELECT 1 AS yes FROM date_blocks WHERE date = ? AND is_closed = 1')
    .bind(date).first();
  if (dayBlock) return { date, closed: true, slots: [] };

  const blockedRows = await env.DB.prepare('SELECT time FROM slot_blocks WHERE date = ? AND is_closed = 1')
    .bind(date).all<{ time: string }>();
  const blocked = new Set(blockedRows.results.map((row) => row.time));

  const occupiedRows = await env.DB.prepare(`
    SELECT time, COUNT(*) AS count FROM orders
    WHERE date = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
    GROUP BY time
  `).bind(date, ...ACTIVE_STATUSES).all<{ time: string; count: number }>();
  const occupied = new Set(occupiedRows.results.filter((row) => row.count >= 1).map((row) => row.time));

  const slots = Array.from({ length: 10 }, (_, index) => `${String(index + 9).padStart(2, '0')}:00`)
    .map((time) => ({ time, available: !blocked.has(time) && !occupied.has(time) }));
  return { date, closed: false, slots };
}

function validatePayload(payload: OrderPayload): string | null {
  if (!Number.isInteger(payload.serviceId) || payload.serviceId <= 0) return 'Выберите вид уборки';
  if (!['apartment', 'house', 'office', 'commercial', 'other'].includes(payload.propertyType)) return 'Выберите тип объекта';
  if (!Number.isFinite(payload.area) || payload.area < 10 || payload.area > 5000) return 'Проверьте площадь объекта';
  if (!Number.isInteger(payload.rooms) || payload.rooms < 0 || payload.rooms > 50) return 'Проверьте количество комнат';
  if (!Number.isInteger(payload.bathrooms) || payload.bathrooms < 0 || payload.bathrooms > 20) return 'Проверьте количество санузлов';
  if (!payload.city?.trim() || !payload.address?.trim()) return 'Укажите адрес';
  if (!validDate(payload.date) || !validTime(payload.time)) return 'Выберите дату и время';
  if (!payload.customerName?.trim()) return 'Укажите имя';
  if (normalizePhone(payload.phone || '').length < 10) return 'Укажите корректный телефон';
  if (!payload.idempotencyKey || payload.idempotencyKey.length < 16 || payload.idempotencyKey.length > 100) return 'Некорректный ключ заявки';
  if (!Array.isArray(payload.addonIds) || payload.addonIds.length > 30) return 'Некорректный список услуг';
  return null;
}

async function createOrder(request: Request, env: Env) {
  const auth = await requireAuth(request, env);
  const form = await request.formData();
  const payloadRaw = form.get('payload');
  if (typeof payloadRaw !== 'string') return badRequest('Данные заявки отсутствуют');

  let payload: OrderPayload;
  try { payload = JSON.parse(payloadRaw) as OrderPayload; } catch { return badRequest('Некорректные данные заявки'); }
  const validationError = validatePayload(payload);
  if (validationError) return badRequest(validationError);

  const existing = await env.DB.prepare(`SELECT id, order_number FROM orders WHERE user_id = ? AND idempotency_key = ?`)
    .bind(auth.dbUserId, payload.idempotencyKey).first();
  if (existing) return json({ ok: true, order: existing, duplicate: true });

  const service = await env.DB.prepare(`
    SELECT id, name, price_per_m2 FROM services WHERE id = ? AND kind = 'primary' AND is_active = 1
  `).bind(payload.serviceId).first<{ id: number; name: string; price_per_m2: number | null }>();
  if (!service) return badRequest('Услуга недоступна');

  const uniqueAddonIds = [...new Set(payload.addonIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  let addons: Array<{ id: number; name: string; fixed_price: number | null }> = [];
  if (uniqueAddonIds.length) {
    const placeholders = uniqueAddonIds.map(() => '?').join(',');
    const result = await env.DB.prepare(`
      SELECT id, name, fixed_price FROM services
      WHERE kind = 'addon' AND is_active = 1 AND id IN (${placeholders})
    `).bind(...uniqueAddonIds).all<{ id: number; name: string; fixed_price: number | null }>();
    addons = result.results;
    if (addons.length !== uniqueAddonIds.length) return badRequest('Одна из дополнительных услуг недоступна');
  }

  const slot = await availability(env, payload.date);
  const selectedSlot = slot.slots.find((entry) => entry.time === payload.time);
  if (!selectedSlot?.available) return badRequest('Это время уже недоступно. Выберите другое');

  const photos = form.getAll('photos').filter((item): item is File => item instanceof File);
  if (photos.length < 1) return badRequest('Добавьте минимум одну фотографию объекта');
  if (photos.length > MAX_PHOTOS) return badRequest(`Можно загрузить не более ${MAX_PHOTOS} фотографий`);
  for (const photo of photos) {
    if (!ALLOWED_MIME.has(photo.type)) return badRequest('Поддерживаются только фотографии');
    if (photo.size > MAX_PHOTO_BYTES) return badRequest('Одна из фотографий слишком большая');
  }

  const phone = normalizePhone(payload.phone);
  const estimatedPrice = Math.round(
    (service.price_per_m2 || 0) * payload.area + addons.reduce((sum, addon) => sum + (addon.fixed_price || 0), 0),
  );

  const insert = await env.DB.prepare(`
    INSERT INTO orders (
      user_id, service_id, property_type, area, rooms, bathrooms, pets,
      city, address, apartment, entrance, floor, address_comment,
      date, time, customer_name, phone, comment, status, estimated_price, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?)
  `).bind(
    auth.dbUserId, payload.serviceId, payload.propertyType, payload.area, payload.rooms, payload.bathrooms,
    payload.pets ? 1 : 0, payload.city.trim(), payload.address.trim(), payload.apartment?.trim() || null,
    payload.entrance?.trim() || null, payload.floor?.trim() || null, payload.addressComment?.trim() || null,
    payload.date, payload.time, payload.customerName.trim(), phone, payload.comment?.trim() || null,
    estimatedPrice || null, payload.idempotencyKey,
  ).run();

  const orderId = Number(insert.meta.last_row_id);
  if (!orderId) return json({ ok: false, error: 'Не удалось создать заявку' }, 500);
  const compactDate = payload.date.replaceAll('-', '').slice(2);
  const orderNumber = `HC-${compactDate}-${String(orderId).padStart(4, '0')}`;
  await env.DB.prepare('UPDATE orders SET order_number = ? WHERE id = ?').bind(orderNumber, orderId).run();

  const uploadedKeys: string[] = [];
  try {
    const statements: D1PreparedStatement[] = [];
    for (const addon of addons) {
      statements.push(env.DB.prepare('INSERT INTO order_services (order_id, service_id) VALUES (?, ?)').bind(orderId, addon.id));
    }

    for (let index = 0; index < photos.length; index++) {
      const photo = photos[index];
      const ext = photo.type.includes('png') ? 'png' : photo.type.includes('webp') ? 'webp' : photo.type.includes('heic') ? 'heic' : 'jpg';
      const key = `${auth.telegramUser.id}/${orderId}/${crypto.randomUUID()}.${ext}`;
      await env.PHOTOS.put(key, photo.stream(), { httpMetadata: { contentType: photo.type } });
      uploadedKeys.push(key);
      statements.push(env.DB.prepare(`
        INSERT INTO order_photos (order_id, object_key, mime_type, size_bytes, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `).bind(orderId, key, photo.type, photo.size, index));
    }
    if (statements.length) await env.DB.batch(statements);
  } catch (error) {
    console.error('Photo/order attachment failure', error);
    await Promise.all(uploadedKeys.map((key) => env.PHOTOS.delete(key)));
    await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run();
    return json({ ok: false, error: 'Не удалось загрузить фотографии. Попробуйте ещё раз' }, 500);
  }

  await env.DB.prepare(`UPDATE users SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(payload.customerName.trim(), phone, auth.dbUserId).run();

  const userText = `<b>HOUSE CLEANING</b>\n\nЗаявка <b>${orderNumber}</b> получена.\n\n${payload.date} · ${payload.time}\n${payload.city}, ${payload.address}\n\nМы сообщим вам после подтверждения.`;
  await sendTelegramMessage(env, auth.telegramUser.id, userText);

  const adminText = `<b>НОВАЯ ЗАЯВКА</b>\n\n<b>${orderNumber}</b>\nКлиент: ${escapeHtml(payload.customerName)}\nТелефон: ${escapeHtml(phone)}\nУборка: ${escapeHtml(service.name)}\nПлощадь: ${payload.area} м²\nДата: ${payload.date}\nВремя: ${payload.time}\nАдрес: ${escapeHtml(`${payload.city}, ${payload.address}`)}\nФото: ${photos.length}`;
  const botUsername = (env.BOT_USERNAME || '').replace(/^@/, '');
  const markup = {
    inline_keyboard: [
      [{ text: 'Подтвердить', callback_data: `confirm:${orderId}` }],
      [{ text: 'Открыть в Mini App', url: `https://t.me/${botUsername}?startapp=order_${orderId}` }],
      [{ text: 'Связаться', url: `tg://user?id=${auth.telegramUser.id}` }],
    ],
  };
  await Promise.all([...adminIds(env)].map((adminId) => sendTelegramMessage(env, adminId, adminText, markup)));

  return json({ ok: true, order: { id: orderId, order_number: orderNumber } }, 201);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

async function listOrders(request: Request, env: Env) {
  const auth = await requireAuth(request, env);
  const result = await env.DB.prepare(`
    SELECT o.id, o.order_number, o.status, o.property_type, o.area, o.city, o.address, o.date, o.time,
           o.customer_name, o.estimated_price, s.name AS service_name,
           (SELECT COUNT(*) FROM order_photos p WHERE p.order_id = o.id) AS photo_count,
           (SELECT GROUP_CONCAT(p2.id) FROM order_photos p2 WHERE p2.order_id = o.id) AS photo_ids
    FROM orders o JOIN services s ON s.id = o.service_id
    WHERE o.user_id = ? ORDER BY o.created_at DESC
  `).bind(auth.dbUserId).all();
  return json({ ok: true, orders: result.results });
}

async function orderDetails(request: Request, env: Env, id: number) {
  const auth = await requireAuth(request, env);
  const order = await env.DB.prepare(`
    SELECT o.*, s.name AS service_name FROM orders o
    JOIN services s ON s.id = o.service_id
    WHERE o.id = ? AND o.user_id = ?
  `).bind(id, auth.dbUserId).first();
  if (!order) return notFound();

  const addons = await env.DB.prepare(`
    SELECT s.id, s.name, s.fixed_price FROM order_services os
    JOIN services s ON s.id = os.service_id WHERE os.order_id = ? ORDER BY s.sort_order, s.id
  `).bind(id).all();
  const photos = await env.DB.prepare(`SELECT id, sort_order FROM order_photos WHERE order_id = ? ORDER BY sort_order, id`)
    .bind(id).all();
  return json({ ok: true, order, addons: addons.results, photos: photos.results });
}

async function photoResponse(request: Request, env: Env, orderId: number, photoId: number) {
  const auth = await requireAuth(request, env);
  const row = await env.DB.prepare(`
    SELECT p.object_key, p.mime_type FROM order_photos p
    JOIN orders o ON o.id = p.order_id
    WHERE p.id = ? AND p.order_id = ? AND o.user_id = ?
  `).bind(photoId, orderId, auth.dbUserId).first<{ object_key: string; mime_type: string }>();
  if (!row) return notFound();
  const object = await env.PHOTOS.get(row.object_key);
  if (!object) return notFound();
  return new Response(object.body, { headers: { 'Content-Type': row.mime_type, 'Cache-Control': 'private, max-age=300' } });
}

async function cancelOrder(request: Request, env: Env, id: number) {
  const auth = await requireAuth(request, env);
  const order = await env.DB.prepare('SELECT id, order_number, status FROM orders WHERE id = ? AND user_id = ?')
    .bind(id, auth.dbUserId).first<{ id: number; order_number: string; status: string }>();
  if (!order) return notFound();
  if (!['NEW', 'REVIEW'].includes(order.status)) return badRequest('Эту заявку уже нельзя отменить самостоятельно');
  await env.DB.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  await sendTelegramMessage(env, auth.telegramUser.id, `<b>HOUSE CLEANING</b>\n\nЗаявка <b>${order.order_number}</b> отменена.`);
  return json({ ok: true });
}

async function telegramWebhook(request: Request, env: Env) {
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return unauthorized();
  const update = await request.json() as any;
  const callback = update.callback_query;
  if (!callback) return json({ ok: true });
  const adminId = Number(callback.from?.id || 0);
  if (!adminIds(env).has(adminId)) {
    await answerCallback(env, callback.id, 'Недостаточно прав');
    return json({ ok: true });
  }

  const [action, rawId] = String(callback.data || '').split(':');
  const orderId = Number(rawId);
  if (action !== 'confirm' || !Number.isInteger(orderId)) return json({ ok: true });

  const order = await env.DB.prepare(`
    SELECT o.id, o.order_number, o.status, u.telegram_id FROM orders o
    JOIN users u ON u.id = o.user_id WHERE o.id = ?
  `).bind(orderId).first<{ id: number; order_number: string; status: string; telegram_id: number }>();
  if (!order) {
    await answerCallback(env, callback.id, 'Заявка не найдена');
    return json({ ok: true });
  }

  if (['CANCELLED', 'COMPLETED'].includes(order.status)) {
    await answerCallback(env, callback.id, 'Статус уже изменён');
    return json({ ok: true });
  }

  await env.DB.prepare(`UPDATE orders SET status = 'CONFIRMED', updated_at = datetime('now') WHERE id = ?`).bind(orderId).run();
  await answerCallback(env, callback.id, 'Заявка подтверждена');
  await sendTelegramMessage(env, order.telegram_id, `<b>HOUSE CLEANING</b>\n\nВаша заявка <b>${order.order_number}</b> подтверждена.`);
  return json({ ok: true });
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
      const auth = await requireAuth(request, env);
      const [user, services] = await Promise.all([getUser(env, auth.dbUserId), getServices(env)]);
      return json({ ok: true, user, services, config: { maxPhotos: MAX_PHOTOS, minArea: 10, maxArea: 5000, botUsername: (env.BOT_USERNAME || '').replace(/^@/, '') } });
    }

    if (url.pathname === '/api/me' && request.method === 'PATCH') {
      const auth = await requireAuth(request, env);
      const body = await request.json() as { name?: string; phone?: string };
      const name = (body.name || '').trim().slice(0, 120);
      const phone = normalizePhone(body.phone || '');
      if (!name || phone.length < 10) return badRequest('Проверьте имя и телефон');
      await env.DB.prepare(`UPDATE users SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(name, phone, auth.dbUserId).run();
      return json({ ok: true });
    }

    if (url.pathname === '/api/availability' && request.method === 'GET') {
      await requireAuth(request, env);
      return json({ ok: true, ...(await availability(env, url.searchParams.get('date') || '')) });
    }

    if (url.pathname === '/api/orders' && request.method === 'POST') return createOrder(request, env);
    if (url.pathname === '/api/orders' && request.method === 'GET') return listOrders(request, env);

    const orderMatch = url.pathname.match(/^\/api\/orders\/(\d+)$/);
    if (orderMatch && request.method === 'GET') return orderDetails(request, env, Number(orderMatch[1]));

    const cancelMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
    if (cancelMatch && request.method === 'POST') return cancelOrder(request, env, Number(cancelMatch[1]));

    const photoMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/photos\/(\d+)$/);
    if (photoMatch && request.method === 'GET') return photoResponse(request, env, Number(photoMatch[1]), Number(photoMatch[2]));

    return notFound();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('API error', message);
    if (message.includes('Telegram')) return unauthorized(message);
    return json({ ok: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/telegram/webhook' && request.method === 'POST') return telegramWebhook(request, env);
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
