import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v28-notifications.js';

export { ConsentStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const REF_PERCENT = 15;
const MANAGER_PHONE = '+79992107977';
const ACTIVE_REMINDER_STATUSES = new Set(['CONFIRMED', 'CLEANER_ASSIGNED']);
const RELEASED_STATUSES = new Set(['CANCELLED']);
const CONSENT_VERSION = '2026-09-09-v1';

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/ref/stage' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const friendId = positiveInt(body.friend_id);
      const stage = String(body.stage || '');
      if (!friendId || !['started', 'accepted'].includes(stage)) return json({ ok: false, error: 'Invalid referral stage' }, 400);
      const friendKey = `ref:friend:${friendId}`;
      const existing = await this.state.storage.get(friendKey);
      if (!existing?.inviter_id) return json({ ok: true, tracked: false });
      if (existing.status === 'completed') return json({ ok: true, tracked: true, referral: existing });
      const now = new Date().toISOString();
      const user = body.user && typeof body.user === 'object' ? body.user : {};
      const next = {
        ...existing,
        status: stage === 'accepted' ? 'accepted' : (existing.status === 'accepted' ? 'accepted' : 'started'),
        started_at: existing.started_at || now,
        consent_accepted_at: stage === 'accepted' ? (existing.consent_accepted_at || now) : (existing.consent_accepted_at || null),
        friend_first_name: clean(user.first_name || existing.friend_first_name, 120),
        friend_last_name: clean(user.last_name || existing.friend_last_name, 120),
        friend_username: clean(user.username || existing.friend_username, 120),
      };
      await this.state.storage.transaction(async (txn) => {
        await txn.put(friendKey, next);
        await txn.put(`ref:invite:${next.inviter_id}:${friendId}`, next);
      });
      return json({ ok: true, tracked: true, referral: next });
    }

    if (url.pathname === '/ref/own-list' && request.method === 'GET') {
      const userId = positiveInt(url.searchParams.get('user'));
      if (!userId) return json({ ok: false, error: 'Invalid user' }, 400);
      return json({ ok: true, referrals: await this.referralRows(userId) });
    }

    if (url.pathname === '/ref/admin-list' && request.method === 'GET') {
      const raw = await this.state.storage.list({ prefix: 'ref:invite:' });
      const unique = new Map();
      for (const item of raw.values()) {
        if (!item?.inviter_id || !item?.friend_id) continue;
        unique.set(`${item.inviter_id}:${item.friend_id}`, item);
      }
      const referrals = [];
      for (const item of unique.values()) referrals.push(await this.referralRow(item));
      referrals.sort((a, b) => String(b.registered_at || b.started_at || '').localeCompare(String(a.registered_at || a.started_at || '')));
      return json({ ok: true, referrals });
    }

    if (url.pathname === '/benefits' && request.method === 'GET') {
      const userId = positiveInt(url.searchParams.get('user'));
      if (!userId) return json({ ok: false, error: 'Invalid user' }, 400);
      return json({ ok: true, ...(await this.benefitsV29(userId)) });
    }

    if (url.pathname === '/ref/reward-arm' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const userId = positiveInt(body.user_id);
      if (!userId) return json({ ok: false, error: 'Invalid user' }, 400);
      const benefits = await this.benefitsV29(userId);
      const enabled = Boolean(body.enabled);
      if (enabled && Number(benefits.available_referral_rewards || 0) < 1) {
        return json({ ok: false, error: 'Нет доступной реферальной скидки' }, 409);
      }
      if (enabled) await this.state.storage.put(`ref:reward-armed:${userId}`, new Date().toISOString());
      else await this.state.storage.delete(`ref:reward-armed:${userId}`);
      return json({ ok: true, ...(await this.benefitsV29(userId)) });
    }

    if (url.pathname === '/ref/reward-notify-reserve' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const friendId = positiveInt(body.friend_id);
      const orderNumber = cleanOrderNumber(body.order_number);
      if (!friendId || !orderNumber) return json({ ok: false, notify: false }, 400);
      const referral = await this.state.storage.get(`ref:friend:${friendId}`);
      if (!referral?.inviter_id || referral.status !== 'completed') return json({ ok: true, notify: false });
      if (referral.completed_order_number && String(referral.completed_order_number) !== orderNumber) return json({ ok: true, notify: false });
      const key = `ref:reward-notified:${friendId}:${orderNumber}`;
      if (await this.state.storage.get(key)) return json({ ok: true, notify: false });
      await this.state.storage.put(key, new Date().toISOString());
      return json({ ok: true, notify: true, inviter_id: referral.inviter_id });
    }

    if (url.pathname === '/ref/reward-notify-release' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const friendId = positiveInt(body.friend_id);
      const orderNumber = cleanOrderNumber(body.order_number);
      if (friendId && orderNumber) await this.state.storage.delete(`ref:reward-notified:${friendId}:${orderNumber}`);
      return json({ ok: true });
    }

    if (url.pathname === '/reminder/candidates' && request.method === 'GET') {
      const now = Number(url.searchParams.get('now') || Date.now());
      const values = await this.state.storage.list({ prefix: 'order:' });
      const candidates = [];
      for (const order of values.values()) {
        if (!order?.client_telegram_id || !order?.order_number || !ACTIVE_REMINDER_STATUSES.has(String(order.status || ''))) continue;
        const start = orderTimestamp(order);
        if (!Number.isFinite(start)) continue;
        const hours = (start - now) / 3600000;
        if (hours < 23.4 || hours > 24.6) continue;
        const key = reminderKey(order.client_telegram_id, order.order_number);
        if (await this.state.storage.get(key)) continue;
        candidates.push(order);
      }
      return json({ ok: true, orders: candidates });
    }

    if (url.pathname === '/reminder/mark' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const clientId = positiveInt(body.client_telegram_id);
      const orderNumber = cleanOrderNumber(body.order_number);
      if (!clientId || !orderNumber) return json({ ok: false }, 400);
      await this.state.storage.put(reminderKey(clientId, orderNumber), new Date().toISOString());
      return json({ ok: true });
    }

    return super.fetch(request);
  }

  async referralRows(inviterId) {
    const values = await this.state.storage.list({ prefix: `ref:invite:${inviterId}:` });
    const rows = [];
    for (const item of values.values()) if (item?.friend_id) rows.push(await this.referralRow(item));
    rows.sort((a, b) => String(b.registered_at || b.started_at || '').localeCompare(String(a.registered_at || a.started_at || '')));
    return rows;
  }

  async referralRow(item) {
    const friendId = positiveInt(item.friend_id);
    const inviterId = positiveInt(item.inviter_id);
    const friendOrdersRaw = friendId ? await this.state.storage.list({ prefix: `order:${friendId}:` }) : new Map();
    const inviterOrdersRaw = inviterId ? await this.state.storage.list({ prefix: `order:${inviterId}:` }) : new Map();
    const friendOrders = [...friendOrdersRaw.values()].filter(Boolean);
    const inviterOrders = [...inviterOrdersRaw.values()].filter(Boolean);
    const created = friendOrders.length > 0;
    const confirmed = friendOrders.some((order) => ['CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(String(order.status || '')));
    const completed = friendOrders.some((order) => String(order.status || '') === 'COMPLETED') || item.status === 'completed';
    const rewardCount = Math.max(0, Number(await this.state.storage.get(`ref:reward-count:${inviterId}`) || 0));
    const rewardUsed = Math.max(0, Number(await this.state.storage.get(`ref:reward-used:${inviterId}`) || 0));
    const stage = completed ? 'completed' : confirmed ? 'confirmed' : created ? 'ordered' : item.consent_accepted_at ? 'accepted' : 'started';
    const friendName = friendOrders[0]?.customer_name
      || [item.friend_first_name, item.friend_last_name].filter(Boolean).join(' ')
      || (item.friend_username ? `@${item.friend_username}` : '')
      || `ID ${friendId}`;
    return {
      inviter_id: inviterId,
      inviter_name: inviterOrders[0]?.customer_name || `ID ${inviterId}`,
      friend_id: friendId,
      friend_name: friendName,
      friend_username: item.friend_username || '',
      registered_at: item.registered_at || item.started_at || null,
      started_at: item.started_at || item.registered_at || null,
      consent_accepted_at: item.consent_accepted_at || null,
      order_created: created,
      order_confirmed: confirmed,
      completed,
      stage,
      inviter_rewarded: item.status === 'completed',
      inviter_rewards_available: Math.max(0, rewardCount - rewardUsed),
      inviter_rewards_used: rewardUsed,
      friend_discount_percent: completed ? 0 : REF_PERCENT,
    };
  }

  async benefitsV29(userId) {
    const ordersRaw = await this.state.storage.list({ prefix: `order:${userId}:` });
    const orders = [...ordersRaw.values()].filter(Boolean);
    const completed = orders.filter((order) => String(order.status || '') === 'COMPLETED').length;
    const loyalty = completed >= 10 ? 10 : completed >= 3 ? 5 : 0;
    const activeFriendReservation = orders.some((order) => order.discount_type === 'referral_friend' && !RELEASED_STATUSES.has(String(order.status || '')));
    const activeRewardReservations = orders.filter((order) => order.discount_type === 'referral_reward' && !RELEASED_STATUSES.has(String(order.status || '')) && String(order.status || '') !== 'COMPLETED').length;
    const friendReferral = await this.state.storage.get(`ref:friend:${userId}`);
    const rewardCount = Math.max(0, Number(await this.state.storage.get(`ref:reward-count:${userId}`) || 0));
    const rewardUsed = Math.max(0, Number(await this.state.storage.get(`ref:reward-used:${userId}`) || 0));
    const rawAvailable = Math.max(0, rewardCount - rewardUsed);
    const availableRewards = Math.max(0, rawAvailable - activeRewardReservations);
    const friendDiscount = friendReferral && completed === 0 && !activeFriendReservation ? REF_PERCENT : 0;
    const rewardArmed = Boolean(await this.state.storage.get(`ref:reward-armed:${userId}`)) && availableRewards > 0;
    const referral = friendDiscount || (rewardArmed ? REF_PERCENT : 0);
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
      reserved_referral_rewards: activeRewardReservations,
      referral_reward_armed: rewardArmed,
      referral_percent: referral,
      selected_percent: selected,
      selected_type: selectedType,
    };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/manager-contact' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      return json({
        ok: true,
        telegram_id: positiveInt(adminIds(env)[0]),
        phone: MANAGER_PHONE,
      });
    }

    if (url.pathname === '/api/referral-dashboard' && request.method === 'GET') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const userId = userIdFromInitData(request.headers.get('X-Telegram-Init-Data') || '');
      if (!userId) return response;
      const data = await response.json().catch(() => ({}));
      const stub = appStub(env);
      const [listResponse, benefitsResponse] = await Promise.all([
        stub?.fetch(`https://app.internal/ref/own-list?user=${encodeURIComponent(userId)}`),
        stub?.fetch(`https://app.internal/benefits?user=${encodeURIComponent(userId)}`),
      ]);
      const list = listResponse?.ok ? await listResponse.json() : { referrals: [] };
      const benefits = benefitsResponse?.ok ? await benefitsResponse.json() : {};
      return json({
        ...data,
        referrals: Array.isArray(list.referrals) ? list.referrals : [],
        available_rewards: Number(benefits.available_referral_rewards || data.available_rewards || 0),
        reward_armed: Boolean(benefits.referral_reward_armed),
        available_discount_percent: Number(benefits.referral_percent || data.available_discount_percent || 0),
      });
    }

    if (url.pathname === '/api/referral-reward' && request.method === 'POST') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      let body = {};
      try { body = await request.json(); } catch {}
      const response = await appStub(env)?.fetch('https://app.internal/ref/reward-arm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, enabled: Boolean(body.enabled) }),
      });
      return response ? proxy(response) : json({ ok: false, error: 'Storage unavailable' }, 503);
    }

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      let body = {};
      try { body = await request.clone().json(); } catch {}
      if (String(body?.status || '') === 'COMPLETED') return completeFromWeb(request, env, ctx, body, url.origin);
      return baseWorker.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      try {
        const data = await response.clone().json();
        const order = data?.order || data?.notification?.order;
        if (order?.discount_type === 'referral_reward' && order?.client_telegram_id) {
          await appStub(env)?.fetch('https://app.internal/ref/reward-arm', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ user_id: order.client_telegram_id, enabled: false }),
          });
        }
      } catch {}
      return response;
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
      let update = null;
      try { update = await request.clone().json(); } catch { return new Response('Bad Request', { status: 400 }); }
      const completeMatch = /^hc:d:(\d+):(.+)$/.exec(String(update?.callback_query?.data || ''));
      if (completeMatch) return completeFromCallback(update.callback_query, env, url.origin);

      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;

      const message = update?.message || update?.edited_message;
      const text = String(message?.text || '').trim();
      const friendId = positiveInt(message?.from?.id);
      const referralStart = /^\/start(?:@\w+)?\s+ref_(HC[A-Z0-9]+)$/i.exec(text);
      if (referralStart && friendId) {
        await markReferralStage(env, friendId, 'started', message.from);
        const consent = await getConsent(env, friendId);
        if (consent?.status === 'accepted' && consent?.version === CONSENT_VERSION) {
          await markReferralStage(env, friendId, 'accepted', message.from);
        }
      }

      const query = update?.callback_query;
      const consentMatch = /^pd:accept:(.+)$/.exec(String(query?.data || ''));
      if (query && consentMatch && consentMatch[1] === CONSENT_VERSION && query.from?.id) {
        await markReferralStage(env, positiveInt(query.from.id), 'accepted', query.from);
      }
      return response;
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(sendDueReminders(env));
  },
};

