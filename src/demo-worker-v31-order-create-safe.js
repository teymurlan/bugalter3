import baseWorker, { ConsentStore, AppStore } from './demo-worker-v30-contact-links.js';

export { ConsentStore, AppStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const CONSENT_VERSION = '2026-09-09-v1';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const contentType = String(request.headers.get('content-type') || '').toLowerCase();

    // The benefits layer used to parse and rebuild multipart requests before the
    // stable order handler parsed them again. With several photos this could make
    // Worker memory spike and surface as an opaque HTTP 500. Only discounted
    // multipart order creation is handled here; every other route stays on v30.
    if (url.pathname === '/api/demo-order'
      && request.method === 'POST'
      && contentType.includes('multipart/form-data')) {
      const user = await validateRequestUser(request, env);
      if (!user) return baseWorker.fetch(request, env, ctx);

      const benefits = await benefitsFor(env, user.id);
      if (Number(benefits?.selected_percent || 0) > 0) {
        return handleDiscountedMultipartOrder(request, env, user, benefits, url.origin);
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function handleDiscountedMultipartOrder(request, env, user, benefits, origin) {
  try {
    const consent = await getConsent(env, user.id);
    if (!(consent?.status === 'accepted' && consent?.version === CONSENT_VERSION)) {
      return json({
        ok: false,
        error: 'Сначала подтвердите согласие на обработку персональных данных командой /start.',
        consentRequired: true,
      }, 403);
    }

    const form = await request.formData();
    const event = String(form.get('event') || 'created');
    if (event !== 'created') {
      return json({ ok: false, error: 'Некорректный тип операции' }, 400);
    }

    let rawOrder = null;
    try { rawOrder = JSON.parse(String(form.get('order') || '{}')); }
    catch { return json({ ok: false, error: 'Некорректные данные заявки' }, 400); }

    const files = form.getAll('photos')
      .filter((item) => item instanceof File && item.size > 0)
      .slice(0, 10);

    const order = cleanOrder(withDiscount(rawOrder, benefits));
    if (!order) return json({ ok: false, error: 'Недостаточно данных заявки' }, 400);

    // If a previous attempt reached storage but the HTTP response was lost,
    // return the existing order instead of notifying the administrator twice.
    const existing = await appOrder(env, user.id, order.order_number);
    if (existing) {
      return json({
        ok: true,
        event: 'created',
        adminNotified: 1,
        adminErrors: [],
        clientNotified: true,
        photoNotified: true,
        duplicateRecovered: true,
        order: existing,
      });
    }

    const ids = adminIds(env);
    if (!ids.length) {
      return json({ ok: false, error: 'Администратор не настроен', adminNotified: 0 }, 503);
    }

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
    const adminText = newOrderAdminText(order, user);

    for (const id of ids) {
      try {
        await telegram(env, 'sendMessage', {
          chat_id: id,
          text: adminText,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        deliveredAdmins.push(id);
      } catch (error) {
        errors.push(String(error?.message || error));
      }
    }

    if (!deliveredAdmins.length) {
      return json({
        ok: false,
        error: `Telegram не доставил заявку администратору${errors[0] ? `: ${errors[0]}` : ''}`,
        adminNotified: 0,
        adminErrors: errors,
      }, 502);
    }

    let photoFileIds = [];
    if (files.length) {
      try {
        photoFileIds = await uploadPhotoSet(env, deliveredAdmins[0], files);
        for (const id of deliveredAdmins.slice(1)) {
          await sendPhotoSetByIds(env, id, photoFileIds);
        }
      } catch (error) {
        errors.push(`Фото: ${String(error?.message || error)}`);
      }
    }

    const stored = await appPutOrder(env, {
      ...order,
      status: order.status || 'NEW',
      client_telegram_id: Number(user.id),
      photo_count: Math.max(Number(order.photo_count || 0), files.length, photoFileIds.length),
      photo_file_ids: photoFileIds,
    });

    if (!stored) {
      return json({
        ok: false,
        error: 'Заявка получена, но не удалось сохранить её в системе. Повторите попытку через минуту.',
        adminNotified: deliveredAdmins.length,
        adminErrors: errors,
      }, 503);
    }

    if (stored.discount_type === 'referral_reward' && stored.client_telegram_id) {
      await disarmReferralReward(env, stored.client_telegram_id);
    }

    const clientText = [
      '🆕 <b>Заявка оформлена</b>',
      '',
      orderDetails(stored),
      '',
      '<i>Стоимость предварительная. Точную стоимость рассчитает менеджер после оценки объекта и фотографий.</i>',
      '',
      'Скоро менеджер свяжется с вами выбранным способом для подтверждения заявки.',
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
      event: 'created',
      adminNotified: deliveredAdmins.length,
      adminErrors: errors,
      clientNotified: Boolean(clientSent),
      photoNotified: !files.length || photoFileIds.length > 0,
      order: stored,
    });
  } catch (error) {
    console.error('Discounted multipart order creation failed', error);
    return json({
      ok: false,
      error: `Не удалось оформить заявку: ${safeErrorMessage(error)}`,
    }, 500);
  }
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
    discount_type: String(benefits?.selected_type || 'loyalty'),
    estimated_price: Math.max(0, before - amount),
  };
}

function cleanOrder(raw) {
  const area = Number(raw?.area || 0);
  const clientId = Number(raw?.client_telegram_id || 0);
  if (!raw?.order_number
    || !raw?.customer_name
    || !raw?.date
    || !raw?.address
    || !Number.isFinite(area)
    || area < 1
    || area > 5000) return null;

  return {
    ...raw,
    area,
    client_telegram_id: Number.isSafeInteger(clientId) && clientId > 0 ? clientId : 0,
    order_number: String(raw.order_number),
    customer_name: String(raw.customer_name),
    phone: String(raw.phone || ''),
    contact_method: normalizeContactMethod(raw.contact_method || raw.contactMethod),
    service_name: String(raw.service_name || 'Уборка'),
    city: String(raw.city || ''),
    address: String(raw.address || ''),
    date: String(raw.date),
    time: formatTime(raw.time || ''),
    addon_names: Array.isArray(raw.addon_names) ? raw.addon_names.map(String) : [],
    photo_count: Math.max(0, Number(raw.photo_count || 0)),
    price_per_m2: Math.max(0, Number(raw.price_per_m2 || 0)),
    price_before_discount: Math.max(0, Number(raw.price_before_discount || raw.estimated_price || 0)),
    discount_percent: Math.max(0, Math.min(100, Number(raw.discount_percent || 0))),
    discount_amount: Math.max(0, Number(raw.discount_amount || 0)),
    discount_type: String(raw.discount_type || ''),
    estimated_price: Math.max(0, Number(raw.estimated_price || 0)),
    created_at: String(raw.created_at || new Date().toISOString()),
  };
}

function newOrderAdminText(order, user) {
  return [
    '🆕 <b>НОВАЯ ЗАЯВКА · HOUSE CLEANING</b>',
    '',
    `<b>${escapeHtml(order.order_number)}</b>`,
    `Клиент: <b>${escapeHtml(order.customer_name)}</b>`,
    `Телефон: ${escapeHtml(order.phone || '—')}`,
    `Связаться: <b>${escapeHtml(contactMethodLabel(order.contact_method))}</b>`,
    `Уборка: ${escapeHtml(order.service_name)}`,
    `Площадь: <b>${order.area} м²</b>`,
    `Дата: <b>${formatDate(order.date)}</b>`,
    `Время: <b>${formatTime(order.time)}</b>`,
    `Адрес: ${escapeHtml([order.city, order.address].filter(Boolean).join(', '))}`,
    `Дополнительно: ${escapeHtml(order.addon_names.join(', ') || 'нет')}`,
    `Фото: ${order.photo_count}`,
    Number(order.discount_percent) > 0 && Number(order.price_before_discount) > 0
      ? `Стоимость до скидки: <b>${money(order.price_before_discount)}</b>` : '',
    Number(order.discount_percent) > 0
      ? `${escapeHtml(discountLabel(order.discount_type))} ${Number(order.discount_percent)}%: <b>−${money(order.discount_amount)}</b>` : '',
    Number(order.estimated_price) > 0
      ? `Предварительная стоимость: <b>от ${money(order.estimated_price)}</b>`
      : 'Предварительная стоимость: рассчитает менеджер',
    '<i>Точная стоимость — после оценки объекта и фотографий.</i>',
    '',
    `Telegram: ${user.username ? `@${escapeHtml(user.username)}` : `ID ${user.id}`}`,
  ].filter(Boolean).join('\n');
}

function orderDetails(order) {
  const lines = [`<b>${escapeHtml(order.order_number)}</b>`];
  if (order.service_name) lines.push(`Уборка: ${escapeHtml(order.service_name)}`);
  if (Number(order.area)) lines.push(`Площадь: <b>${Number(order.area)} м²</b>`);
  if (order.date) lines.push(`Дата: <b>${formatDate(order.date)}</b>`);
  if (order.time) lines.push(`Время: <b>${formatTime(order.time)}</b>`);
  if (order.city || order.address) lines.push(`Адрес: ${escapeHtml([order.city, order.address].filter(Boolean).join(', '))}`);
  if (order.addon_names?.length) lines.push(`Дополнительно: ${escapeHtml(order.addon_names.join(', '))}`);
  if (order.contact_method) lines.push(`Связаться для подтверждения: <b>${escapeHtml(contactMethodLabel(order.contact_method))}</b>`);
  if (Number(order.discount_percent) > 0 && Number(order.price_before_discount) > 0) {
    lines.push(`Стоимость до скидки: <b>${money(order.price_before_discount)}</b>`);
    lines.push(`${escapeHtml(discountLabel(order.discount_type))} ${Number(order.discount_percent)}%: <b>−${money(order.discount_amount)}</b>`);
  }
  if (Number(order.estimated_price) > 0) {
    lines.push(`Предварительная стоимость: <b>от ${money(order.estimated_price)}</b>`);
  }
  return lines.join('\n');
}

async function benefitsFor(env, userId) {
  const stub = appStub(env);
  if (!stub) return null;
  const response = await stub.fetch(`https://app.internal/benefits?user=${encodeURIComponent(userId)}`);
  return response.ok ? await response.json() : null;
}

async function disarmReferralReward(env, userId) {
  try {
    await appStub(env)?.fetch('https://app.internal/ref/reward-arm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: Number(userId), enabled: false }),
    });
  } catch (error) {
    console.error('Referral reward disarm failed', error);
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

async function getConsent(env, userId) {
  if (!env.CONSENT_STORE || !userId) return null;
  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const response = await env.CONSENT_STORE.get(id).fetch('https://consent.internal/record');
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function uploadPhotoSet(env, chatId, files) {
  if (!files.length) return [];
  if (files.length === 1) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', files[0], files[0].name || 'order-photo.jpg');
    const result = await telegramMultipart(env, 'sendPhoto', form);
    const id = largestPhotoId(result);
    return id ? [id] : [];
  }

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('media', JSON.stringify(files.map((_, index) => ({ type: 'photo', media: `attach://photo${index}` }))));
  files.forEach((file, index) => form.append(`photo${index}`, file, file.name || `order-photo-${index + 1}.jpg`));
  const result = await telegramMultipart(env, 'sendMediaGroup', form);
  return Array.isArray(result) ? result.map(largestPhotoId).filter(Boolean) : [];
}

async function sendPhotoSetByIds(env, chatId, ids) {
  if (!ids.length) return;
  if (ids.length === 1) {
    await telegram(env, 'sendPhoto', { chat_id: chatId, photo: ids[0] });
    return;
  }
  await telegram(env, 'sendMediaGroup', {
    chat_id: chatId,
    media: ids.map((id) => ({ type: 'photo', media: id })),
  });
}

function largestPhotoId(message) {
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  return photos.length ? String(photos[photos.length - 1]?.file_id || '') : '';
}

function normalizeContactMethod(value) {
  const key = String(value || '').trim().toLowerCase();
  return ['telegram', 'whatsapp', 'max', 'call'].includes(key) ? key : 'telegram';
}

function contactMethodLabel(value) {
  return ({ telegram: 'Telegram', whatsapp: 'WhatsApp', max: 'MAX', call: 'Звонок' })[normalizeContactMethod(value)] || 'Telegram';
}

function discountLabel(value) {
  return ({
    loyalty: 'Скидка по программе лояльности',
    referral_friend: 'Скидка по приглашению друга',
    referral_reward: 'Реферальная скидка',
  })[String(value || '')] || 'Скидка';
}

function callbackData(action, userId, orderNumber) {
  return `hc:${action}:${userId}:${encodeURIComponent(String(orderNumber).slice(0, 28))}`.slice(0, 64);
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
      const check = [...candidate]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
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

async function telegramMultipart(env, method, formData) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    body: formData,
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function formatDate(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  return escapeHtml(raw || '—');
}

function formatTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw || '—';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] || char));
}

function safeErrorMessage(error) {
  const message = String(error?.message || error || 'внутренняя ошибка').trim();
  return message.slice(0, 300) || 'внутренняя ошибка';
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
