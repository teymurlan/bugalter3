import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v22-bot-branding.js';

export { ConsentStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const REF_PERCENT = 15;

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/benefits' && request.method === 'GET') {
      const userId = positiveInt(url.searchParams.get('user'));
      if (!userId) return json({ ok: false, error: 'Invalid user' }, 400);
      return json({ ok: true, ...(await this.benefitsFor(userId)) });
    }

    if (url.pathname === '/review/save' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const clientId = positiveInt(body.client_telegram_id);
      const orderNumber = cleanOrderNumber(body.order_number);
      const rating = Math.max(1, Math.min(5, Number(body.rating || 0)));
      if (!clientId || !orderNumber || !Number.isInteger(rating)) return json({ ok: false, error: 'Invalid review' }, 400);
      const key = reviewKey(clientId, orderNumber);
      if (await this.state.storage.get(key)) return json({ ok: false, error: 'Review already exists' }, 409);
      const review = {
        client_telegram_id: clientId,
        order_number: orderNumber,
        customer_name: String(body.customer_name || 'Клиент').slice(0, 180),
        rating,
        text: String(body.text || '').trim().slice(0, 2500),
        photo_file_ids: Array.isArray(body.photo_file_ids) ? body.photo_file_ids.slice(0, 5).map(String) : [],
        created_at: new Date().toISOString(),
      };
      await this.state.storage.put(key, review);
      return json({ ok: true, review });
    }

    if (url.pathname === '/review/get' && request.method === 'GET') {
      const clientId = positiveInt(url.searchParams.get('user'));
      const orderNumber = cleanOrderNumber(url.searchParams.get('order'));
      if (!clientId || !orderNumber) return json(null, 404);
      const review = await this.state.storage.get(reviewKey(clientId, orderNumber));
      return review ? json(review) : json(null, 404);
    }

    if (url.pathname === '/review/list' && request.method === 'GET') {
      const values = await this.state.storage.list({ prefix: 'review:item:' });
      const reviews = [...values.values()].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return json({ ok: true, reviews });
    }

    if (url.pathname === '/review/invite-check' && request.method === 'GET') {
      const clientId = positiveInt(url.searchParams.get('user'));
      const orderNumber = cleanOrderNumber(url.searchParams.get('order'));
      if (!clientId || !orderNumber) return json({ ok: false, sent: false }, 400);
      const sent = Boolean(await this.state.storage.get(reviewInviteKey(clientId, orderNumber)));
      return json({ ok: true, sent });
    }

    if (url.pathname === '/review/invite-mark' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const clientId = positiveInt(body.client_telegram_id);
      const orderNumber = cleanOrderNumber(body.order_number);
      if (!clientId || !orderNumber) return json({ ok: false }, 400);
      await this.state.storage.put(reviewInviteKey(clientId, orderNumber), new Date().toISOString());
      return json({ ok: true });
    }

    if (url.pathname === '/ref/admin-list' && request.method === 'GET') {
      const invitesRaw = await this.state.storage.list({ prefix: 'ref:invite:' });
      const ordersRaw = await this.state.storage.list({ prefix: 'order:' });
      const orders = [...ordersRaw.values()];
      const unique = new Map();
      for (const item of invitesRaw.values()) {
        if (!item?.inviter_id || !item?.friend_id) continue;
        unique.set(`${item.inviter_id}:${item.friend_id}`, item);
      }
      const referrals = [];
      for (const item of unique.values()) {
        const friendOrders = orders.filter((o) => Number(o.client_telegram_id) === Number(item.friend_id));
        const inviterOrders = orders.filter((o) => Number(o.client_telegram_id) === Number(item.inviter_id));
        const created = friendOrders.length > 0;
        const confirmed = friendOrders.some((o) => ['CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(o.status));
        const completed = friendOrders.some((o) => o.status === 'COMPLETED');
        const rewardCount = Math.max(0, Number(await this.state.storage.get(`ref:reward-count:${item.inviter_id}`) || 0));
        const rewardUsed = Math.max(0, Number(await this.state.storage.get(`ref:reward-used:${item.inviter_id}`) || 0));
        referrals.push({
          inviter_id: item.inviter_id,
          inviter_name: inviterOrders[0]?.customer_name || `ID ${item.inviter_id}`,
          friend_id: item.friend_id,
          friend_name: friendOrders[0]?.customer_name || `ID ${item.friend_id}`,
          registered_at: item.registered_at || null,
          order_created: created,
          order_confirmed: confirmed,
          completed,
          friend_discount_percent: completed ? 0 : REF_PERCENT,
          inviter_rewarded: item.status === 'completed',
          inviter_rewards_available: Math.max(0, rewardCount - rewardUsed),
          inviter_rewards_used: rewardUsed,
        });
      }
      referrals.sort((a, b) => String(b.registered_at || '').localeCompare(String(a.registered_at || '')));
      return json({ ok: true, referrals });
    }

    return super.fetch(request);
  }

  async benefitsFor(userId) {
    const ordersRaw = await this.state.storage.list({ prefix: `order:${userId}:` });
    const orders = [...ordersRaw.values()];
    const completed = orders.filter((order) => order?.status === 'COMPLETED').length;
    const loyalty = completed >= 10 ? 10 : completed >= 3 ? 5 : 0;

    const friendReferral = await this.state.storage.get(`ref:friend:${userId}`);
    const rewardCount = Math.max(0, Number(await this.state.storage.get(`ref:reward-count:${userId}`) || 0));
    const rewardUsed = Math.max(0, Number(await this.state.storage.get(`ref:reward-used:${userId}`) || 0));
    const availableRewards = Math.max(0, rewardCount - rewardUsed);
    const friendDiscount = friendReferral && completed === 0 ? REF_PERCENT : 0;
    const referral = friendDiscount || (availableRewards > 0 ? REF_PERCENT : 0);
    const selected = Math.max(loyalty, referral);
    const selectedType = selected === 0
      ? 'none'
      : referral >= loyalty && referral > 0
        ? (friendDiscount ? 'referral_friend' : 'referral_reward')
        : 'loyalty';

    return {
      completed_orders: completed,
      loyalty_percent: loyalty,
      friend_discount_percent: friendDiscount,
      available_referral_rewards: availableRewards,
      referral_percent: referral,
      selected_percent: selected,
      selected_type: selectedType,
    };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/client-benefits' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      return proxy(await appStub(env)?.fetch(`https://app.internal/benefits?user=${encodeURIComponent(user.id)}`) || json({ ok: false }, 503));
    }

    if (url.pathname === '/api/referral-link' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      const me = await safeTelegram(env, 'getMe', {});
      const username = String(me?.username || '').replace(/^@/, '');
      if (!username) return json({ ok: false, error: 'Bot username unavailable' }, 503);
      const code = `HC${Number(user.id).toString(36).toUpperCase()}`;
      return json({ ok: true, link: `https://t.me/${username}?start=ref_${code}` });
    }

    if (url.pathname === '/api/demo-admin-referrals' && request.method === 'GET') {
      const admin = await validateRequestUser(request, env);
      if (!admin || !isAdmin(env, admin.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      return proxy(await appStub(env)?.fetch('https://app.internal/ref/admin-list') || json({ ok: false }, 503));
    }

    if (url.pathname === '/api/demo-admin-reviews' && request.method === 'GET') {
      const admin = await validateRequestUser(request, env);
      if (!admin || !isAdmin(env, admin.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      return proxy(await appStub(env)?.fetch('https://app.internal/review/list') || json({ ok: false }, 503));
    }

    if (url.pathname === '/api/demo-review' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      const number = cleanOrderNumber(url.searchParams.get('order'));
      if (!number) return json({ ok: false, error: 'Order is required' }, 400);
      const response = await appStub(env)?.fetch(`https://app.internal/review/get?user=${encodeURIComponent(user.id)}&order=${encodeURIComponent(number)}`);
      if (!response) return json({ ok: false }, 503);
      if (response.status === 404) return json({ ok: true, review: null });
      return json({ ok: true, review: await response.json() });
    }

    if (url.pathname === '/api/demo-review' && request.method === 'POST') {
      return handleReviewCreate(request, env);
    }

    if (url.pathname === '/api/demo-review-photo' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user) return new Response('Forbidden', { status: 403 });
      return handleReviewPhoto(request, env, user.id, false);
    }

    if (url.pathname === '/api/demo-admin-review-photo' && request.method === 'GET') {
      const admin = await validateRequestUser(request, env);
      if (!admin || !isAdmin(env, admin.id)) return new Response('Forbidden', { status: 403 });
      const clientId = positiveInt(url.searchParams.get('user'));
      return handleReviewPhoto(request, env, clientId, true);
    }

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      const user = await validateRequestUser(request, env);
      if (!user) return baseWorker.fetch(request, env, ctx);
      const prepared = await applyBenefitsToCreateRequest(request, env, user.id);
      return baseWorker.fetch(prepared || request, env, ctx);
    }

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      let body = {};
      try { body = await request.clone().json(); } catch {}
      const response = await baseWorker.fetch(request, env, ctx);
      const status = String(body?.status || '');
      const clientId = positiveInt(body?.clientTelegramId || body?.order?.client_telegram_id);
      const number = cleanOrderNumber(body?.order?.order_number);
      if (response.ok && status === 'COMPLETED' && clientId && number) {
        await completeReferral(env, clientId, number);
        await sendReviewInviteOnce(env, clientId, number, url.origin);
      }
      return response;
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      let update = null;
      try { update = await request.clone().json(); } catch {}
      const response = await baseWorker.fetch(request, env, ctx);
      const match = /^hc:d:(\d+):(.+)$/.exec(String(update?.callback_query?.data || ''));
      if (response.ok && match) {
        let number = '';
        try { number = decodeURIComponent(match[2]); } catch { number = match[2]; }
        const clientId = positiveInt(match[1]);
        if (clientId && cleanOrderNumber(number)) {
          await completeReferral(env, clientId, number);
          await sendReviewInviteOnce(env, clientId, number, url.origin);
        }
      }
      return response;
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function applyBenefitsToCreateRequest(request, env, userId) {
  try {
    const contentType = request.headers.get('content-type') || '';
    const benefits = await benefitsFor(env, userId);
    if (!benefits?.selected_percent) return request;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.clone().formData();
      const event = String(form.get('event') || 'created');
      if (event !== 'created') return request;
      let order = {};
      try { order = JSON.parse(String(form.get('order') || '{}')); } catch { return request; }
      order = withDiscount(order, benefits);
      const next = new FormData();
      for (const [key, value] of form.entries()) {
        if (key === 'order') continue;
        if (value instanceof File) next.append(key, value, value.name || 'file.jpg');
        else next.append(key, value);
      }
      next.append('order', JSON.stringify(order));
      const headers = new Headers();
      headers.set('X-Telegram-Init-Data', request.headers.get('X-Telegram-Init-Data') || '');
      return new Request(request.url, { method: 'POST', headers, body: next });
    }

    if (contentType.includes('application/json')) {
      const body = await request.clone().json();
      if (String(body?.event || 'created') !== 'created' || !body?.order) return request;
      const headers = new Headers({ 'content-type': 'application/json', 'X-Telegram-Init-Data': request.headers.get('X-Telegram-Init-Data') || '' });
      return new Request(request.url, { method: 'POST', headers, body: JSON.stringify({ ...body, order: withDiscount(body.order, benefits) }) });
    }
  } catch (error) {
    console.error('Benefit preparation failed', error);
  }
  return request;
}

function withDiscount(order, benefits) {
  const before = Math.max(0, Number(order?.price_before_discount || order?.estimated_price || 0));
  const percent = Math.max(0, Math.min(100, Number(benefits?.selected_percent || 0)));
  if (!before || !percent) return order;
  const amount = Math.round(before * percent / 100);
  return {
    ...order,
    price_before_discount: before,
    discount_percent: percent,
    discount_amount: amount,
    discount_type: benefits.selected_type,
    estimated_price: Math.max(0, before - amount),
  };
}

async function handleReviewCreate(request, env) {
  const user = await validateRequestUser(request, env);
  if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Некорректная форма' }, 400); }
  const orderNumber = cleanOrderNumber(form.get('order_number'));
  const rating = Number(form.get('rating') || 0);
  const text = String(form.get('text') || '').trim().slice(0, 2500);
  const photos = form.getAll('photos').filter((item) => item instanceof File && item.size > 0).slice(0, 5);
  if (!orderNumber || !Number.isInteger(rating) || rating < 1 || rating > 5) return json({ ok: false, error: 'Поставьте оценку от 1 до 5 звёзд' }, 400);

  const order = await appOrder(env, user.id, orderNumber);
  if (!order || order.status !== 'COMPLETED') return json({ ok: false, error: 'Отзыв доступен только после завершённой уборки' }, 403);
  const existing = await appStub(env)?.fetch(`https://app.internal/review/get?user=${encodeURIComponent(user.id)}&order=${encodeURIComponent(orderNumber)}`);
  if (existing?.ok) return json({ ok: false, error: 'Отзыв по этой заявке уже отправлен' }, 409);

  const mainAdmin = primaryAdminId(env);
  let photoFileIds = [];
  if (mainAdmin && photos.length) {
    try { photoFileIds = await uploadPhotoSet(env, Number(mainAdmin), photos); } catch (error) { console.error('Review photos failed', error); }
  }

  const payload = {
    client_telegram_id: Number(user.id),
    order_number: orderNumber,
    customer_name: order.customer_name || user.first_name || 'Клиент',
    rating,
    text,
    photo_file_ids: photoFileIds,
  };
  const storedResponse = await appStub(env)?.fetch('https://app.internal/review/save', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!storedResponse?.ok) {
    const data = await storedResponse?.json().catch(() => ({}));
    return json({ ok: false, error: data?.error || 'Не удалось сохранить отзыв' }, storedResponse?.status || 500);
  }
  const review = (await storedResponse.json()).review;

  if (mainAdmin) {
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    const lines = [
      '<b>НОВЫЙ ОТЗЫВ · HOUSE CLEANING</b>', '',
      `Заявка: <b>${escapeHtml(orderNumber)}</b>`,
      `Клиент: <b>${escapeHtml(review.customer_name)}</b>`,
      `Оценка: <b>${stars}</b>`,
      text ? `Комментарий: ${escapeHtml(text)}` : 'Комментарий: —',
      `Фото: ${photoFileIds.length}`,
    ];
    await safeTelegram(env, 'sendMessage', { chat_id: Number(mainAdmin), text: lines.join('\n'), parse_mode: 'HTML' });
  }

  return json({ ok: true, review });
}

async function handleReviewPhoto(request, env, clientId, adminMode) {
  const url = new URL(request.url);
  const orderNumber = cleanOrderNumber(url.searchParams.get('order'));
  const index = Number(url.searchParams.get('index') || 0);
  if (!clientId || !orderNumber || !Number.isInteger(index) || index < 0 || index > 4) return new Response('Bad Request', { status: 400 });
  const response = await appStub(env)?.fetch(`https://app.internal/review/get?user=${encodeURIComponent(clientId)}&order=${encodeURIComponent(orderNumber)}`);
  if (!response?.ok) return new Response('Photo not found', { status: 404 });
  const review = await response.json();
  const fileId = review?.photo_file_ids?.[index];
  if (!fileId) return new Response('Photo not found', { status: 404 });
  return telegramFile(env, fileId, adminMode ? 120 : 300);
}

async function sendReviewInviteOnce(env, clientId, orderNumber, origin) {
  try {
    const stub = appStub(env);
    if (!stub) return false;
    const check = await stub.fetch(`https://app.internal/review/invite-check?user=${encodeURIComponent(clientId)}&order=${encodeURIComponent(orderNumber)}`);
    if (check.ok && (await check.json())?.sent) return false;
    const reviewCheck = await stub.fetch(`https://app.internal/review/get?user=${encodeURIComponent(clientId)}&order=${encodeURIComponent(orderNumber)}`);
    if (reviewCheck.ok) return false;
    const sent = await safeTelegram(env, 'sendMessage', {
      chat_id: clientId,
      text: ['🏠 <b>HOUSE CLEANING</b>', '', 'Уборка завершена ✨', '', 'Спасибо, что выбрали нас.', '', 'Будем благодарны, если вы оцените нашу работу — это займёт меньше минуты.'].join('\n'),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '⭐ Оставить отзыв', web_app: { url: `${origin}/?demo=1&review=${encodeURIComponent(orderNumber)}` }, style: 'primary' }]] },
    });
    if (!sent) return false;
    await stub.fetch('https://app.internal/review/invite-mark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_telegram_id: clientId, order_number: orderNumber }) });
    return true;
  } catch (error) {
    console.error('Review invite failed', error);
    return false;
  }
}

