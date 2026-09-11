import baseWorker, { ConsentStore } from './demo-worker-v7.js';

export { ConsentStore };

const CONSENT_VERSION = '2026-09-09-v1';
const OPERATOR = 'ИП Царегородцева Евгения Андреевна';

export class AppStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/orders' && request.method === 'GET') {
      const values = await this.state.storage.list({ prefix: 'order:' });
      const orders = [...values.values()].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return json({ ok: true, orders });
    }

    if (url.pathname === '/order' && request.method === 'GET') {
      const key = orderKey(url.searchParams.get('user'), url.searchParams.get('number'));
      if (!key) return json(null, 404);
      const value = await this.state.storage.get(key);
      return value ? json(value) : json(null, 404);
    }

    if (url.pathname === '/order' && request.method === 'PUT') {
      let incoming;
      try { incoming = await request.json(); }
      catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
      const key = orderKey(incoming?.client_telegram_id, incoming?.order_number);
      if (!key) return json({ ok: false, error: 'Invalid order key' }, 400);
      const previous = await this.state.storage.get(key) || {};
      const next = {
        ...previous,
        ...incoming,
        photo_file_ids: Array.isArray(incoming?.photo_file_ids) && incoming.photo_file_ids.length
          ? incoming.photo_file_ids
          : (previous.photo_file_ids || []),
        photo_count: Math.max(Number(incoming?.photo_count || 0), Number(previous.photo_count || 0)),
        updated_at: new Date().toISOString(),
      };
      await this.state.storage.put(key, next);
      return json({ ok: true, order: next });
    }

    if (url.pathname === '/status' && request.method === 'PATCH') {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
      const key = orderKey(body?.client_telegram_id, body?.order_number);
      if (!key) return json({ ok: false, error: 'Invalid order key' }, 400);
      const previous = await this.state.storage.get(key);
      if (!previous) return json({ ok: false, error: 'Order not found' }, 404);
      const next = { ...previous, status: String(body.status || previous.status), updated_at: new Date().toISOString() };
      await this.state.storage.put(key, next);
      return json({ ok: true, order: next });
    }

    if (url.pathname === '/menu' && request.method === 'GET') {
      const user = String(url.searchParams.get('user') || '');
      if (!/^\d+$/.test(user)) return json(null, 404);
      const value = await this.state.storage.get(`menu:${user}`);
      return json(value || null);
    }

    if (url.pathname === '/menu' && request.method === 'PUT') {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false }, 400); }
      const user = String(body?.user || '');
      const messageId = Number(body?.message_id || 0);
      if (!/^\d+$/.test(user) || !Number.isInteger(messageId) || messageId <= 0) return json({ ok: false }, 400);
      await this.state.storage.put(`menu:${user}`, { message_id: messageId, updated_at: new Date().toISOString() });
      return json({ ok: true });
    }

    if (url.pathname === '/menu' && request.method === 'DELETE') {
      const user = String(url.searchParams.get('user') || '');
      if (/^\d+$/.test(user)) await this.state.storage.delete(`menu:${user}`);
      return json({ ok: true });
    }

    return new Response('Not Found', { status: 404 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      return handleOrderEvent(request, env, url.origin);
    }

    if (url.pathname === '/api/demo-admin-orders' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user || !isAdmin(env, user.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      const orders = await appOrders(env);
      return json({ ok: true, demo: false, orders });
    }

    if (url.pathname === '/api/demo-admin-photo' && request.method === 'GET') {
      return handleAdminPhoto(request, env);
    }

    if (url.pathname === '/api/demo-admin-store-status' && request.method === 'POST') {
      const user = await validateRequestUser(request, env);
      if (!user || !isAdmin(env, user.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Некорректный запрос' }, 400); }
      const order = cleanOrder(body?.order);
      const status = String(body?.status || '');
      if (!order || !status) return json({ ok: false, error: 'Недостаточно данных' }, 400);
      const updated = await appUpdateStatus(env, order.client_telegram_id, order.order_number, status);
      return json({ ok: true, order: updated || { ...order, status } });
    }

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      let body = null;
      try { body = await request.clone().json(); } catch {}
      const response = await baseWorker.fetch(request, env, ctx);
      if (response.ok && body?.order?.order_number) {
        await appUpdateStatus(
          env,
          Number(body.clientTelegramId || body.order.client_telegram_id || 0),
          String(body.order.order_number),
          String(body.status || ''),
        );
      }
      return response;
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET
        && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      let update;
      try { update = await request.clone().json(); }
      catch { return new Response('Bad Request', { status: 400 }); }

      const message = update?.message || update?.edited_message;
      const textRaw = String(message?.text || '').trim();
      const text = textRaw.toLowerCase();

      if (text.startsWith('/start') || text === '/menu') {
        await ensureCommands(env);
        await handleMenuCommand(message, env, url.origin);
        return new Response('OK');
      }

      if (text === '/admin') {
        await ensureCommands(env);
        await handleAdminCommand(message, env, url.origin);
        return new Response('OK');
      }

      const query = update?.callback_query;
      const consentMatch = /^pd:(accept|decline):(.+)$/.exec(String(query?.data || ''));
      if (query && consentMatch && consentMatch[2] === CONSENT_VERSION) {
        await handleConsent(query, consentMatch[1], env, url.origin);
        return new Response('OK');
      }

      const callbackAction = String(query?.data || '').match(/^hc:(yc|yx|d):(\d+):(.+)$/);
      if (callbackAction) {
        const response = await baseWorker.fetch(request, env, ctx);
        const status = callbackAction[1] === 'yc' ? 'CONFIRMED' : callbackAction[1] === 'yx' ? 'CANCELLED' : 'COMPLETED';
        await appUpdateStatus(env, Number(callbackAction[2]), decodeURIComponent(callbackAction[3]), status);
        return response;
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleMenuCommand(message, env, origin) {
  const chatId = Number(message?.chat?.id || 0);
  const userId = Number(message?.from?.id || 0);
  if (!chatId || !userId) return;

  await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: message.message_id });
  const consent = await getConsent(env, userId);

  if (consent?.status === 'accepted' && consent?.version === CONSENT_VERSION) {
    await replaceMenu(env, chatId, userId, mainText(message.from), mainKeyboard(env, userId, origin));
    return;
  }

  if (consent?.status === 'declined' && consent?.version === CONSENT_VERSION) {
    await replaceMenu(env, chatId, userId, blockedText(), contactKeyboard(env));
    return;
  }

  await replaceMenu(env, chatId, userId, consentText(message.from), consentKeyboard(origin));
}

async function handleAdminCommand(message, env, origin) {
  const chatId = Number(message?.chat?.id || 0);
  const userId = Number(message?.from?.id || 0);
  if (!chatId || !userId) return;
  await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: message.message_id });
  if (!isAdmin(env, userId)) return;

  const keyboard = {
    inline_keyboard: [[{
      text: 'Открыть панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1` },
      style: 'primary',
    }]],
  };
  await replaceMenu(env, chatId, userId, '<b>HOUSE CLEANING · Администратор</b>\n\nУправление заявками, статусами, фотографиями и клиентами.', keyboard);
}

async function handleConsent(query, action, env, origin) {
  const userId = Number(query?.from?.id || 0);
  const chatId = Number(query?.message?.chat?.id || 0);
  const messageId = Number(query?.message?.message_id || 0);
  if (!userId || !chatId || !messageId) return;

  const status = action === 'accept' ? 'accepted' : 'declined';
  await saveConsent(env, query.from, status);
  await safeTelegram(env, 'answerCallbackQuery', {
    callback_query_id: query.id,
    text: action === 'accept' ? 'Согласие сохранено' : 'Доступ к записи ограничен',
  });

  if (action === 'accept') {
    await safeTelegram(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: mainText(query.from),
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(env, userId, origin),
    });
  } else {
    await safeTelegram(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: blockedText(),
      parse_mode: 'HTML',
      reply_markup: contactKeyboard(env),
    });
  }
  await saveMenuId(env, userId, messageId);
}

