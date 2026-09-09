import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v9.js';
import { calcQuote, makeQuoteNumber, moneyToWordsRu } from './kp-math.js';

export { ConsentStore };

const COMPANY = Object.freeze({
  name: 'ИП Царегородцева Евгения Андреевна',
  inn: '781157991880',
  ogrnip: '325784700025441',
  legal_address: '195030, Россия, г. Санкт-Петербург, ул. Дыбенко д. 6, корп. 2',
  phone: '+7 999 210 79 77',
  email: 'cleaning@tsaregorodtseva-1.ru',
  brand: 'HOUSE CLEANING',
  region: 'Санкт-Петербург и Ленинградская область',
  vat_label: 'Без НДС',
});

const PRESETS = Object.freeze([
  { name: 'Уборка после ремонта', unit: 'м²', price: 480 },
  { name: 'Финишная уборка после ремонта', unit: 'м²', price: 160 },
  { name: 'Генеральная уборка', unit: 'м²', price: 0 },
  { name: 'Поддерживающая уборка', unit: 'м²', price: 0 },
  { name: 'Помывка окон', unit: 'шт', price: 1300 },
  { name: 'Зеркала и зеркальные поверхности', unit: 'усл.', price: 6000 },
  { name: 'Дополнительные работы', unit: 'усл.', price: 0 },
]);

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/kp/peek-number' && request.method === 'GET') {
      const year = safeYear(url.searchParams.get('year'));
      const counter = Number(await this.state.storage.get(`kp:counter:${year}`) || 0);
      return json({ ok: true, number: makeQuoteNumber(year, counter + 1) });
    }

    if (url.pathname === '/kp/list' && request.method === 'GET') {
      const values = await this.state.storage.list({ prefix: 'kp:item:' });
      const quotes = [...values.values()]
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 200);
      return json({ ok: true, quotes });
    }

    if (url.pathname === '/kp/item' && request.method === 'GET') {
      const id = cleanId(url.searchParams.get('id'));
      if (!id) return json({ ok: false, error: 'Некорректный ID' }, 400);
      const quote = await this.state.storage.get(`kp:item:${id}`);
      return quote ? json({ ok: true, quote }) : json({ ok: false, error: 'КП не найдено' }, 404);
    }

    if (url.pathname === '/kp/save' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Некорректный JSON' }, 400); }

      try {
        const quote = await this.saveQuote(body || {});
        return json({ ok: true, quote });
      } catch (error) {
        return json({ ok: false, error: String(error?.message || error) }, 400);
      }
    }

    if (url.pathname === '/kp/delete' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Некорректный JSON' }, 400); }
      const id = cleanId(body?.id);
      if (!id) return json({ ok: false, error: 'Некорректный ID' }, 400);
      await this.state.storage.delete(`kp:item:${id}`);
      return json({ ok: true });
    }

    return super.fetch(request);
  }

  async saveQuote(raw) {
    const existingId = cleanId(raw?.id);
    const existing = existingId ? await this.state.storage.get(`kp:item:${existingId}`) : null;
    const clientName = String(raw?.client_name || '').trim();
    const address = String(raw?.address || '').trim();
    if (!clientName) throw new Error('Укажите клиента');
    if (!address) throw new Error('Укажите адрес объекта');

    const calculation = calcQuote(raw);
    if (!calculation.items.length) throw new Error('Добавьте хотя бы одну услугу');
    if (calculation.total <= 0) throw new Error('Итоговая стоимость должна быть больше нуля');

    const issueDate = cleanDate(raw?.issue_date) || spbToday();
    const validDays = clampInt(raw?.valid_days, 1, 90, 14);
    const now = new Date().toISOString();
    const id = existing?.id || existingId || crypto.randomUUID();
    const year = Number(issueDate.slice(0, 4));

    let quoteNumber = existing?.quote_number || '';
    if (!quoteNumber) {
      quoteNumber = await this.state.storage.transaction(async (txn) => {
        const key = `kp:counter:${year}`;
        const current = Number(await txn.get(key) || 0);
        const next = current + 1;
        await txn.put(key, next);
        return makeQuoteNumber(year, next);
      });
    }

    const quote = {
      id,
      quote_number: quoteNumber,
      issue_date: issueDate,
      valid_days: validDays,
      valid_until: addDays(issueDate, validDays),
      client_name: clientName.slice(0, 180),
      client_company: String(raw?.client_company || '').trim().slice(0, 180),
      address: address.slice(0, 350),
      object_type: String(raw?.object_type || 'Жилое помещение').trim().slice(0, 100),
      area: normalizeOptionalNumber(raw?.area),
      title: String(raw?.title || 'Коммерческое предложение по уборке').trim().slice(0, 220),
      duration: String(raw?.duration || '').trim().slice(0, 220),
      payment_terms: String(raw?.payment_terms || '').trim().slice(0, 220),
      notes: String(raw?.notes || '').trim().slice(0, 800),
      vat_label: String(raw?.vat_label || COMPANY.vat_label).trim().slice(0, 80),
      ...calculation,
      total_words: moneyToWordsRu(calculation.total),
      company: COMPANY,
      created_by: Number(raw?.created_by || existing?.created_by || 0),
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    await this.state.storage.put(`kp:item:${id}`, quote);
    return quote;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if ((url.pathname === '/kp' || url.pathname === '/kp/') && request.method === 'GET') {
      return env.ASSETS.fetch(new Request(new URL('/kp/index.html', url.origin), request));
    }

    if (url.pathname.startsWith('/api/kp/')) {
      return handleQuoteApi(request, env);
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      const handled = await maybeHandleAdminQuoteMenu(request, env, url.origin);
      if (handled) return handled;
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleQuoteApi(request, env) {
  const user = await validateRequestUser(request, env);
  if (!user || !isAdmin(env, user.id)) {
    return json({ ok: false, error: 'Доступ только для администратора' }, 403);
  }

  const url = new URL(request.url);
  const stub = appStub(env);
  if (!stub) return json({ ok: false, error: 'Хранилище КП не настроено' }, 503);

  if (url.pathname === '/api/kp/bootstrap' && request.method === 'GET') {
    const year = Number(spbToday().slice(0, 4));
    const next = await stub.fetch(`https://app.internal/kp/peek-number?year=${year}`);
    const nextData = next.ok ? await next.json() : { number: makeQuoteNumber(year, 1) };
    return json({
      ok: true,
      admin: { id: Number(user.id), first_name: user.first_name || '' },
      company: COMPANY,
      presets: PRESETS,
      defaults: {
        quote_number: nextData.number,
        issue_date: spbToday(),
        valid_days: 14,
        prepayment_percent: 50,
        payment_terms: 'Предоплата 50%. Остаток — после выполнения работ.',
        vat_label: COMPANY.vat_label,
      },
    });
  }

  if (url.pathname === '/api/kp/list' && request.method === 'GET') {
    const response = await stub.fetch('https://app.internal/kp/list');
    return proxyJson(response);
  }

  if (url.pathname === '/api/kp/get' && request.method === 'GET') {
    const id = cleanId(url.searchParams.get('id'));
    if (!id) return json({ ok: false, error: 'Некорректный ID' }, 400);
    const response = await stub.fetch(`https://app.internal/kp/item?id=${encodeURIComponent(id)}`);
    return proxyJson(response);
  }

  if (url.pathname === '/api/kp/save' && request.method === 'POST') {
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: 'Некорректные данные' }, 400); }
    const response = await stub.fetch('https://app.internal/kp/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, created_by: Number(user.id) }),
    });
    return proxyJson(response);
  }

  if (url.pathname === '/api/kp/delete' && request.method === 'POST') {
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: 'Некорректные данные' }, 400); }
    const response = await stub.fetch('https://app.internal/kp/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: body?.id }),
    });
    return proxyJson(response);
  }

  return json({ ok: false, error: 'Not found' }, 404);
}

