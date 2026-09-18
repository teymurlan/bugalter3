import baseWorker, { ConsentStore as BaseConsentStore, AppStore as BaseAppStore } from './demo-worker-v43-cache-bust.js';

const RELEASE = '62';
const CONSENT_VERSION = '2026-09-09-v1';
const APP_STORE_NAME = 'house-cleaning-app-v1';
const CLEAN_START_MARKER = 'system:clean-start:v45';
let cleanStartPromise = null;

export class ConsentStore extends BaseConsentStore {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/system/reset' && request.method === 'POST') {
      await clearStorage(this.state.storage);
      return json({ ok: true });
    }
    return super.fetch(request);
  }
}

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/system/clean-start/status' && request.method === 'GET') {
      const marker = await this.state.storage.get(CLEAN_START_MARKER);
      return json({ ok: true, marker: marker || null });
    }

    if (url.pathname === '/system/clean-start/claim' && request.method === 'POST') {
      const marker = await this.state.storage.get(CLEAN_START_MARKER);
      if (marker?.status === 'complete') return json({ ok: true, claimed: false, complete: true });
      const startedAt = Number(marker?.started_at || 0);
      if (marker?.status === 'running' && Date.now() - startedAt < 30000) {
        return json({ ok: true, claimed: false, running: true });
      }
      await this.state.storage.put(CLEAN_START_MARKER, { status: 'running', started_at: Date.now() });
      return json({ ok: true, claimed: true });
    }

    if (url.pathname === '/system/clean-start/snapshot' && request.method === 'GET') {
      const rows = await this.state.storage.list();
      const userIds = new Set();
      for (const [key, value] of rows.entries()) {
        harvestUserIds(key, userIds);
        harvestUserIds(value, userIds);
      }
      return json({ ok: true, user_ids: [...userIds] });
    }

    if (url.pathname === '/system/clean-start/finish' && request.method === 'POST') {
      await clearStorage(this.state.storage);
      await this.state.storage.put(CLEAN_START_MARKER, {
        status: 'complete',
        completed_at: new Date().toISOString(),
        generation: 'v45-clean-launch',
      });
      return json({ ok: true, complete: true });
    }

    return super.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if ((url.pathname.startsWith('/api/') || url.pathname === '/telegram/webhook')
      && url.pathname !== '/api/release-version') {
      try {
        await ensureCleanStart(env);
      } catch (error) {
        console.error('One-time clean start failed', error);
        return json({ ok: false, error: 'Подготавливаем чистую базу. Повторите через несколько секунд.' }, 503);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/release-version') {
      return json({ ok: true, release: RELEASE, worker: 'demo-worker-v44-production', clean_generation: 'v45' });
    }

    if (isKpPath(url.pathname)) {
      if (request.method === 'GET' && (url.pathname === '/kp' || url.pathname === '/kp/')) {
        const target = new URL('/', url.origin);
        target.searchParams.set('demo', '1');
        target.searchParams.set('release', RELEASE);
        return new Response(null, {
          status: 302,
          headers: {
            location: target.toString(),
            'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
            'x-house-cleaning-release': RELEASE,
          },
        });
      }
      return json({ ok: false, error: 'Раздел КП отключён' }, 404);
    }

    if (url.pathname === '/api/demo-order'
      && request.method === 'POST'
      && request.headers.get('X-HC-Photo-Bundle') === '1') {
      let body = null;
      try { body = await request.clone().json(); } catch {}
      const response = await baseWorker.fetch(request, env, ctx);
      if (response.ok) {
        const data = await response.clone().json().catch(() => ({}));
        if (data?.ok && !data?.duplicateRecovered) {
          const order = data?.order || body?.order;
          await notifyAdminsImmediately(env, order, url.origin);
        }
      }
      return withRelease(response);
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      let update = null;
      try { update = await request.clone().json(); } catch {}

      const message = update?.message || update?.edited_message;
      const command = commandName(message?.text);
      const chatId = positiveInt(message?.chat?.id);
      const userId = positiveInt(message?.from?.id || update?.callback_query?.from?.id);

      if (command === '/kp') {
        if (chatId && message?.message_id) {
          await telegramSafe(env, 'deleteMessage', {
            chat_id: chatId,
            message_id: Number(message.message_id),
          });
        }
        return json({ ok: true, kp_disabled: true });
      }

      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok || !update || !userId) return withRelease(response);

      const callbackData = String(update?.callback_query?.data || '');
      const accepted = callbackData === `pd:accept:${CONSENT_VERSION}`;
      if (command === '/start' || command === '/menu' || accepted) {
        await forceCleanTelegramMenu(env, userId, url.origin, { forceAccepted: accepted });
      }
      return withRelease(response);
    }

    const response = await baseWorker.fetch(request, env, ctx);
    return withRelease(response);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function ensureCleanStart(env) {
  if (!cleanStartPromise) {
    cleanStartPromise = runCleanStart(env).catch((error) => {
      cleanStartPromise = null;
      throw error;
    });
  }
  return cleanStartPromise;
}

