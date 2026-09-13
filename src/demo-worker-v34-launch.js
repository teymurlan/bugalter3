import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v33-raw-order-photos.js';

export { ConsentStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const RELEASE_CUTOFF = '2026-09-13T10:10:00.000Z';
const CONSENT_VERSION = '2026-09-09-v1';
let schemaReady = false;

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/release/init' && request.method === 'POST') {
      const markerKey = 'release:v1:initialized';
      const existing = await this.state.storage.get(markerKey);
      if (existing) return json({ ok: true, already: true, marked: Number(existing.marked || 0) });
      const rows = await this.state.storage.list({ prefix: 'order:' });
      let marked = 0;
      for (const [key, order] of rows.entries()) {
        const createdAt = String(order?.created_at || '');
        if (!createdAt || createdAt >= RELEASE_CUTOFF || order?.is_test) continue;
        await this.state.storage.put(key, { ...order, is_test: true, prelaunch_test: true, updated_at: new Date().toISOString() });
        marked += 1;
      }
      await this.state.storage.put(markerKey, { marked, cutoff: RELEASE_CUTOFF, created_at: new Date().toISOString() });
      return json({ ok: true, already: false, marked });
    }

    if (url.pathname === '/draft/get' && request.method === 'GET') {
      const userId = positiveInt(url.searchParams.get('user'));
      if (!userId) return json({ ok: false }, 400);
      const draft = await this.state.storage.get(`draft:${userId}`);
      return json({ ok: true, draft: draft || null });
    }

    if (url.pathname === '/draft/save' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const userId = positiveInt(body.user_id);
      if (!userId || !body.draft || typeof body.draft !== 'object') return json({ ok: false }, 400);
      const row = { ...body.draft, updated_at: new Date().toISOString() };
      await this.state.storage.put(`draft:${userId}`, row);
      return json({ ok: true, draft: row });
    }

    if (url.pathname === '/draft/delete' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const userId = positiveInt(body.user_id);
      if (userId) await this.state.storage.delete(`draft:${userId}`);
      return json({ ok: true });
    }

    return super.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      await ensureReleaseInit(env);
    }

    if (url.pathname === '/api/admin-system-health' && request.method === 'GET') {
      const admin = await authorizedAdmin(request, env, ctx);
      if (!admin) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      const binding = findD1(env);
      let d1Ok = false;
      let rows = null;
      if (binding) {
        try {
          await ensureD1Schema(binding.db);
          const result = await binding.db.prepare('SELECT COUNT(*) AS count FROM hc_orders').first();
          rows = Number(result?.count || 0);
          d1Ok = true;
        } catch (error) {
          console.error('D1 health failed', error);
        }
      }
      return json({
        ok: true,
        worker: 'v34-launch',
        d1_connected: Boolean(binding),
        d1_binding: binding?.name || null,
        d1_ready: d1Ok,
        d1_orders: rows,
        durable_objects: Boolean(env.APP_STORE && env.CONSENT_STORE),
        photo_storage: 'telegram_file_id',
      });
    }

    if (url.pathname === '/api/client-draft' && ['GET', 'PUT', 'DELETE'].includes(request.method)) {
      const user = await authorizedUser(request, env, ctx);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      const binding = findD1(env);
      if (binding) {
        try {
          await ensureD1Schema(binding.db);
          if (request.method === 'GET') {
            const row = await binding.db.prepare('SELECT draft_json FROM hc_drafts WHERE telegram_id = ?').bind(Number(user.id)).first();
            return json({ ok: true, draft: row?.draft_json ? JSON.parse(row.draft_json) : null, storage: 'd1' });
          }
          if (request.method === 'DELETE') {
            await binding.db.prepare('DELETE FROM hc_drafts WHERE telegram_id = ?').bind(Number(user.id)).run();
            await appStub(env)?.fetch('https://app.internal/draft/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_id: user.id }) });
            return json({ ok: true, storage: 'd1' });
          }
          let body = {};
          try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректный черновик' }, 400); }
          const draft = sanitizeDraft(body.draft || body);
          await binding.db.prepare('INSERT INTO hc_drafts (telegram_id, draft_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET draft_json=excluded.draft_json, updated_at=excluded.updated_at')
            .bind(Number(user.id), JSON.stringify(draft), new Date().toISOString()).run();
          await appStub(env)?.fetch('https://app.internal/draft/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_id: user.id, draft }) });
          return json({ ok: true, draft, storage: 'd1' });
        } catch (error) {
          console.error('D1 draft failed, falling back', error);
        }
      }
      const stub = appStub(env);
      if (!stub) return json({ ok: false, error: 'Draft storage unavailable' }, 503);
      if (request.method === 'GET') return proxy(await stub.fetch(`https://app.internal/draft/get?user=${encodeURIComponent(user.id)}`));
      if (request.method === 'DELETE') return proxy(await stub.fetch('https://app.internal/draft/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_id: user.id }) }));
      let body = {};
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректный черновик' }, 400); }
      const draft = sanitizeDraft(body.draft || body);
      return proxy(await stub.fetch('https://app.internal/draft/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_id: user.id, draft }) }));
    }

    if (url.pathname === '/api/public-reviews' && request.method === 'GET') {
      const user = await authorizedUser(request, env, ctx);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      const response = await appStub(env)?.fetch('https://app.internal/review/list');
      if (!response?.ok) return json({ ok: true, reviews: [], average: 0, count: 0 });
      const data = await response.json();
      const reviews = (Array.isArray(data.reviews) ? data.reviews : []).map((item) => ({
        order_number: item.order_number,
        name: publicName(item.customer_name),
        rating: Number(item.rating || 0),
        text: String(item.text || ''),
        created_at: item.created_at || null,
        photo_count: Array.isArray(item.photo_file_ids) ? item.photo_file_ids.length : 0,
      })).filter((item) => item.rating >= 1 && item.rating <= 5);
      const average = reviews.length ? reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length : 0;
      return json({ ok: true, reviews, average: Number(average.toFixed(1)), count: reviews.length });
    }

    if (url.pathname === '/api/demo-order-media' && request.method === 'POST') {
      return handleOrderMedia(request, env, ctx, url.origin);
    }

    if (url.pathname === '/api/demo-review-v2' && request.method === 'POST') {
      return handleReviewV2(request, env, ctx);
    }

    if (url.pathname === '/api/admin-create-test-order' && request.method === 'POST') {
      const admin = await authorizedAdmin(request, env, ctx);
      if (!admin) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      let body = {};
      try { body = await request.json(); } catch {}
      const now = new Date();
      const date = String(body.date || new Date(now.getTime() + 86400000).toISOString().slice(0, 10));
      const number = `TEST-${Date.now().toString(36).toUpperCase()}`;
      const order = {
        order_number: number,
        status: 'NEW',
        service_name: String(body.service_name || 'Тестовая уборка'),
        area: Math.max(10, Number(body.area || 50)),
        city: 'Санкт-Петербург',
        address: String(body.address || 'Тестовый адрес, 1'),
        apartment: String(body.apartment || '1'),
        date,
        time: String(body.time || '12:00'),
        customer_name: 'ТЕСТ · Администратор',
        phone: '',
        contact_method: 'telegram',
        addon_names: [],
        photo_count: 0,
        estimated_price: 0,
        client_telegram_id: Number(admin.id),
        created_at: new Date().toISOString(),
        is_test: true,
      };
      const stored = await appPutOrder(env, order);
      await mirrorOrder(env, stored || order);
      return json({ ok: true, order: stored || order });
    }

    if (url.pathname === '/api/client-benefits' && request.method === 'GET') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const data = await response.json().catch(() => ({}));
      const referral = Math.max(0, Number(data.referral_percent || data.friend_discount_percent || (Number(data.available_referral_rewards || 0) > 0 ? 15 : 0)));
      return json({ ...data, loyalty_percent: 0, selected_percent: referral, selected_type: referral ? (data.friend_discount_percent ? 'referral_friend' : 'referral_reward') : 'none' });
    }

    if (url.pathname === '/api/demo-client-orders' && request.method === 'GET') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const data = await response.json().catch(() => ({}));
      const orders = (Array.isArray(data.orders) ? data.orders : []).filter((order) => !order?.is_test);
      return json({ ...data, orders });
    }

    if (url.pathname === '/api/demo-admin-orders' && request.method === 'GET') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const data = await response.json().catch(() => ({}));
      const includeTest = url.searchParams.get('include_test') === '1';
      const orders = (Array.isArray(data.orders) ? data.orders : []).filter((order) => includeTest || !order?.is_test);
      return json({ ...data, orders });
    }

    let bodyCopy = null;
    if (request.method !== 'GET' && ['application/json'].some((type) => String(request.headers.get('content-type') || '').includes(type))) {
      try { bodyCopy = await request.clone().json(); } catch {}
    }

    const response = await baseWorker.fetch(request, env, ctx);

    if (response.ok) {
      ctx?.waitUntil?.(mirrorFromResponse(env, url, request.method, bodyCopy, response.clone()));
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function handleOrderMedia(request, env, ctx, origin) {
  const user = await authorizedUser(request, env, ctx);
  if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
  let body = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректные фотографии' }, 400); }
  const number = cleanOrderNumber(body.order_number);
  const order = await appOrder(env, user.id, number);
  if (!order) return json({ ok: false, error: 'Заявка не найдена' }, 404);
  const photos = decodePhotos(body.photos, 10);
  if (!photos.length) return json({ ok: false, error: 'Фотографии не найдены' }, 400);
  const ids = adminIds(env);
  if (!ids.length) return json({ ok: false, error: 'Администратор не настроен' }, 503);

  const caption = orderCaption(order, user);
  const delivered = [];
  const errors = [];
  let fileIds = [];
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    try {
      if (i === 0) fileIds = await sendAlbumRaw(env, Number(id), photos, caption);
      else await sendAlbumByIds(env, Number(id), fileIds, caption);
      delivered.push(id);
    } catch (error) {
      errors.push(String(error?.message || error));
    }
  }
  if (!delivered.length || !fileIds.length) return json({ ok: false, error: `Не удалось отправить фотографии администратору${errors[0] ? `: ${errors[0]}` : ''}` }, 502);

  const stored = await appPutOrder(env, { ...order, photo_count: fileIds.length, photo_file_ids: fileIds });
  await mirrorOrder(env, stored || order);
  return json({ ok: true, adminNotified: delivered.length, adminErrors: errors, photo_file_ids: fileIds, order: stored || order });
}

async function handleReviewV2(request, env, ctx) {
  const user = await authorizedUser(request, env, ctx);
  if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
  let body = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректный отзыв' }, 400); }
  const orderNumber = cleanOrderNumber(body.order_number);
  const rating = Math.max(1, Math.min(5, Number(body.rating || 0)));
  const text = String(body.text || '').trim().slice(0, 2500);
  if (!orderNumber || !Number.isInteger(rating)) return json({ ok: false, error: 'Поставьте оценку от 1 до 5 звёзд' }, 400);
  const order = await appOrder(env, user.id, orderNumber);
  if (!order || order.status !== 'COMPLETED') return json({ ok: false, error: 'Отзыв доступен только после завершённой уборки' }, 403);
  const stub = appStub(env);
  const existing = await stub?.fetch(`https://app.internal/review/get?user=${encodeURIComponent(user.id)}&order=${encodeURIComponent(orderNumber)}`);
  if (existing?.ok) return json({ ok: false, error: 'Отзыв по этой заявке уже отправлен' }, 409);

  const photos = decodePhotos(body.photos, 5);
  const mainAdmin = primaryAdminId(env);
  const caption = reviewCaption({ orderNumber, customerName: order.customer_name || user.first_name || 'Клиент', rating, text });
  let photoFileIds = [];
  if (mainAdmin) {
    try {
      if (photos.length) photoFileIds = await sendAlbumRaw(env, Number(mainAdmin), photos, caption);
      else await telegram(env, 'sendMessage', { chat_id: Number(mainAdmin), text: caption, parse_mode: 'HTML' });
    } catch (error) {
      console.error('Review delivery failed', error);
    }
  }

  const payload = {
    client_telegram_id: Number(user.id),
    order_number: orderNumber,
    customer_name: order.customer_name || user.first_name || 'Клиент',
    rating,
    text,
    photo_file_ids: photoFileIds,
  };
  const storedResponse = await stub?.fetch('https://app.internal/review/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!storedResponse?.ok) {
    const data = await storedResponse?.json().catch(() => ({}));
    return json({ ok: false, error: data?.error || 'Не удалось сохранить отзыв' }, storedResponse?.status || 500);
  }
  const review = (await storedResponse.json()).review;
  await mirrorReview(env, review);
  return json({ ok: true, review });
}

async function mirrorFromResponse(env, url, method, body, response) {
  try {
    if (url.pathname === '/api/demo-order' && method === 'POST') {
      const data = await response.json().catch(() => ({}));
      if (data?.order) await mirrorOrder(env, data.order);
      return;
    }
    if (url.pathname === '/api/demo-order-status' && method === 'POST') {
      const data = await response.json().catch(() => ({}));
      if (data?.order) await mirrorOrder(env, data.order);
      else if (body?.order) await mirrorOrder(env, { ...body.order, status: body.status || body.order.status });
      return;
    }
    if (url.pathname === '/api/client-profile' && method === 'PATCH') {
      const data = await response.json().catch(() => ({}));
      if (data?.profile) await mirrorProfile(env, data.profile);
      return;
    }
    if (url.pathname === '/api/referral-dashboard' && method === 'GET') {
      const data = await response.json().catch(() => ({}));
      await mirrorReferrals(env, data?.referrals || []);
    }
  } catch (error) {
    console.error('D1 mirror skipped', error);
  }
}

function findD1(env) {
  const preferred = [['DB', env.DB], ['D1', env.D1], ['DATABASE', env.DATABASE]];
  for (const [name, value] of preferred) if (value && typeof value.prepare === 'function') return { name, db: value };
  for (const [name, value] of Object.entries(env || {})) {
    if (value && typeof value.prepare === 'function' && typeof value.batch === 'function') return { name, db: value };
  }
  return null;
}

async function ensureD1Schema(db) {
  if (schemaReady || !db) return;
  const statements = [
    'CREATE TABLE IF NOT EXISTS hc_clients (telegram_id INTEGER PRIMARY KEY, profile_json TEXT NOT NULL, updated_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS hc_orders (order_number TEXT PRIMARY KEY, client_telegram_id INTEGER, status TEXT, service_name TEXT, area REAL, date TEXT, time TEXT, address_key TEXT, is_test INTEGER DEFAULT 0, order_json TEXT NOT NULL, updated_at TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS hc_orders_client_idx ON hc_orders(client_telegram_id, status, date)',
    'CREATE TABLE IF NOT EXISTS hc_reviews (order_number TEXT NOT NULL, client_telegram_id INTEGER NOT NULL, rating REAL NOT NULL, review_json TEXT NOT NULL, created_at TEXT, PRIMARY KEY(order_number, client_telegram_id))',
    'CREATE TABLE IF NOT EXISTS hc_referrals (inviter_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, referral_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(inviter_id, friend_id))',
    'CREATE TABLE IF NOT EXISTS hc_drafts (telegram_id INTEGER PRIMARY KEY, draft_json TEXT NOT NULL, updated_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS hc_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data_json TEXT, created_at TEXT NOT NULL)',
  ];
  for (const sql of statements) await db.prepare(sql).run();
  schemaReady = true;
}

async function mirrorOrder(env, order) {
  const binding = findD1(env);
  if (!binding || !order?.order_number) return;
  await ensureD1Schema(binding.db);
  const now = new Date().toISOString();
  await binding.db.prepare('INSERT INTO hc_orders (order_number, client_telegram_id, status, service_name, area, date, time, address_key, is_test, order_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(order_number) DO UPDATE SET client_telegram_id=excluded.client_telegram_id, status=excluded.status, service_name=excluded.service_name, area=excluded.area, date=excluded.date, time=excluded.time, address_key=excluded.address_key, is_test=excluded.is_test, order_json=excluded.order_json, updated_at=excluded.updated_at')
    .bind(String(order.order_number), Number(order.client_telegram_id || 0), String(order.status || ''), String(order.service_name || ''), Number(order.area || 0), String(order.date || ''), String(order.time || ''), addressKey(order), order.is_test ? 1 : 0, JSON.stringify(order), now).run();
}

async function mirrorProfile(env, profile) {
  const binding = findD1(env);
  if (!binding || !profile?.telegram_id) return;
  await ensureD1Schema(binding.db);
  await binding.db.prepare('INSERT INTO hc_clients (telegram_id, profile_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET profile_json=excluded.profile_json, updated_at=excluded.updated_at')
    .bind(Number(profile.telegram_id), JSON.stringify(profile), new Date().toISOString()).run();
}

async function mirrorReview(env, review) {
  const binding = findD1(env);
  if (!binding || !review?.order_number || !review?.client_telegram_id) return;
  await ensureD1Schema(binding.db);
  await binding.db.prepare('INSERT INTO hc_reviews (order_number, client_telegram_id, rating, review_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(order_number, client_telegram_id) DO UPDATE SET rating=excluded.rating, review_json=excluded.review_json, created_at=excluded.created_at')
    .bind(String(review.order_number), Number(review.client_telegram_id), Number(review.rating || 0), JSON.stringify(review), String(review.created_at || new Date().toISOString())).run();
}

async function mirrorReferrals(env, referrals) {
  const binding = findD1(env);
  if (!binding || !Array.isArray(referrals)) return;
  await ensureD1Schema(binding.db);
  for (const item of referrals) {
    if (!item?.inviter_id || !item?.friend_id) continue;
    await binding.db.prepare('INSERT INTO hc_referrals (inviter_id, friend_id, referral_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(inviter_id, friend_id) DO UPDATE SET referral_json=excluded.referral_json, updated_at=excluded.updated_at')
      .bind(Number(item.inviter_id), Number(item.friend_id), JSON.stringify(item), new Date().toISOString()).run();
  }
}

async function ensureReleaseInit(env) {
  try { await appStub(env)?.fetch('https://app.internal/release/init', { method: 'POST' }); } catch {}
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function appOrder(env, userId, number) {
  const response = await appStub(env)?.fetch(`https://app.internal/order?user=${encodeURIComponent(userId)}&number=${encodeURIComponent(number)}`);
  return response?.ok ? response.json() : null;
}

async function appPutOrder(env, order) {
  const response = await appStub(env)?.fetch('https://app.internal/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order) });
  if (!response?.ok) return order;
  return (await response.json()).order || order;
}

async function authorizedUser(request, env, ctx) {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  if (!initData) return null;
  const gateUrl = new URL(request.url);
  gateUrl.pathname = '/api/referral-dashboard';
  gateUrl.search = '';
  const gate = await baseWorker.fetch(new Request(gateUrl, { method: 'GET', headers: { 'X-Telegram-Init-Data': initData } }), env, ctx);
  if (!gate.ok) return null;
  try {
    const user = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
    return positiveInt(user?.id) ? user : null;
  } catch { return null; }
}

async function authorizedAdmin(request, env, ctx) {
  const user = await authorizedUser(request, env, ctx);
  if (!user) return null;
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const gateUrl = new URL(request.url);
  gateUrl.pathname = '/api/demo-admin-orders';
  gateUrl.search = '';
  const gate = await baseWorker.fetch(new Request(gateUrl, { headers: { 'X-Telegram-Init-Data': initData } }), env, ctx);
  return gate.ok ? user : null;
}

function decodePhotos(items, limit) {
  const out = [];
  for (const item of Array.isArray(items) ? items.slice(0, limit) : []) {
    try {
      const type = String(item.type || 'image/jpeg').startsWith('image/') ? String(item.type) : 'image/jpeg';
      const data = String(item.data || '').replace(/^data:[^,]+,/, '');
      if (!data) continue;
      const raw = atob(data);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      if (!bytes.length || bytes.length > 12 * 1024 * 1024) continue;
      out.push({ blob: new Blob([bytes], { type }), name: safeFilename(item.name || `photo-${out.length + 1}.jpg`) });
    } catch {}
  }
  return out;
}

async function sendAlbumRaw(env, chatId, photos, caption) {
  if (photos.length === 1) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('parse_mode', 'HTML');
    form.append('caption', caption.slice(0, 1024));
    form.append('photo', photos[0].blob, photos[0].name);
    const message = await telegramMultipart(env, 'sendPhoto', form);
    const id = largestPhotoId(message);
    return id ? [id] : [];
  }
  const form = new FormData();
  form.append('chat_id', String(chatId));
  const media = photos.map((_, index) => ({ type: 'photo', media: `attach://photo${index}`, ...(index === 0 ? { caption: caption.slice(0, 1024), parse_mode: 'HTML' } : {}) }));
  form.append('media', JSON.stringify(media));
  photos.forEach((photo, index) => form.append(`photo${index}`, photo.blob, photo.name));
  const messages = await telegramMultipart(env, 'sendMediaGroup', form);
  return Array.isArray(messages) ? messages.map(largestPhotoId).filter(Boolean) : [];
}

async function sendAlbumByIds(env, chatId, ids, caption) {
  if (!ids.length) return;
  if (ids.length === 1) return telegram(env, 'sendPhoto', { chat_id: chatId, photo: ids[0], caption: caption.slice(0, 1024), parse_mode: 'HTML' });
  return telegram(env, 'sendMediaGroup', { chat_id: chatId, media: ids.map((id, index) => ({ type: 'photo', media: id, ...(index === 0 ? { caption: caption.slice(0, 1024), parse_mode: 'HTML' } : {}) })) });
}

function orderCaption(order, user) {
  const address = [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : ''].filter(Boolean).join(', ');
  return [
    '<b>НОВАЯ ЗАЯВКА · HOUSE CLEANING</b>',
    `<b>${escapeHtml(order.order_number)}</b>`,
    `Клиент: <b>${escapeHtml(order.customer_name || user.first_name || 'Клиент')}</b>`,
    order.phone ? `Телефон: ${escapeHtml(order.phone)}` : '',
    `Уборка: ${escapeHtml(order.service_name || 'Уборка')}`,
    `Площадь: <b>${Number(order.area || 0)} м²</b>`,
    `Дата: <b>${formatDate(order.date)}</b> · ${escapeHtml(String(order.time || '—').slice(0, 5))}`,
    `Адрес: ${escapeHtml(address)}`,
    order.addon_names?.length ? `Дополнительно: ${escapeHtml(order.addon_names.join(', '))}` : '',
    Number(order.discount_percent) > 0 ? `Скидка: <b>${Number(order.discount_percent)}%</b>` : '',
    Number(order.estimated_price) > 0 ? `Предварительно: <b>от ${money(order.estimated_price)}</b>` : '',
  ].filter(Boolean).join('\n');
}

function reviewCaption({ orderNumber, customerName, rating, text }) {
  return [
    '<b>НОВЫЙ ОТЗЫВ · HOUSE CLEANING</b>',
    `Заявка: <b>${escapeHtml(orderNumber)}</b>`,
    `Клиент: <b>${escapeHtml(customerName)}</b>`,
    `Оценка: <b>${Number(rating).toFixed(1)} / 5.0</b>`,
    text ? `Комментарий: ${escapeHtml(text)}` : 'Комментарий: нет',
  ].join('\n');
}

function sanitizeDraft(value) {
  const input = value && typeof value === 'object' ? value : {};
  const allowed = ['step','serviceId','propertyType','area','rooms','bathrooms','pets','addonIds','serviceArea','city','address','apartment','entrance','floor','addressComment','date','time','customerName','phone','contactMethod','comment','idempotencyKey','photoRequired','knownAddress'];
  const draft = {};
  for (const key of allowed) if (key in input) draft[key] = input[key];
  return draft;
}

function addressKey(order) {
  return [order?.city, order?.address, order?.apartment].map((value) => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim()).filter(Boolean).join('|');
}

function publicName(value) {
  const parts = String(value || 'Клиент').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || 'Клиент';
  return `${parts[0]} ${parts[1].charAt(0)}.`;
}

function safeFilename(value) { return String(value || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'photo.jpg'; }
function largestPhotoId(message) { const photos = Array.isArray(message?.photo) ? message.photo : []; return photos.length ? String(photos[photos.length - 1]?.file_id || '') : ''; }
function cleanOrderNumber(value) { const raw = String(value || '').trim(); return /^[A-Za-z0-9._-]{3,80}$/.test(raw) ? raw : ''; }
function positiveInt(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 0; }
function adminIds(env) { const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(','); return [...new Set(String(raw).split(/[;,\s]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v)))]; }
function primaryAdminId(env) { return adminIds(env)[0] || ''; }
function formatDate(value) { const raw = String(value || ''); const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}.${m[2]}.${m[1]}` : raw; }
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}
async function telegramMultipart(env, method, formData) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', body: formData });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' } }); }
async function proxy(response) { return new Response(await response.text(), { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json; charset=UTF-8', 'cache-control': 'no-store' } }); }