async function maybeHandleAdminQuoteMenu(request, env, origin) {
  if (env.TELEGRAM_WEBHOOK_SECRET
    && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let update;
  try { update = await request.clone().json(); }
  catch { return null; }

  const message = update?.message || update?.edited_message;
  const text = String(message?.text || '').trim().toLowerCase();
  if (text !== '/kp' && text !== '/admin') return null;

  const userId = Number(message?.from?.id || 0);
  const chatId = Number(message?.chat?.id || 0);
  if (!userId || !chatId) return new Response('OK');
  if (!isAdmin(env, userId)) return new Response('OK');

  await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: message.message_id });
  const previous = await getMenuId(env, userId);
  if (previous) await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: previous });

  const sent = await safeTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: '<b>HOUSE CLEANING · Администратор</b>\n\nЗаявки и коммерческие предложения доступны отдельными модулями.',
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Панель заявок', web_app: { url: `${origin}/?demo=1&admin=1` }, style: 'primary' }],
        [{ text: 'Коммерческие предложения', web_app: { url: `${origin}/kp` }, style: 'success' }],
      ],
    },
  });
  if (sent?.message_id) await saveMenuId(env, userId, sent.message_id);
  return new Response('OK');
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  const id = env.APP_STORE.idFromName('house-cleaning-app-v1');
  return env.APP_STORE.get(id);
}

async function getMenuId(env, userId) {
  const stub = appStub(env);
  if (!stub) return 0;
  try {
    const response = await stub.fetch(`https://app.internal/menu?user=${encodeURIComponent(userId)}`);
    if (!response.ok) return 0;
    const data = await response.json();
    return Number(data?.message_id || 0);
  } catch { return 0; }
}

async function saveMenuId(env, userId, messageId) {
  const stub = appStub(env);
  if (!stub) return;
  try {
    await stub.fetch('https://app.internal/menu', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: String(userId), message_id: Number(messageId) }),
    });
  } catch {}
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

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

function isAdmin(env, id) {
  return adminIds(env).includes(String(id));
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

async function safeTelegram(env, method, payload) {
  try { return await telegram(env, method, payload); }
  catch (error) { console.error(`Telegram ${method} failed`, error); return null; }
}

async function proxyJson(response) {
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : '';
}

function safeYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : Number(spbToday().slice(0, 4));
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeOptionalNumber(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

function cleanDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : raw;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function spbToday() {
  const shifted = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
