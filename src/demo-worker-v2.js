import baseWorker from './demo-worker.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      return handleOrderEvent(request, env, url.origin);
    }

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      return handleAdminStatus(request, env, url.origin);
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET
        && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      let update;
      try { update = await request.clone().json(); }
      catch { return new Response('Bad Request', { status: 400 }); }

      if (update.callback_query) {
        await handleAdminCallback(update.callback_query, env, url.origin);
        return new Response('OK');
      }

      const message = update.message || update.edited_message;
      const text = String(message?.text || '').trim();

      if (text.startsWith('/start')) {
        await handleStart(message, env, url.origin);
        return new Response('OK');
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleOrderEvent(request, env, origin) {
  const user = await validateRequestUser(request, env);
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

async function handleAdminStatus(request, env, origin) {
  const user = await validateRequestUser(request, env);
  if (!user || !isAdmin(env, user.id)) {
    return json({ ok: false, error: 'Admin authorization failed' }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Некорректный запрос' }, 400); }

  const order = cleanOrder(body?.order);
  const clientId = Number(body?.clientTelegramId || order?.client_telegram_id || 0);
  const status = String(body?.status || '');

  if (!order || !Number.isSafeInteger(clientId) || clientId <= 0) {
    return json({ ok: false, error: 'Нет Telegram ID клиента' }, 400);
  }

  const sent = await sendClientStatus(env, clientId, order, status, origin);
  if (!sent) return json({ ok: false, error: 'Не удалось отправить уведомление клиенту' }, 502);

  return json({ ok: true, clientNotified: true });
}

async function handleAdminCallback(query, env, origin) {
  if (!isAdmin(env, query?.from?.id)) {
    await safeTelegram(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Нет доступа',
      show_alert: true,
    });
    return;
  }

  const match = /^hc:(c|x|d):(\d+):(.+)$/.exec(String(query.data || ''));
  if (!match) {
    await safeTelegram(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Команда устарела',
    });
    return;
  }

  const action = match[1];
  const clientId = Number(match[2]);
  const orderNumber = decodeURIComponent(match[3]);
  const status = action === 'c' ? 'CONFIRMED' : action === 'x' ? 'CANCELLED' : 'COMPLETED';
  const details = extractDetails(query.message?.text || '');

  const sent = await sendClientStatus(
    env,
    clientId,
    { order_number: orderNumber, _detailsText: details },
    status,
    origin,
  );

  await safeTelegram(env, 'answerCallbackQuery', {
    callback_query_id: query.id,
    text: sent
      ? status === 'CONFIRMED'
        ? 'Заявка подтверждена'
        : status === 'COMPLETED'
          ? 'Уборка завершена'
          : 'Заявка отменена'
      : 'Клиент не получил уведомление',
    show_alert: !sent,
  });

  if (!sent || !query.message?.chat?.id || !query.message?.message_id) return;

  const replyMarkup = action === 'c'
    ? {
        inline_keyboard: [
          [{ text: 'Завершить уборку', callback_data: callbackData('d', clientId, orderNumber), style: 'success' }],
          [{ text: 'Отменить', callback_data: callbackData('x', clientId, orderNumber), style: 'danger' }],
          [{ text: 'Написать клиенту', url: `tg://user?id=${clientId}` }],
        ],
      }
    : {
        inline_keyboard: [[{ text: 'Написать клиенту', url: `tg://user?id=${clientId}` }]],
      };

  await safeTelegram(env, 'editMessageReplyMarkup', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    reply_markup: replyMarkup,
  });
}

async function handleStart(message, env, origin) {
  const chatId = message?.chat?.id;
  if (!chatId) return;

  if (env.TELEGRAM_WEBHOOK_SECRET) {
    await safeTelegram(env, 'setWebhook', {
      url: `${origin}/telegram/webhook`,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
      drop_pending_updates: false,
    });
  }

  const firstName = message?.from?.first_name || 'клиент';
  const keyboard = [[{
    text: '🧹 Заказать уборку',
    web_app: { url: `${origin}/?demo=1` },
    style: 'success',
  }]];

  if (isAdmin(env, chatId)) {
    keyboard.push([{
      text: '📋 Панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1` },
      style: 'primary',
    }]);
  }

  const greeting = [
    '✨ <b>HOUSE CLEANING</b>',
    '',
    `👋 Здравствуйте, ${escapeHtml(firstName)}.`,
    '',
    'Профессиональная уборка квартиры, дома или офиса — прямо в Telegram.',
    '',
    '🧹 Выберите вид уборки',
    '📐 Укажите площадь',
    '📷 Добавьте фото объекта',
    '📅 Выберите свободную дату и время',
    '',
    '🔔 После отправки бот сообщит о получении заявки, подтверждении, завершении или отмене.',
    '',
    'Нажмите кнопку ниже — оформление займёт около 2 минут.',
  ].join('\n');

  await safeTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: greeting,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function sendClientStatus(env, clientId, order, status, origin) {
  let title = '';
  let ending = '';

  if (status === 'CONFIRMED') {
    title = '✅ <b>Заявка подтверждена</b>';
    ending = 'Уборка подтверждена администратором. Если нужно что-то изменить — напишите менеджеру.';
  } else if (status === 'COMPLETED') {
    title = '✨ <b>Уборка завершена</b>';
    ending = 'Спасибо, что выбрали HOUSE CLEANING.';
  } else if (status === 'CANCELLED') {
    title = '❌ <b>Заявка отменена</b>';
    ending = 'Если хотите выбрать другую дату — откройте приложение или напишите менеджеру.';
  } else {
    return null;
  }

  const text = `${title}\n\n${orderDetails(order)}\n\n${ending}`;
  return safeTelegram(env, 'sendMessage', {
    chat_id: clientId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{
        text: 'Открыть HOUSE CLEANING',
        web_app: { url: `${origin}/?demo=1` },
        style: 'primary',
      }]],
    },
  });
}

