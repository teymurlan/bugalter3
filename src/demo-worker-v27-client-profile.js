import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v26-referral-reservations.js';

export { ConsentStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const PROFILE_PREFIX = 'profile:item:';
const REVIEW_INVITE_PREFIX = 'review:invite:';

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/profile/get' && request.method === 'GET') {
      const userId = positiveInt(url.searchParams.get('user'));
      if (!userId) return json({ ok: false, error: 'Invalid user' }, 400);
      const profile = await this.state.storage.get(`${PROFILE_PREFIX}${userId}`);
      return json({ ok: true, profile: profile || null });
    }

    if (url.pathname === '/profile/save' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const userId = positiveInt(body.user_id);
      if (!userId) return json({ ok: false, error: 'Invalid user' }, 400);
      const previous = await this.state.storage.get(`${PROFILE_PREFIX}${userId}`) || {};
      const profile = sanitizeProfile({ ...previous, ...body.profile, telegram_id: userId });
      profile.updated_at = new Date().toISOString();
      await this.state.storage.put(`${PROFILE_PREFIX}${userId}`, profile);
      return json({ ok: true, profile });
    }

    if (url.pathname === '/profile/list' && request.method === 'GET') {
      const values = await this.state.storage.list({ prefix: PROFILE_PREFIX });
      return json({ ok: true, profiles: [...values.values()].filter(Boolean) });
    }

    return super.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/client-profile' && ['GET', 'PATCH'].includes(request.method)) {
      const user = await authorizedUser(request, env, ctx);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      const stub = appStub(env);
      if (!stub) return json({ ok: false, error: 'Profile storage unavailable' }, 503);

      if (request.method === 'GET') {
        const response = await stub.fetch(`https://app.internal/profile/get?user=${encodeURIComponent(user.id)}`);
        if (!response.ok) return proxy(response);
        const data = await response.json();
        return json({ ok: true, profile: data.profile || null });
      }

      let body = {};
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректные данные' }, 400); }
      const profile = sanitizeProfile({ ...body, telegram_id: user.id });
      const response = await stub.fetch('https://app.internal/profile/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, profile }),
      });
      return proxy(response);
    }

    if (url.pathname === '/api/demo-admin-orders' && request.method === 'GET') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const data = await response.json().catch(() => ({}));
      const profilesResponse = await appStub(env)?.fetch('https://app.internal/profile/list');
      if (!profilesResponse?.ok) return json(data);
      const profiles = (await profilesResponse.json()).profiles || [];
      const byId = new Map(profiles.map((profile) => [String(profile.telegram_id || ''), profile]));
      const orders = (Array.isArray(data.orders) ? data.orders : []).map((order) => {
        const profile = byId.get(String(order.client_telegram_id || ''));
        if (!profile) return order;
        return {
          ...order,
          profile_phone2: profile.phone2 || '',
          profile_region: profile.region || '',
          profile_locality: profile.locality || '',
          profile_street: profile.street || '',
          profile_house: profile.house || '',
        };
      });
      return json({ ...data, orders });
    }

    if (url.pathname === '/api/demo-review' && request.method === 'POST') {
      return handleReviewCreate(request, env, ctx);
    }

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      let body = {};
      try { body = await request.clone().json(); } catch {}
      const clientId = positiveInt(body?.clientTelegramId || body?.order?.client_telegram_id);
      const orderNumber = cleanOrderNumber(body?.order?.order_number);
      const isCompleted = String(body?.status || '') === 'COMPLETED' && clientId && orderNumber;
      if (isCompleted) await markReviewInvite(env, clientId, orderNumber);
      const response = await baseWorker.fetch(request, env, ctx);
      if (response.ok && isCompleted) await sendReviewInvite(env, clientId, orderNumber, url.origin);
      return response;
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      let update = null;
      try { update = await request.clone().json(); } catch {}
      const match = /^hc:d:(\d+):(.+)$/.exec(String(update?.callback_query?.data || ''));
      let clientId = 0;
      let orderNumber = '';
      if (match) {
        clientId = positiveInt(match[1]);
        try { orderNumber = cleanOrderNumber(decodeURIComponent(match[2])); }
        catch { orderNumber = cleanOrderNumber(match[2]); }
        if (clientId && orderNumber) await markReviewInvite(env, clientId, orderNumber);
      }
      const response = await baseWorker.fetch(request, env, ctx);
      if (response.ok && clientId && orderNumber) await sendReviewInvite(env, clientId, orderNumber, url.origin);
      return response;
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleReviewCreate(request, env, ctx) {
  const user = await authorizedUser(request, env, ctx);
  if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);

  let form;
  try { form = await request.formData(); }
  catch { return json({ ok: false, error: 'Некорректная форма' }, 400); }

  const orderNumber = cleanOrderNumber(form.get('order_number'));
  const rating = Number(form.get('rating') || 0);
  const text = String(form.get('text') || '').trim().slice(0, 2500);
  const photos = form.getAll('photos').filter((item) => item instanceof File && item.size > 0).slice(0, 5);
  if (!orderNumber || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json({ ok: false, error: 'Поставьте оценку от 1 до 5 звёзд' }, 400);
  }

  const stub = appStub(env);
  if (!stub) return json({ ok: false, error: 'Storage unavailable' }, 503);
  const orderResponse = await stub.fetch(`https://app.internal/order?user=${encodeURIComponent(user.id)}&number=${encodeURIComponent(orderNumber)}`);
  if (!orderResponse.ok) return json({ ok: false, error: 'Заявка не найдена' }, 404);
  const order = await orderResponse.json();
  if (order?.status !== 'COMPLETED') return json({ ok: false, error: 'Отзыв доступен только после завершённой уборки' }, 403);

  const existing = await stub.fetch(`https://app.internal/review/get?user=${encodeURIComponent(user.id)}&order=${encodeURIComponent(orderNumber)}`);
  if (existing.ok) return json({ ok: false, error: 'Отзыв по этой заявке уже отправлен' }, 409);

  const mainAdmin = primaryAdminId(env);
  let photoFileIds = [];
  if (mainAdmin && photos.length) {
    try { photoFileIds = await uploadPhotoSet(env, Number(mainAdmin), photos); }
    catch (error) { console.error('Review photos failed', error); }
  }

  const payload = {
    client_telegram_id: Number(user.id),
    order_number: orderNumber,
    customer_name: order.customer_name || user.first_name || 'Клиент',
    rating,
    text,
    photo_file_ids: photoFileIds,
  };
  const storedResponse = await stub.fetch('https://app.internal/review/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!storedResponse.ok) {
    const data = await storedResponse.json().catch(() => ({}));
    return json({ ok: false, error: data?.error || 'Не удалось сохранить отзыв' }, storedResponse.status || 500);
  }
  const review = (await storedResponse.json()).review;

  if (mainAdmin) {
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    const lines = [
      '<b>НОВЫЙ ОТЗЫВ · HOUSE CLEANING</b>', '',
      `Заявка: <b>${escapeHtml(orderNumber)}</b>`,
      `Клиент: <b>${escapeHtml(review.customer_name)}</b>`,
      `Оценка: <b>${stars}</b>`, '',
      text ? `Комментарий:\n${escapeHtml(text)}` : 'Комментарий: нет', '',
      `Фото: ${photoFileIds.length ? photoFileIds.length : 'нет'}`,
    ];
    await safeTelegram(env, 'sendMessage', { chat_id: Number(mainAdmin), text: lines.join('\n'), parse_mode: 'HTML' });
  }

  return json({ ok: true, review });
}