async function completeFromWeb(request, env, ctx, body, origin) {
  const admin = await validateRequestUser(request, env);
  if (!admin || !isAdmin(env, admin.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);
  const clientId = positiveInt(body?.clientTelegramId || body?.order?.client_telegram_id);
  const orderNumber = cleanOrderNumber(body?.order?.order_number);
  if (!clientId || !orderNumber) return json({ ok: false, error: 'Недостаточно данных' }, 400);
  const stored = await appOrder(env, clientId, orderNumber);
  const order = { ...(stored || {}), ...(body.order || {}), client_telegram_id: clientId, order_number: orderNumber };
  const sent = await sendCompletionMessage(env, clientId, order, origin);
  if (!sent) return json({ ok: false, error: 'Telegram не доставил уведомление клиенту' }, 502);
  await appUpdateStatus(env, clientId, orderNumber, 'COMPLETED');
  await completeReferral(env, clientId, orderNumber);
  await notifyReferralReward(env, clientId, orderNumber, origin);
  return json({ ok: true, status: 'COMPLETED', clientNotified: true });
}

async function completeFromCallback(query, env, origin) {
  if (!isAdmin(env, query?.from?.id)) {
    await safeTelegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Нет доступа', show_alert: true });
    return new Response('OK');
  }
  const match = /^hc:d:(\d+):(.+)$/.exec(String(query?.data || ''));
  if (!match) return new Response('OK');
  const clientId = positiveInt(match[1]);
  let orderNumber = '';
  try { orderNumber = cleanOrderNumber(decodeURIComponent(match[2])); } catch { orderNumber = cleanOrderNumber(match[2]); }
  const order = await appOrder(env, clientId, orderNumber);
  if (!order) {
    await safeTelegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Заявка не найдена', show_alert: true });
    return new Response('OK');
  }
  const sent = await sendCompletionMessage(env, clientId, order, origin);
  if (!sent) {
    await safeTelegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Не удалось уведомить клиента', show_alert: true });
    return new Response('OK');
  }
  await appUpdateStatus(env, clientId, orderNumber, 'COMPLETED');
  await completeReferral(env, clientId, orderNumber);
  await notifyReferralReward(env, clientId, orderNumber, origin);
  await safeTelegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Уборка завершена' });
  if (query.message?.chat?.id && query.message?.message_id) {
    const base = stripTrailingStatus(query.message.text || '');
    await safeTelegram(env, 'editMessageText', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text: `${escapeHtml(base)}\n\n✨ <b>Статус: ЗАВЕРШЕНА</b>`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Открыть панель заказов', web_app: { url: `${origin}/?demo=1&admin=1` }, style: 'primary' }],
          [{ text: '✉️ Написать клиенту', url: `tg://user?id=${clientId}` }],
        ],
      },
    });
  }
  return new Response('OK');
}