function consentText(user) {
  return [
    '<b>HOUSE CLEANING</b>',
    '',
    `Здравствуйте, ${escapeHtml(user?.first_name || 'клиент')}.`,
    '',
    'Для оформления уборки необходимо согласие на обработку персональных данных:',
    '• данные Telegram;',
    '• имя и номер телефона;',
    '• адрес и сведения о заказе;',
    '• фотографии объекта, которые вы добавите.',
    '',
    `Оператор: <b>${OPERATOR}</b>.`,
    '',
    'Без согласия пользоваться записью через бота нельзя.',
  ].join('\n');
}

function consentKeyboard(origin) {
  return {
    inline_keyboard: [
      [{ text: 'Согласен на обработку персональных данных', callback_data: `pd:accept:${CONSENT_VERSION}` }],
      [{ text: 'Политика обработки персональных данных', url: `${origin}/privacy` }],
      [{ text: 'Не согласен', callback_data: `pd:decline:${CONSENT_VERSION}` }],
    ],
  };
}

function mainText(user) {
  return [
    '<b>HOUSE CLEANING</b>',
    '',
    `Здравствуйте, ${escapeHtml(user?.first_name || 'клиент')}.`,
    '',
    'Профессиональная уборка квартир, домов и коммерческих помещений.',
    '',
    'Оформите заявку в мини-приложении: выберите уборку, площадь, добавьте фотографии и удобные дату и время.',
  ].join('\n');
}