async function benefitsFor(env, userId) {
  const response = await appStub(env)?.fetch(`https://app.internal/benefits?user=${encodeURIComponent(userId)}`);
  return response?.ok ? await response.json() : null;
}

async function completeReferral(env, clientId, orderNumber) {
  try {
    const response = await appStub(env)?.fetch('https://app.internal/ref/complete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ friend_id: clientId, order_number: orderNumber }),
    });
    return Boolean(response?.ok);
  } catch { return false; }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function appOrder(env, clientId, number) {
  const response = await appStub(env)?.fetch(`https://app.internal/order?user=${encodeURIComponent(clientId)}&number=${encodeURIComponent(number)}`);
  return response?.ok ? await response.json() : null;
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

async function telegramFile(env, fileId, maxAge = 300) {
  const file = await telegram(env, 'getFile', { file_id: fileId });
  if (!file?.file_path) return new Response('Photo not found', { status: 404 });
  const upstream = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!upstream.ok) return new Response('Photo unavailable', { status: 502 });
  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') || 'image/jpeg');
  headers.set('cache-control', `private, max-age=${maxAge}`);
  return new Response(upstream.body, { status: 200, headers });
}

function reviewKey(clientId, orderNumber) { return `review:item:${clientId}:${orderNumber}`; }
function reviewInviteKey(clientId, orderNumber) { return `review:invite:${clientId}:${orderNumber}`; }
function cleanOrderNumber(value) { const v = String(value || '').trim(); return /^[A-Za-z0-9._-]{3,80}$/.test(v) ? v : ''; }
function positiveInt(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 0; }
function primaryAdminId(env) {
  const values = [env.MAIN_ADMIN_TELEGRAM_ID, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID, env.ADMIN_TELEGRAM_IDS];
  for (const raw of values) {
    const first = String(raw || '').split(/[;,\s]+/).find((v) => /^-?\d+$/.test(v));
    if (first) return first;
  }
  return '';
}
function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v)))];
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
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function safeTelegram(env, method, payload) {
  try { return await telegram(env, method, payload); } catch (error) { console.error(`Telegram ${method} failed`, error); return null; }
}
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
function proxy(response) { const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); return new Response(response.body, { status: response.status, headers }); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char)); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' } }); }
