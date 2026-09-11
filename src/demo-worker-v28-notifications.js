import profileWorker, { ConsentStore, AppStore as ProfileAppStore } from './demo-worker-v27-client-profile.js';
import legacyWorker from './demo-worker-v26-referral-reservations.js';

export { ConsentStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';

export class AppStore extends ProfileAppStore {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/review/invite-release' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const clientId = positiveInt(body.client_telegram_id);
      const orderNumber = cleanOrderNumber(body.order_number);
      if (!clientId || !orderNumber) return json({ ok: false }, 400);
      await this.state.storage.delete(`review:invite:${clientId}:${orderNumber}`);
      return json({ ok: true });
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      let body = {};
      try { body = await request.clone().json(); } catch {}
      const clientId = positiveInt(body?.clientTelegramId || body?.order?.client_telegram_id);
      const orderNumber = cleanOrderNumber(body?.order?.order_number);
      const completed = String(body?.status || '') === 'COMPLETED' && clientId && orderNumber;
      if (!completed) return profileWorker.fetch(request, env, ctx);

      const reserved = await reserveInvite(env, clientId, orderNumber);
      const response = await legacyWorker.fetch(request, env, ctx);
      if (response.ok && reserved) {
        const sent = await sendInvite(env, clientId, orderNumber, url.origin);
        if (!sent) await releaseInvite(env, clientId, orderNumber);
      }
      return response;
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      let update = null;
      try { update = await request.clone().json(); } catch {}
      const match = /^hc:d:(\d+):(.+)$/.exec(String(update?.callback_query?.data || ''));
      if (!match) return profileWorker.fetch(request, env, ctx);

      const clientId = positiveInt(match[1]);
      let orderNumber = '';
      try { orderNumber = cleanOrderNumber(decodeURIComponent(match[2])); }
      catch { orderNumber = cleanOrderNumber(match[2]); }
      if (!clientId || !orderNumber) return profileWorker.fetch(request, env, ctx);

      const reserved = await reserveInvite(env, clientId, orderNumber);
      const response = await legacyWorker.fetch(request, env, ctx);
      if (response.ok && reserved) {
        const sent = await sendInvite(env, clientId, orderNumber, url.origin);
        if (!sent) await releaseInvite(env, clientId, orderNumber);
      }
      return response;
    }

    return profileWorker.fetch(request, env, ctx);
  },
};

async function reserveInvite(env, clientId, orderNumber) {
  try {
    const stub = appStub(env);
    if (!stub) return false;
    const check = await stub.fetch(`https://app.internal/review/invite-check?user=${encodeURIComponent(clientId)}&order=${encodeURIComponent(orderNumber)}`);
    if (check.ok && (await check.json())?.sent) return false;
    const mark = await stub.fetch('https://app.internal/review/invite-mark', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_telegram_id: clientId, order_number: orderNumber }),
    });
    return mark.ok;
  } catch (error) {
    console.error('Review invite reserve failed', error);
    return false;
  }
}

async function releaseInvite(env, clientId, orderNumber) {
  try {
    await appStub(env)?.fetch('https://app.internal/review/invite-release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_telegram_id: clientId, order_number: orderNumber }),
    });
  } catch {}
}

async function sendInvite(env, clientId, orderNumber, origin) {
  try {
    const stub = appStub(env);
    if (!stub) return false;
    const reviewCheck = await stub.fetch(`https://app.internal/review/get?user=${encodeURIComponent(clientId)}&order=${encodeURIComponent(orderNumber)}`);
    if (reviewCheck.ok) return true;
    const result = await telegram(env, 'sendMessage', {
      chat_id: clientId,
      text: ['🏠 <b>HOUSE CLEANING</b>', '', 'Уборка завершена ✨', '', 'Спасибо, что выбрали нас.', 'Оцените нашу работу — это займёт меньше минуты.'].join('\n'),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '⭐ Оставить отзыв', web_app: { url: `${origin}/?demo=1&review=${encodeURIComponent(orderNumber)}` }, style: 'success' }]] },
    });
    return Boolean(result);
  } catch (error) {
    console.error('Review invite failed', error);
    return false;
  }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
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

function positiveInt(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 0; }
function cleanOrderNumber(value) { const v = String(value || '').trim(); return /^[A-Za-z0-9._-]{3,80}$/.test(v) ? v : ''; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' } }); }