function mainKeyboard(env, userId, origin) {
  const rows = [[{
    text: 'Открыть HOUSE CLEANING',
    web_app: { url: `${origin}/?demo=1` },
    style: 'success',
  }]];
  if (isAdmin(env, userId)) {
    rows.push([{
      text: 'Панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1` },
      style: 'primary',
    }]);
  }
  return { inline_keyboard: rows };
}

function blockedText() {
  return '<b>HOUSE CLEANING</b>\n\n<b>Доступ к боту ограничен</b>\n\nВы не предоставили согласие на обработку персональных данных. Запись через бота недоступна.\n\nЕсли хотите оформить уборку другим способом или задать вопрос, напишите администратору.';
}

function contactKeyboard(env) {
  const adminId = adminIds(env)[0];
  return { inline_keyboard: adminId ? [[{ text: 'Написать администратору', url: `tg://user?id=${adminId}` }]] : [] };
}

async function replaceMenu(env, chatId, userId, text, replyMarkup) {
  const previous = await getMenuId(env, userId);
  if (previous) await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: previous });

  const sent = await safeTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });
  if (sent?.message_id) await saveMenuId(env, userId, sent.message_id);
}

async function handleOrderEvent(request, env, origin) {
  const user = await validateRequestUser(request, env);
  if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);

  const consent = await getConsent(env, user.id);
  if (!(consent?.status === 'accepted' && consent?.version === CONSENT_VERSION)) {
    return json({ ok: false, error: 'Сначала подтвердите согласие на обработку персональных данных командой /start.', consentRequired: true }, 403);
  }

  const parsed = await parseOrderRequest(request);
  const order = cleanOrder(parsed.order);
  if (!order) return json({ ok: false, error: 'Недостаточно данных заявки' }, 400);
  const event = parsed.event === 'cancelled' ? 'cancelled' : 'created';
  const files = event === 'created' ? parsed.photos.slice(0, 10) : [];

  const ids = adminIds(env);
  if (!ids.length) return json({ ok: false, error: 'Администратор не настроен', adminNotified: 0 }, 503);

  const adminText = event === 'created' ? newOrderAdminText(order, user) : cancelledAdminText(order, user);
  const keyboard = event === 'created'
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
    : { inline_keyboard: [[{ text: 'Написать клиенту', url: `tg://user?id=${user.id}` }]] };

  const deliveredAdmins = [];
  const errors = [];
  for (const id of ids) {
    try {
      await telegram(env, 'sendMessage', { chat_id: id, text: adminText, parse_mode: 'HTML', reply_markup: keyboard });
      deliveredAdmins.push(id);
    } catch (error) {
      errors.push(String(error?.message || error));
    }
  }

  if (!deliveredAdmins.length) {
    return json({ ok: false, error: `Telegram не доставил заявку администратору${errors[0] ? `: ${errors[0]}` : ''}`, adminNotified: 0, adminErrors: errors }, 502);
  }

  let photoFileIds = [];
  if (event === 'created' && files.length) {
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
    status: event === 'cancelled' ? 'CANCELLED' : (order.status || 'NEW'),
    client_telegram_id: Number(user.id),
    photo_count: Math.max(Number(order.photo_count || 0), files.length, photoFileIds.length),
    photo_file_ids: photoFileIds,
  });

  const clientText = event === 'created'
    ? [
        '<b>Заявка оформлена</b>',
        '',
        orderDetails(stored || order),
        '',
        '<i>Стоимость предварительная. Точную стоимость рассчитает менеджер после оценки объекта и фотографий.</i>',
        '',
        'Скоро менеджер свяжется с вами выбранным способом для подтверждения заявки.',
      ].join('\n')
    : [
        '<b>Заявка отменена</b>',
        '',
        orderDetails(stored || order),
        '',
        'Администратор уведомлён об отмене.',
      ].join('\n');

  const clientSent = await safeTelegram(env, 'sendMessage', {
    chat_id: user.id,
    text: clientText,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Открыть HOUSE CLEANING', web_app: { url: `${origin}/?demo=1` }, style: 'primary' }]] },
  });

  return json({
    ok: true,
    event,
    adminNotified: deliveredAdmins.length,
    adminErrors: errors,
    clientNotified: Boolean(clientSent),
    photoNotified: !files.length || photoFileIds.length > 0,
    order: stored || order,
  });
}

