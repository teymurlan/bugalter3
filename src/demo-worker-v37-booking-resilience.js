import baseWorker, { ConsentStore, AppStore } from './demo-worker-v36-release.js';

export { ConsentStore, AppStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-order-media' && request.method === 'POST') {
      const copy = request.clone();
      const response = await baseWorker.fetch(request, env, ctx);
      if (response.ok) return response;

      let body = {};
      try { body = await copy.json(); } catch {}
      const user = await authorizedUser(copy, env, ctx);
      const orderNumber = cleanOrderNumber(body.order_number);
      const order = user && orderNumber ? await appOrder(env, user.id, orderNumber) : null;
      if (!user || !order) return response;

      const delivered = await notifyAdminsFallback(env, user, order, url.origin);
      console.error('Order photo album delivery failed; fallback notification used', {
        order_number: orderNumber,
        admin_notified: delivered,
        upstream_status: response.status,
      });

      return json({
        ok: true,
        adminNotified: delivered,
        photoNotified: false,
        fallbackNotified: delivered > 0,
        warning: 'Фотографии не удалось прикрепить автоматически. Заявка сохранена.',
        order,
      });
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function notifyAdminsFallback(env, user, order, origin) {
  const ids = adminIds(env);
  if (!ids.length) return 0;
  const text = [
    '<b>НОВАЯ ЗАЯВКА · HOUSE CLEANING</b>',
    '',
    `<b>${escapeHtml(order.order_number)}</b>`,
    `Клиент: <b>${escapeHtml(order.customer_name || user.first_name || 'Клиент')}</b>`,
    order.phone ? `Телефон: ${escapeHtml(order.phone)}` : '',
    `Уборка: ${escapeHtml(order.service_name || 'Уборка')}`,
    `Площадь: <b>${Number(order.area || 0)} м²</b>`,
    `Дата: <b>${formatDate(order.date)}</b> · <b>${escapeHtml(String(order.time || '—').slice(0, 5))}</b>`,
    `Адрес: ${escapeHtml([order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : ''].filter(Boolean).join(', '))}`,
    order.addon_names?.length ? `Дополнительно: ${escapeHtml(order.addon_names.join(', '))}` : '',
    Number(order.discount_percent) > 0 ? `Скидка: <b>${Number(order.discount_percent)}%</b>` : '',
    Number(order.estimated_price) > 0 ? `Предварительно: <b>от ${money(order.estimated_price)}</b>` : '',
    '',
    '⚠️ Фото объекта не прикрепились автоматически. Заявка сохранена — при необходимости запросите фото у клиента.',
  ].filter(Boolean).join('\n');

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

  let delivered = 0;
  for (const id of ids) {
    try {
      await telegram(env, 'sendMessage', { chat_id: Number(id), text, parse_mode: 'HTML', reply_markup: keyboard });
      delivered += 1;
    } catch (error) {
      console.error('Fallback admin notification failed', error);
    }
  }
  return delivered;
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
    return Number(user?.id) > 0 ? user : null;
  } catch { return null; }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function appOrder(env, userId, number) {
  const response = await appStub(env)?.fetch(`https://app.internal/order?user=${encodeURIComponent(userId)}&number=${encodeURIComponent(number)}`);
  return response?.ok ? response.json() : null;
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

function callbackData(action, userId, orderNumber) {
  return `hc:${action}:${userId}:${encodeURIComponent(String(orderNumber).slice(0, 28))}`.slice(0, 64);
}

function cleanOrderNumber(value) {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(raw) ? raw : '';
}

function formatDate(value) {
  const raw = String(value || '');
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : raw;
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
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

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