function orderDetails(order) {
  if (order?._detailsText) return escapeHtml(order._detailsText);

  const lines = [`<b>${escapeHtml(order?.order_number || 'Заявка')}</b>`];
  if (order?.service_name) lines.push(`Уборка: ${escapeHtml(order.service_name)}`);
  if (Number(order?.area)) lines.push(`Площадь: <b>${Number(order.area)} м²</b>`);
  if (order?.date) lines.push(`Дата: <b>${escapeHtml(order.date)} · ${escapeHtml(order.time || '—')}</b>`);
  if (order?.city || order?.address) {
    lines.push(`Адрес: ${escapeHtml([order.city, order.address].filter(Boolean).join(', '))}`);
  }
  if (Array.isArray(order?.addon_names) && order.addon_names.length) {
    lines.push(`Дополнительно: ${escapeHtml(order.addon_names.join(', '))}`);
  }
  return lines.join('\n');
}

function extractDetails(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines
    .filter((line) => (
      /^HC-/.test(line)
      || /^Уборка:/.test(line)
      || /^Площадь:/.test(line)
      || /^Дата:/.test(line)
      || /^Адрес:/.test(line)
      || /^Дополнительно:/.test(line)
      || /^Фото:/.test(line)
    ))
    .join('\n') || 'Детали заказа смотрите в приложении.';
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
    `Дата: <b>${escapeHtml(order.date)} · ${escapeHtml(order.time || '—')}</b>`,
    `Адрес: ${escapeHtml(`${order.city}, ${order.address}`)}`,
    `Дополнительно: ${escapeHtml(order.addon_names.join(', ') || 'нет')}`,
    `Фото: ${order.photo_count}`,
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
    `Дата: <b>${escapeHtml(order.date)} · ${escapeHtml(order.time || '—')}</b>`,
    `Адрес: ${escapeHtml(`${order.city}, ${order.address}`)}`,
    '',
    `Telegram: ${user.username ? `@${escapeHtml(user.username)}` : `ID ${user.id}`}`,
  ].join('\n');
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
    client_telegram_id: Number(raw.client_telegram_id || 0),
  };
}

function callbackData(action, userId, orderNumber) {
  return `hc:${action}:${userId}:${encodeURIComponent(String(orderNumber).slice(0, 28))}`.slice(0, 64);
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]
    .filter(Boolean)
    .join(',');

  return [...new Set(
    String(raw)
      .split(/[;,\s]+/)
      .map((value) => value.trim())
      .filter((value) => /^-?\d+$/.test(value)),
  )];
}

function isAdmin(env, id) {
  return adminIds(env).includes(String(id));
}

async function validateRequestUser(request, env) {
  return validateInitData(
    request.headers.get('X-Telegram-Init-Data') || '',
    env.TELEGRAM_BOT_TOKEN,
  );
}

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  try {
    const params = new URLSearchParams(initData);
    const receivedHash = (params.get('hash') || '').toLowerCase();
    const authDate = Number(params.get('auth_date') || 0);
    const userRaw = params.get('user');

    if (!receivedHash || !authDate || !userRaw) return null;
    if (Math.abs(Date.now() / 1000 - authDate) > 86400) return null;

    params.delete('hash');
    const allEntries = [...params.entries()];
    const candidates = [
      allEntries,
      allEntries.filter(([key]) => key !== 'signature'),
    ];

    const encoder = new TextEncoder();
    const secret = await hmac(encoder.encode('WebAppData'), encoder.encode(botToken));

    let valid = false;
    for (const entries of candidates) {
      const checkString = [...entries]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

      const digest = await hmac(secret, encoder.encode(checkString));
      const hex = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

      if (constantEqual(hex, receivedHash)) {
        valid = true;
        break;
      }
    }

    if (!valid) return null;
    const user = JSON.parse(userRaw);
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, dataBytes);
}

function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

async function safeTelegram(env, method, payload) {
  try {
    return await telegram(env, method, payload);
  } catch (error) {
    console.error(`Telegram ${method} failed`, error);
    return null;
  }
}

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${method} failed`);
  }
  return data.result;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  });
}