async function parseOrderRequest(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    let order = null;
    try { order = JSON.parse(String(form.get('order') || '{}')); } catch {}
    const event = String(form.get('event') || 'created');
    const photos = form.getAll('photos').filter((item) => item instanceof File && item.size > 0);
    return { order, event, photos };
  }
  let body = {};
  try { body = await request.json(); } catch {}
  return { order: body?.order, event: body?.event || 'created', photos: [] };
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
  const media = files.map((_, index) => ({ type: 'photo', media: `attach://photo${index}` }));
  form.append('media', JSON.stringify(media));
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
  return photos.length ? String(photos[photos.length - 1].file_id || '') : '';
}

async function handleAdminPhoto(request, env) {
  const user = await validateRequestUser(request, env);
  if (!user || !isAdmin(env, user.id)) return new Response('Forbidden', { status: 403 });
  const url = new URL(request.url);
  const clientId = Number(url.searchParams.get('user') || 0);
  const number = String(url.searchParams.get('order') || '');
  const index = Number(url.searchParams.get('index') || 0);
  const order = await appOrder(env, clientId, number);
  const fileId = order?.photo_file_ids?.[index];
  if (!fileId) return new Response('Photo not found', { status: 404 });

  const file = await telegram(env, 'getFile', { file_id: fileId });
  if (!file?.file_path) return new Response('Photo not found', { status: 404 });
  const upstream = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!upstream.ok) return new Response('Photo unavailable', { status: 502 });
  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') || 'image/jpeg');
  headers.set('cache-control', 'private, max-age=300');
  return new Response(upstream.body, { status: 200, headers });
}

async function ensureCommands(env) {
  const baseCommands = [
    { command: 'start', description: 'Открыть HOUSE CLEANING' },
    { command: 'menu', description: 'Главное меню' },
  ];
  await safeTelegram(env, 'setMyCommands', { commands: baseCommands, scope: { type: 'all_private_chats' } });
  for (const id of adminIds(env)) {
    await safeTelegram(env, 'setMyCommands', {
      commands: [...baseCommands, { command: 'admin', description: 'Панель администратора' }],
      scope: { type: 'chat', chat_id: Number(id) },
    });
  }
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

async function saveConsent(env, user, status) {
  if (!env.CONSENT_STORE || !user?.id) return false;
  const now = new Date().toISOString();
  const previous = await getConsent(env, user.id);
  const record = {
    telegram_id: Number(user.id),
    username: user.username || null,
    first_name: user.first_name || '',
    last_name: user.last_name || null,
    status,
    version: CONSENT_VERSION,
    accepted_at: status === 'accepted' ? now : previous?.accepted_at || null,
    revoked_at: status === 'revoked' ? now : null,
    updated_at: now,
  };
  try {
    const id = env.CONSENT_STORE.idFromName(String(user.id));
    const stub = env.CONSENT_STORE.get(id);
    const response = await stub.fetch('https://consent.internal/record', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record),
    });
    return response.ok;
  } catch { return false; }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  const id = env.APP_STORE.idFromName('house-cleaning-app-v1');
  return env.APP_STORE.get(id);
}

async function appOrders(env) {
  const stub = appStub(env);
  if (!stub) return [];
  const response = await stub.fetch('https://app.internal/orders');
  if (!response.ok) return [];
  return (await response.json()).orders || [];
}

async function appOrder(env, clientId, number) {
  const stub = appStub(env);
  if (!stub) return null;
  const response = await stub.fetch(`https://app.internal/order?user=${encodeURIComponent(clientId)}&number=${encodeURIComponent(number)}`);
  return response.ok ? await response.json() : null;
}