async function sendCompletionMessage(env, clientId, order, origin) {
  const lines = [
    '✨ <b>Уборка завершена</b>', '',
    `<b>${escapeHtml(order.order_number || '')}</b>`,
  ];
  if (order.service_name) lines.push(`Уборка: ${escapeHtml(order.service_name)}`);
  if (Number(order.area || 0)) lines.push(`Площадь: <b>${Number(order.area)} м²</b>`);
  if (order.date) lines.push(`Дата: <b>${formatDate(order.date)}</b>`);
  if (order.time) lines.push(`Время: <b>${formatTime(order.time)}</b>`);
  if (order.city || order.address) lines.push(`Адрес: ${escapeHtml([order.city, order.address].filter(Boolean).join(', '))}`);
  if (Array.isArray(order.addon_names) && order.addon_names.length) lines.push(`Дополнительно: ${escapeHtml(order.addon_names.join(', '))}`);
  lines.push('', 'Спасибо, что выбрали HOUSE CLEANING.', 'Будем рады вашему отзыву — это займёт меньше минуты.');
  return safeTelegram(env, 'sendMessage', {
    chat_id: clientId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Открыть заявку', web_app: { url: syncClientUrl(origin, order.order_number) }, style: 'primary' }],
        [{ text: '⭐ Оставить отзыв', web_app: { url: `${origin}/?demo=1&review=${encodeURIComponent(order.order_number)}` }, style: 'success' }],
      ],
    },
  });
}