async function runCleanStart(env) {
  const stub = appStub(env);
  if (!stub) return;

  const statusResponse = await stub.fetch('https://app.internal/system/clean-start/status');
  const statusData = statusResponse.ok ? await statusResponse.json().catch(() => ({})) : {};
  if (statusData?.marker?.status === 'complete') return;

  const claimResponse = await stub.fetch('https://app.internal/system/clean-start/claim', { method: 'POST' });
  if (!claimResponse.ok) throw new Error('Unable to claim clean start');
  const claim = await claimResponse.json().catch(() => ({}));
  if (!claim?.claimed) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await delay(100);
      const poll = await stub.fetch('https://app.internal/system/clean-start/status');
      const data = poll.ok ? await poll.json().catch(() => ({})) : {};
      if (data?.marker?.status === 'complete') return;
    }
    throw new Error('Clean start is still running');
  }

  const userIds = new Set();
  try {
    const snapshot = await stub.fetch('https://app.internal/system/clean-start/snapshot');
    const data = snapshot.ok ? await snapshot.json().catch(() => ({})) : {};
    for (const id of data?.user_ids || []) if (positiveInt(id)) userIds.add(Number(id));
  } catch (error) {
    console.warn('App snapshot before reset skipped', error);
  }

  const db = findD1(env);
  if (db) {
    for (const table of ['hc_clients', 'hc_orders', 'hc_drafts', 'hc_reviews', 'hc_referrals']) {
      try {
        const result = await db.prepare(`SELECT * FROM ${table}`).all();
        for (const row of Array.isArray(result?.results) ? result.results : []) harvestUserIds(row, userIds);
      } catch {}
    }
  }

  if (env.CONSENT_STORE) {
    await Promise.allSettled([...userIds].map(async (id) => {
      const objectId = env.CONSENT_STORE.idFromName(String(id));
      const consent = env.CONSENT_STORE.get(objectId);
      await consent.fetch('https://consent.internal/system/reset', { method: 'POST' });
    }));
  }

  if (db) {
    for (const table of ['hc_drafts', 'hc_reviews', 'hc_referrals', 'hc_orders', 'hc_clients']) {
      try { await db.prepare(`DELETE FROM ${table}`).run(); }
      catch (error) { console.warn(`D1 reset skipped for ${table}`, error); }
    }
  }

  const finish = await stub.fetch('https://app.internal/system/clean-start/finish', { method: 'POST' });
  if (!finish.ok) throw new Error('Unable to finish clean start');
}

async function notifyAdminsImmediately(env, order, origin) {
  if (!order?.order_number) return;
  const ids = adminIds(env);
  if (!ids.length) return;
  const address = [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : ''].filter(Boolean).join(', ');
  const addons = Array.isArray(order.addon_names) && order.addon_names.length ? order.addon_names.join(', ') : 'Нет';
  const text = [
    '🟡 <b>НОВАЯ ЗАЯВКА</b>',
    '',
    `<b>${escapeHtml(order.order_number)}</b>`,
    `Уборка: <b>${escapeHtml(order.service_name || 'Уборка')}</b>`,
    `Дата: <b>${escapeHtml(formatDate(order.date))}</b> · <b>${escapeHtml(String(order.time || '').slice(0, 5))}</b>`,
    `Адрес: ${escapeHtml(address)}`,
    Number(order.area) > 0 ? `Площадь: <b>${Number(order.area)} м²</b>` : '',
    `Доп. услуги: ${escapeHtml(addons)}`,
    `Клиент: <b>${escapeHtml(order.customer_name || 'Клиент')}</b>`,
    order.phone ? `Телефон: <b>${escapeHtml(order.phone)}</b>` : '',
    '',
    '📸 Фотографии объекта загружаются следом.',
  ].filter(Boolean).join('\n');

  await Promise.allSettled(ids.map((id) => telegram(env, 'sendMessage', {
    chat_id: Number(id),
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{
        text: 'Открыть панель',
        web_app: { url: `${origin}/?demo=1&admin=1&release=${RELEASE}` },
        style: 'primary',
      }]],
    },
  })));
}

