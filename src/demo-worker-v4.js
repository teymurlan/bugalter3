import baseWorker from './demo-worker-v3.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET
        && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      let update;
      try { update = await request.clone().json(); }
      catch { return new Response('Bad Request', { status: 400 }); }

      const query = update?.callback_query;
      if (query && String(query.data || '').startsWith('hc:')) {
        const handled = await handleConfirmation(query, update, request, env, ctx, url.origin);
        if (handled) return handled;
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleConfirmation(query, update, request, env, ctx, origin) {
  const match = /^hc:(c|x|yc|yx|n0|nc):(\d+):(.+)$/.exec(String(query.data || ''));
  if (!match) return null;

  if (!isAdmin(env, query?.from?.id)) {
    await safeTelegram(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Нет доступа',
      show_alert: true,
    });
    return new Response('OK');
  }

  const action = match[1];
  const clientId = Number(match[2]);
  const orderNumber = decodeURIComponent(match[3]);

  if (action === 'c' || action === 'x') {
    await askAgain(query, env, origin, action, clientId, orderNumber);
    return new Response('OK');
  }

  if (action === 'n0' || action === 'nc') {
    await restoreButtons(query, env, origin, action === 'nc', clientId, orderNumber);
    return new Response('OK');
  }

  const realAction = action === 'yc' ? 'c' : 'x';
  update.callback_query.data = callbackData(realAction, clientId, orderNumber);
  if (update.callback_query.message?.text) {
    update.callback_query.message.text = stripQuestion(update.callback_query.message.text);
  }

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  const forwarded = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(update),
  });
  return baseWorker.fetch(forwarded, env, ctx);
}

async function askAgain(query, env, origin, action, clientId, orderNumber) {
  if (!query.message?.chat?.id || !query.message?.message_id) return;

  const confirmedBefore = /Статус:\s*ПОДТВЕРЖДЕНА/i.test(String(query.message.text || ''));
  const base = stripQuestion(query.message.text || '');
  const isConfirm = action === 'c';

  const question = isConfirm
    ? '⚠️ <b>Вы точно хотите ПОДТВЕРДИТЬ эту заявку?</b>\nКлиент сразу получит уведомление о подтверждении.'
    : '⚠️ <b>Вы точно хотите ОТМЕНИТЬ эту заявку?</b>\nКлиент сразу получит уведомление об отмене.';

  const yesAction = isConfirm ? 'yc' : 'yx';
  const noAction = confirmedBefore ? 'nc' : 'n0';
  const yesText = isConfirm ? '✅ Да, подтвердить' : '❌ Да, отменить';
  const noText = isConfirm ? 'Нет, вернуться' : 'Нет, оставить заявку';

  await safeTelegram(env, 'answerCallbackQuery', {
    callback_query_id: query.id,
    text: 'Подтвердите действие ещё раз',
  });

  await safeTelegram(env, 'editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: `${escapeHtml(base)}\n\n${question}`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: yesText, callback_data: callbackData(yesAction, clientId, orderNumber), style: isConfirm ? 'success' : 'danger' }],
        [{ text: noText, callback_data: callbackData(noAction, clientId, orderNumber) }],
      ],
    },
  });
}

async function restoreButtons(query, env, origin, confirmedBefore, clientId, orderNumber) {
  if (!query.message?.chat?.id || !query.message?.message_id) return;

  const base = stripQuestion(query.message.text || '');
  const panelUrl = confirmedBefore
    ? syncUrl(origin, orderNumber, 'CONFIRMED', true)
    : `${origin}/?demo=1&admin=1`;

  const replyMarkup = confirmedBefore
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
          [
            { text: 'Подтвердить', callback_data: callbackData('c', clientId, orderNumber), style: 'success' },
            { text: 'Отменить', callback_data: callbackData('x', clientId, orderNumber), style: 'danger' },
          ],
          [{ text: 'Написать клиенту', url: `tg://user?id=${clientId}` }],
          [{ text: 'Панель заказов', web_app: { url: panelUrl }, style: 'primary' }],
        ],
      };

  await safeTelegram(env, 'answerCallbackQuery', {
    callback_query_id: query.id,
    text: 'Действие отменено',
  });

  await safeTelegram(env, 'editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: escapeHtml(base),
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });
}

function stripQuestion(text) {
  return String(text || '')
    .replace(/\n\n⚠️\s*Вы точно хотите (?:ПОДТВЕРДИТЬ|ОТМЕНИТЬ)[\s\S]*$/i, '')
    .trim();
}

function callbackData(action, userId, orderNumber) {
  return `hc:${action}:${userId}:${encodeURIComponent(String(orderNumber).slice(0, 28))}`.slice(0, 64);
}

function syncUrl(origin, orderNumber, status, admin) {
  const params = new URLSearchParams({
    demo: '1',
    sync_order: orderNumber,
    sync_status: status,
    route: admin ? 'admin' : 'orders',
  });
  if (admin) params.set('admin', '1');
  return `${origin}/?${params.toString()}`;
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]
    .filter(Boolean)
    .join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

function isAdmin(env, id) {
  return adminIds(env).includes(String(id));
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