async function completeReferral(env, friendId, orderNumber) {
  try {
    const response = await appStub(env)?.fetch('https://app.internal/ref/complete', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ friend_id: friendId, order_number: orderNumber }),
    });
    return response?.ok ? await response.json().catch(() => ({})) : null;
  } catch { return null; }
}

async function notifyReferralReward(env, friendId, orderNumber, origin) {
  const stub = appStub(env);
  if (!stub) return false;
  const reserve = await stub.fetch('https://app.internal/ref/reward-notify-reserve', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ friend_id: friendId, order_number: orderNumber }),
  });
  if (!reserve.ok) return false;
  const data = await reserve.json();
  if (!data.notify || !positiveInt(data.inviter_id)) return false;
  const inviterId = positiveInt(data.inviter_id);
  const sent = await safeTelegram(env, 'sendMessage', {
    chat_id: inviterId,
    text: ['🎁 <b>Вам начислена скидка 15%</b>', '', 'Ваш друг успешно завершил уборку по вашей ссылке.', 'Скидка 15% появилась в профиле HOUSE CLEANING и доступна для следующей уборки.'].join('\n'),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Открыть скидку', web_app: { url: `${origin}/?demo=1&open=referral` }, style: 'success' }]] },
  });
  if (!sent) {
    await stub.fetch('https://app.internal/ref/reward-notify-release', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ friend_id: friendId, order_number: orderNumber }),
    });
    return false;
  }
  return true;
}