async function appPutOrder(env, order) {
  const stub = appStub(env);
  if (!stub) return order;
  const response = await stub.fetch('https://app.internal/order', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order),
  });
  if (!response.ok) return order;
  return (await response.json()).order || order;
}

async function appUpdateStatus(env, clientId, number, status) {
  if (!clientId || !number || !status) return null;
  const stub = appStub(env);
  if (!stub) return null;
  const response = await stub.fetch('https://app.internal/status', {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_telegram_id: Number(clientId), order_number: String(number), status: String(status) }),
  });
  if (!response.ok) return null;
  return (await response.json()).order || null;
}

async function getMenuId(env, userId) {
  const stub = appStub(env);
  if (!stub) return 0;
  const response = await stub.fetch(`https://app.internal/menu?user=${encodeURIComponent(userId)}`);
  if (!response.ok) return 0;
  const data = await response.json();
  return Number(data?.message_id || 0);
}

async function saveMenuId(env, userId, messageId) {
  const stub = appStub(env);
  if (!stub) return;
  await stub.fetch('https://app.internal/menu', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: String(userId), message_id: Number(messageId) }),
  });
}

function orderKey(clientId, number) {
  const user = String(clientId || '');
  const order = String(number || '').trim();
  if (!/^\d+$/.test(user) || !order) return '';
  return `order:${user}:${order}`;
}

function normalizeContactMethod(value) {
  const key = String(value || '').trim().toLowerCase();
  return ['telegram', 'whatsapp', 'max', 'call'].includes(key) ? key : 'telegram';
}

function contactMethodLabel(value) {
  return ({ telegram: 'Telegram', whatsapp: 'WhatsApp', max: 'MAX', call: 'Звонок' })[normalizeContactMethod(value)] || 'Telegram';
}

function cleanOrder(raw) {
  const area = Number(raw?.area || 0);
  const clientId = Number(raw?.client_telegram_id || 0);
  if (!raw?.order_number || !raw?.customer_name || !raw?.date || !raw?.address || !Number.isFinite(area) || area < 1 || area > 5000) return null;
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
    estimated_price: Math.max(0, Number(raw.estimated_price || 0)),
    created_at: String(raw.created_at || new Date().toISOString()),
  };
}

function newOrderAdminText(order, user) {
  return [
    '<b>НОВАЯ ЗАЯВКА · HOUSE CLEANING</b>',
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
    Number(order.estimated_price) > 0 ? `Предварительная стоимость: <b>от ${money(order.estimated_price)}</b>` : 'Предварительная стоимость: рассчитает менеджер',
    '<i>Точная стоимость — после оценки объекта и фотографий.</i>',
    '',
    `Telegram: ${user.username ? `@${escapeHtml(user.username)}` : `ID ${user.id}`}`,
  ].join('\n');
}

function cancelledAdminText(order, user) {
  return [
    '<b>ЗАЯВКА ОТМЕНЕНА · HOUSE CLEANING</b>',
    '',
    `<b>${escapeHtml(order.order_number)}</b>`,
    `Клиент: <b>${escapeHtml(order.customer_name)}</b>`,
    `Дата: <b>${formatDate(order.date)}</b>`,
    `Время: <b>${formatTime(order.time)}</b>`,
    Number(order.estimated_price) > 0 ? `Предварительная стоимость: <b>от ${money(order.estimated_price)}</b>` : '',
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
  if (Number(order.estimated_price) > 0) lines.push(`Предварительная стоимость: <b>от ${money(order.estimated_price)}</b>`);
  return lines.join('\n');
}

function formatDate(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1].slice(-2)}`;
  const ru = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{2}|\d{4})$/);
  if (ru) return `${ru[1]}/${ru[2]}/${ru[3].slice(-2)}`;
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

function callbackData(action, userId, orderNumber) {
  return `hc:${action}:${userId}:${encodeURIComponent(String(orderNumber).slice(0, 28))}`.slice(0, 64);
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
    const allEntries = [...params.entries()];
    const candidates = [allEntries, allEntries.filter(([key]) => key !== 'signature')];
    const encoder = new TextEncoder();
    const secret = await hmac(encoder.encode('WebAppData'), encoder.encode(botToken));
    for (const entries of candidates) {
      const check = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
      const digest = await hmac(secret, encoder.encode(check));
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

async function telegramMultipart(env, method, formData) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', body: formData,
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}