function isKpPath(pathname) {
  return pathname === '/kp' || pathname.startsWith('/kp/') || pathname === '/api/kp' || pathname.startsWith('/api/kp/');
}

async function forceCleanTelegramMenu(env, userId, origin, { forceAccepted = false } = {}) {
  const consent = forceAccepted ? { status: 'accepted', version: CONSENT_VERSION } : await getConsent(env, userId);
  if (!(consent?.status === 'accepted' && consent?.version === CONSENT_VERSION)) return;

  const keyboard = roleKeyboard(env, userId, origin);
  const menuId = await getMenuId(env, userId);
  const clientUrl = `${origin}/?demo=1&release=${RELEASE}`;

  const tasks = [
    telegramSafe(env, 'setChatMenuButton', {
      chat_id: userId,
      menu_button: {
        type: 'web_app',
        text: 'HOUSE CLEANING',
        web_app: { url: clientUrl },
      },
    }),
  ];

  if (menuId) {
    tasks.push(telegramSafe(env, 'editMessageReplyMarkup', {
      chat_id: userId,
      message_id: menuId,
      reply_markup: keyboard,
    }));
  }

  await Promise.allSettled(tasks);
}

function roleKeyboard(env, userId, origin) {
  const rows = [[{
    text: 'Открыть HOUSE CLEANING',
    web_app: { url: `${origin}/?demo=1&release=${RELEASE}` },
    style: 'primary',
  }]];

  if (isFullAdmin(env, userId)) {
    rows.push([{
      text: 'Панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1&release=${RELEASE}` },
      style: 'danger',
    }]);
  }

  return { inline_keyboard: rows };
}

async function getConsent(env, userId) {
  if (!env.CONSENT_STORE || !userId) return null;
  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const response = await env.CONSENT_STORE.get(id).fetch('https://consent.internal/record');
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function getMenuId(env, userId) {
  if (!env.APP_STORE || !userId) return 0;
  try {
    const id = env.APP_STORE.idFromName(APP_STORE_NAME);
    const response = await env.APP_STORE.get(id).fetch(`https://app.internal/menu?user=${encodeURIComponent(userId)}`);
    if (!response.ok) return 0;
    return Number((await response.json())?.message_id || 0);
  } catch { return 0; }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

function findD1(env) {
  for (const name of ['DB', 'D1', 'DATABASE']) {
    const value = env?.[name];
    if (value && typeof value.prepare === 'function') return value;
  }
  for (const value of Object.values(env || {})) {
    if (value && typeof value.prepare === 'function' && typeof value.batch === 'function') return value;
  }
  return null;
}

async function clearStorage(storage) {
  const rows = await storage.list();
  const keys = [...rows.keys()];
  if (!keys.length) return;
  try {
    for (let index = 0; index < keys.length; index += 128) {
      await storage.delete(keys.slice(index, index + 128));
    }
  } catch {
    for (const key of keys) await storage.delete(key);
  }
}

function harvestUserIds(value, out, depth = 0) {
  if (depth > 4 || value == null) return;
  if (typeof value === 'number' || typeof value === 'string') {
    const raw = String(value);
    if (/^\d{5,20}$/.test(raw)) out.add(Number(raw));
    if (typeof value === 'string') {
      for (const match of raw.matchAll(/(?:user|client|telegram|draft|profile)[:_-](\d{5,20})/gi)) out.add(Number(match[1]));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) harvestUserIds(item, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:user_id|telegram_id|client_telegram_id|inviter_id|referee_id)$/i.test(key) && positiveInt(item)) out.add(Number(item));
      else harvestUserIds(item, out, depth + 1);
    }
  }
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}
function isFullAdmin(env, id) { return adminIds(env).includes(String(id)); }
function commandName(value) {
  const first = String(value || '').trim().split(/\s+/, 1)[0].toLowerCase();
  return first.split('@', 1)[0];
}
function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value || '');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function withRelease(response) {
  const headers = new Headers(response.headers);
  headers.set('x-house-cleaning-release', RELEASE);
  if ((headers.get('content-type') || '').includes('text/html')) {
    headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
    headers.set('pragma', 'no-cache');
    headers.set('expires', '0');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function telegramSafe(env, method, payload) {
  try { return await telegram(env, method, payload); }
  catch (error) { console.error(`Telegram ${method} failed`, error); return null; }
}
async function telegram(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Bot token missing');
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
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'x-house-cleaning-release': RELEASE,
    },
  });
}