async function markReferralStage(env, friendId, stage, user) {
  if (!friendId) return;
  try {
    await appStub(env)?.fetch('https://app.internal/ref/stage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ friend_id: friendId, stage, user }),
    });
  } catch {}
}

async function sendDueReminders(env) {
  const stub = appStub(env);
  if (!stub) return;
  const response = await stub.fetch(`https://app.internal/reminder/candidates?now=${Date.now()}`);
  if (!response.ok) return;
  const orders = (await response.json())?.orders || [];
  const managerId = positiveInt(adminIds(env)[0]);
  for (const order of orders) {
    const clientId = positiveInt(order.client_telegram_id);
    const orderNumber = cleanOrderNumber(order.order_number);
    if (!clientId || !orderNumber) continue;
    const lines = [
      '⏰ <b>Напоминание об уборке</b>', '',
      `Завтра, <b>${formatDate(order.date)}</b> в <b>${formatTime(order.time)}</b>.`,
      order.service_name ? `Уборка: ${escapeHtml(order.service_name)}` : '',
      order.city || order.address ? `Адрес: ${escapeHtml([order.city, order.address].filter(Boolean).join(', '))}` : '',
      '',
      'Если нужно уточнить детали, напишите менеджеру.',
    ].filter(Boolean);
    const sent = await safeTelegram(env, 'sendMessage', {
      chat_id: clientId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      ...(managerId ? { reply_markup: { inline_keyboard: [[{ text: '✉️ Написать менеджеру', url: `tg://user?id=${managerId}` }]] } } : {}),
    });
    if (sent) {
      await stub.fetch('https://app.internal/reminder/mark', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_telegram_id: clientId, order_number: orderNumber }),
      });
    }
  }
}