async function markReviewInvite(env, clientId, orderNumber) {
  try {
    const stub = appStub(env);
    if (!stub) return;
    await stub.fetch('https://app.internal/review/invite-mark', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_telegram_id: clientId, order_number: orderNumber }),
    });
  } catch (error) {
    console.error('Review invite mark failed', error);
  }
}

async function sendReviewInvite(env, clientId, orderNumber, origin) {
  try {
    const stub = appStub(env);
    if (!stub) return false;
    const reviewCheck = await stub.fetch(`https://app.internal/review/get?user=${encodeURIComponent(clientId)}&order=${encodeURIComponent(orderNumber)}`);
    if (reviewCheck.ok) return false;
    return Boolean(await safeTelegram(env, 'sendMessage', {
      chat_id: clientId,
      text: ['🏠 <b>HOUSE CLEANING</b>', '', 'Уборка завершена ✨', '', 'Спасибо, что выбрали нас.', 'Оцените нашу работу — это займёт меньше минуты.'].join('\n'),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '⭐ Оставить отзыв',
          web_app: { url: `${origin}/?demo=1&review=${encodeURIComponent(orderNumber)}` },
          style: 'success',
        }]],
      },
    }));
  } catch (error) {
    console.error('Review invite failed', error);
    return false;
  }
}

function sanitizeProfile(value) {
  const profile = value && typeof value === 'object' ? value : {};
  const region = profile.region === 'lo' ? 'lo' : profile.region === 'spb' ? 'spb' : '';
  return {
    telegram_id: positiveInt(profile.telegram_id),
    name: clean(profile.name, 120),
    phone: clean(profile.phone, 40),
    phone2: clean(profile.phone2, 40),
    region,
    locality: clean(profile.locality, 120),
    street: clean(profile.street, 160),
    house: clean(profile.house, 40),
    apartment: clean(profile.apartment, 40),
    floor: clean(profile.floor, 20),
    entrance: clean(profile.entrance, 40),
  };
}

function clean(value, max = 160) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

async function authorizedUser(request, env, ctx) {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  if (!initData) return null;
  const gateUrl = new URL(request.url);
  gateUrl.pathname = '/api/referral-dashboard';
  gateUrl.search = '';
  const gate = await baseWorker.fetch(new Request(gateUrl, {
    method: 'GET',
    headers: { 'X-Telegram-Init-Data': initData },
  }), env, ctx);
  if (!gate.ok) return null;
  try {
    const user = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
    return positiveInt(user?.id) ? user : null;
  } catch { return null; }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

function primaryAdminId(env) {
  const values = [env.MAIN_ADMIN_TELEGRAM_ID, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID, env.ADMIN_TELEGRAM_IDS];
  for (const raw of values) {
    const first = String(raw || '').split(/[;,\s]+/).find((value) => /^-?\d+$/.test(value));
    if (first) return first;
  }
  return '';
}

async function uploadPhotoSet(env, chatId, files) {
  if (!files.length) return [];
  if (files.length === 1) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', files[0], files[0].name || 'review.jpg');
    const message = await telegramMultipart(env, 'sendPhoto', form);
    const id = largestPhotoId(message);
    return id ? [id] : [];
  }
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('media', JSON.stringify(files.map((_, index) => ({ type: 'photo', media: `attach://photo${index}` }))));
  files.forEach((file, index) => form.append(`photo${index}`, file, file.name || `review-${index + 1}.jpg`));
  const messages = await telegramMultipart(env, 'sendMediaGroup', form);
  return Array.isArray(messages) ? messages.map(largestPhotoId).filter(Boolean) : [];
}

function largestPhotoId(message) {
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  return photos.length ? String(photos[photos.length - 1]?.file_id || '') : '';
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

async function telegramMultipart(env, method, formData) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', body: formData });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
function cleanOrderNumber(value) {
  const next = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(next) ? next : '';
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}
function proxy(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