async function appOrder(env, clientId, orderNumber) {
  const response = await appStub(env)?.fetch(`https://app.internal/order?user=${encodeURIComponent(clientId)}&number=${encodeURIComponent(orderNumber)}`);
  return response?.ok ? await response.json() : null;
}

async function appUpdateStatus(env, clientId, orderNumber, status) {
  const response = await appStub(env)?.fetch('https://app.internal/status', {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_telegram_id: clientId, order_number: orderNumber, status }),
  });
  return response?.ok ? (await response.json())?.order : null;
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function getConsent(env, userId) {
  try {
    if (!env.CONSENT_STORE || !userId) return null;
    const response = await env.CONSENT_STORE.get(env.CONSENT_STORE.idFromName(String(userId))).fetch('https://consent.internal/record');
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

function syncClientUrl(origin, orderNumber) {
  const params = new URLSearchParams({ demo: '1', sync_order: String(orderNumber || ''), sync_status: 'COMPLETED', route: 'orders' });
  return `${origin}/?${params.toString()}`;
}

function orderTimestamp(order) {
  const date = String(order?.date || '');
  const time = String(order?.time || '').slice(0, 5);
  if (!date || !time) return NaN;
  return Date.parse(`${date}T${time}:00+03:00`);
}

function reminderKey(clientId, orderNumber) { return `reminder24:${clientId}:${orderNumber}`; }
function stripTrailingStatus(text) { return String(text || '').replace(/\n\n(?:✅|✨|❌)?\s*Статус:[\s\S]*$/i, '').replace(/\n\n⚠️[\s\S]*$/i, '').trim(); }
function clean(value, max = 160) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max); }
function cleanOrderNumber(value) { const v = String(value || '').trim(); return /^[A-Za-z0-9._-]{3,80}$/.test(v) ? v : ''; }
function positiveInt(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 0; }
function userIdFromInitData(initData) { try { return positiveInt(JSON.parse(new URLSearchParams(initData).get('user') || '{}')?.id); } catch { return 0; } }
function adminIds(env) { const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(','); return [...new Set(String(raw).split(/[;,\s]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v)))]; }
function isAdmin(env, id) { return adminIds(env).includes(String(id)); }
function formatDate(value) { const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}.${m[2]}.${m[1]}` : escapeHtml(value || '—'); }
function formatTime(value) { const m = String(value || '').match(/^(\d{1,2}):(\d{2})/); return m ? `${String(Number(m[1])).padStart(2, '0')}:${m[2]}` : escapeHtml(value || '—'); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char)); }

async function validateRequestUser(request, env) { return validateInitData(request.headers.get('X-Telegram-Init-Data') || '', env.TELEGRAM_BOT_TOKEN); }
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
async function hmac(keyBytes, dataBytes) { const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return crypto.subtle.sign('HMAC', key, dataBytes); }
function constantEqual(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
async function safeTelegram(env, method, payload) { try { return await telegram(env, method, payload); } catch (error) { console.error(`Telegram ${method} failed`, error); return null; } }
async function telegram(env, method, payload) { const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`); return data.result; }
function proxy(response) { const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); return new Response(response.body, { status: response.status, headers }); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' } }); }
