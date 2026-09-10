import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v15.js';
import { calcQuote, moneyToWordsRu } from './kp-math.js';

export { ConsentStore };

const KP_VERSION = '15';
const CONSENT_VERSION = '2026-09-09-v1';
const EMPTY_ADDRESS = '__HC_NO_ADDRESS__';
const PAYMENT_CHOICES = new Set([20, 30, 50, 100]);

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/kp/list' && request.method === 'GET') {
      const response = await super.fetch(request);
      if (!response.ok) return response;
      const data = await response.json();
      data.quotes = (data.quotes || []).filter((quote) => {
        // Старые КП до этой версии считаем историей. Новые черновики получают downloaded_at=null.
        return !Object.prototype.hasOwnProperty.call(quote || {}, 'downloaded_at') || Boolean(quote?.downloaded_at);
      });
      return json(data);
    }

    if (url.pathname === '/kp/publish' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Некорректные данные' }, 400); }
      const id = cleanId(body?.id);
      if (!id) return json({ ok: false, error: 'Некорректный ID' }, 400);
      const key = `kp:item:${id}`;
      const quote = await this.state.storage.get(key);
      if (!quote) return json({ ok: false, error: 'КП не найдено' }, 404);
      const updated = { ...quote, downloaded_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await this.state.storage.put(key, updated);
      return json({ ok: true, quote: updated });
    }

    return super.fetch(request);
  }

  async saveQuote(raw) {
    const existingId = cleanId(raw?.id);
    const existing = existingId ? await this.state.storage.get(`kp:item:${existingId}`) : null;
    const paymentPercent = normalizePaymentPercent(raw?.prepayment_percent);
    if (!paymentPercent) throw new Error('Выберите условия оплаты: 20%, 30%, 50% или 100%');

    const normalized = {
      ...raw,
      address: String(raw?.address || '').trim() || EMPTY_ADDRESS,
      notes: '',
      prepayment_percent: paymentPercent,
      payment_terms: paymentTermsFor(paymentPercent),
    };

    const quote = await super.saveQuote(normalized);
    const updated = {
      ...quote,
      address: quote.address === EMPTY_ADDRESS ? '' : String(quote.address || ''),
      notes: '',
      prepayment_percent: paymentPercent,
      payment_terms: paymentTermsFor(paymentPercent),
    };

    // Новое КП до фактического скачивания скрыто из истории.
    if (existing && Object.prototype.hasOwnProperty.call(existing, 'downloaded_at')) {
      updated.downloaded_at = existing.downloaded_at;
    } else if (!existing) {
      updated.downloaded_at = null;
    }

    await this.state.storage.put(`kp:item:${updated.id}`, updated);
    return updated;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/kp') {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = '/kp/';
      redirectUrl.searchParams.set('v', KP_VERSION);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    if (url.pathname === '/api/kp/bootstrap' && request.method === 'GET') {
      const response = await baseWorker.fetch(request, kpAccessEnv(env), ctx);
      return patchBootstrap(response);
    }

    if (url.pathname === '/api/kp/preview' && request.method === 'POST') {
      return handlePreview(request, env, ctx);
    }

    if (url.pathname === '/api/kp/publish' && request.method === 'POST') {
      return handlePublish(request, env, ctx);
    }

    if (url.pathname.startsWith('/api/kp/')) {
      return baseWorker.fetch(request, kpAccessEnv(env), ctx);
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
      const text = String(message?.text || '').trim().toLowerCase();
      const userId = Number(message?.from?.id || update?.callback_query?.from?.id || 0);

      if (text === '/id') {
        await handleIdCommand(message, env);
        return new Response('OK');
      }

      if (text === '/kp') {
        await handleKpCommand(message, env, url.origin);
        return new Response('OK');
      }

      if (text.startsWith('/start') || text === '/menu') {
        const response = await baseWorker.fetch(request, env, ctx);
        if (userId && canUseKp(env, userId)) {
          await decorateAdminMenuAfterCommand(env, userId, url.origin);
        }
        return response;
      }

      const query = update?.callback_query;
      if (query && /^pd:accept:/.test(String(query.data || ''))) {
        const response = await baseWorker.fetch(request, env, ctx);
        const queryUserId = Number(query?.from?.id || 0);
        if (queryUserId && canUseKp(env, queryUserId)) {
          await safeTelegram(env, 'editMessageReplyMarkup', {
            chat_id: Number(query?.message?.chat?.id || 0),
            message_id: Number(query?.message?.message_id || 0),
            reply_markup: roleKeyboard(env, queryUserId, url.origin),
          });
        }
        return response;
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function patchBootstrap(response) {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) return response;
  let data;
  try { data = await response.clone().json(); }
  catch { return response; }

  if (data?.ok) {
    data.defaults = {
      ...(data.defaults || {}),
      prepayment_percent: 0,
      payment_terms: '',
    };
  }

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=UTF-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
}

async function handlePreview(request, env, ctx) {
  const authRequest = new Request(new URL('/api/kp/bootstrap', request.url), {
    method: 'GET',
    headers: request.headers,
  });
  const authResponse = await baseWorker.fetch(authRequest, kpAccessEnv(env), ctx);
  if (!authResponse.ok) return authResponse;

  let bootstrap;
  try { bootstrap = await authResponse.json(); }
  catch { return json({ ok: false, error: 'Ошибка авторизации' }, 500); }
  if (!bootstrap?.ok) return json({ ok: false, error: bootstrap?.error || 'Доступ запрещён' }, 403);

  let raw;
  try { raw = await request.json(); }
  catch { return json({ ok: false, error: 'Некорректные данные' }, 400); }

  try {
    const paymentPercent = normalizePaymentPercent(raw?.prepayment_percent);
    if (!paymentPercent) throw new Error('Выберите условия оплаты: 20%, 30%, 50% или 100%');
    const calculation = calcQuote({ ...raw, prepayment_percent: paymentPercent });
    if (!calculation.items.length) throw new Error('Добавьте хотя бы одну услугу');
    if (calculation.total <= 0) throw new Error('Итоговая стоимость должна быть больше нуля');

    const issueDate = cleanDate(raw?.issue_date) || bootstrap.defaults?.issue_date || spbToday();
    const validDays = clampInt(raw?.valid_days, 1, 90, 14);
    const sequence = parseOutgoingNumber(raw?.outgoing_number)
      || parseOutgoingNumber(bootstrap.defaults?.quote_number)
      || 14;

    const quote = {
      id: cleanId(raw?.id) || '',
      quote_number: `Исх. № ${sequence}`,
      issue_date: issueDate,
      valid_days: validDays,
      valid_until: addDays(issueDate, validDays),
      client_name: String(raw?.client_name || '').trim().slice(0, 180),
      client_company: String(raw?.client_company || '').trim().slice(0, 180),
      address: '',
      object_type: String(raw?.object_type || bootstrap.defaults?.object_type || 'Коммерческое помещение').trim().slice(0, 100),
      area: normalizeOptionalNumber(raw?.area),
      title: String(raw?.title || bootstrap.defaults?.title || 'Коммерческое предложение на оказание клининговых услуг').trim().slice(0, 220),
      duration: String(raw?.duration || bootstrap.defaults?.duration || '1–2 дня').trim().slice(0, 220),
      payment_terms: paymentTermsFor(paymentPercent),
      notes: '',
      vat_label: String(raw?.vat_label || bootstrap.company?.vat_label || 'Без НДС').trim().slice(0, 80),
      equipment: String(raw?.equipment || bootstrap.defaults?.equipment || '').trim().slice(0, 1400),
      ...calculation,
      prepayment_percent: paymentPercent,
      total_words: moneyToWordsRu(calculation.total),
      company: bootstrap.company || {},
    };

    return json({ ok: true, quote });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 400);
  }
}

async function handlePublish(request, env, ctx) {
  const authRequest = new Request(new URL('/api/kp/bootstrap', request.url), {
    method: 'GET',
    headers: request.headers,
  });
  const authResponse = await baseWorker.fetch(authRequest, kpAccessEnv(env), ctx);
  if (!authResponse.ok) return authResponse;

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Некорректные данные' }, 400); }
  const id = cleanId(body?.id);
  if (!id) return json({ ok: false, error: 'Некорректный ID' }, 400);

  const stub = appStub(env);
  if (!stub) return json({ ok: false, error: 'Хранилище КП не настроено' }, 503);
  const response = await stub.fetch('https://app.internal/kp/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return proxyJson(response);
}

async function handleIdCommand(message, env) {
  const userId = Number(message?.from?.id || 0);
  const chatId = Number(message?.chat?.id || 0);
  if (!userId || !chatId) return;

  const username = String(message?.from?.username || '').trim();
  const fullName = [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(' ').trim();
  await safeTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: `<b>Ваш Telegram ID:</b> <code>${userId}</code>`,
    parse_mode: 'HTML',
  });

  const mainAdmin = primaryAdminId(env);
  if (mainAdmin && Number(mainAdmin) !== userId) {
    const details = [
      '<b>Запрос /id</b>',
      '',
      `ID: <code>${userId}</code>`,
      fullName ? `Имя: ${escapeHtml(fullName)}` : '',
      username ? `Username: @${escapeHtml(username)}` : '',
    ].filter(Boolean).join('\n');
    await safeTelegram(env, 'sendMessage', { chat_id: Number(mainAdmin), text: details, parse_mode: 'HTML' });
  }
}

async function handleKpCommand(message, env, origin) {
  const userId = Number(message?.from?.id || 0);
  const chatId = Number(message?.chat?.id || 0);
  if (!userId || !chatId || !canUseKp(env, userId)) return;

  await safeTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: Number(message?.message_id || 0) });
  await safeTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: '<b>HOUSE CLEANING · Коммерческие предложения</b>\n\nСоздание, скачивание и история КП.',
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{
        text: 'Коммерческие предложения',
        web_app: { url: `${origin}/kp` },
        style: 'success',
      }]],
    },
  });
}

async function decorateAdminMenuAfterCommand(env, userId, origin) {
  const consent = await getConsent(env, userId);
  if (!(consent?.status === 'accepted' && consent?.version === CONSENT_VERSION)) return;
  const menuId = await getMenuId(env, userId);
  if (!menuId) return;
  await safeTelegram(env, 'editMessageReplyMarkup', {
    chat_id: Number(userId),
    message_id: Number(menuId),
    reply_markup: roleKeyboard(env, userId, origin),
  });
}

function roleKeyboard(env, userId, origin) {
  const rows = [[{
    text: 'Открыть HOUSE CLEANING',
    web_app: { url: `${origin}/?demo=1` },
    style: 'success',
  }]];

  if (isFullAdmin(env, userId)) {
    rows.push([{
      text: 'Панель администратора',
      web_app: { url: `${origin}/?demo=1&admin=1` },
      style: 'primary',
    }]);
  }

  if (canUseKp(env, userId)) {
    rows.push([{
      text: 'Коммерческие предложения',
      web_app: { url: `${origin}/kp` },
      style: 'success',
    }]);
  }

  return { inline_keyboard: rows };
}

function kpAccessEnv(env) {
  const combined = [...new Set([...fullAdminIds(env), ...kpAdminIds(env)])].join(',');
  return { ...env, ADMIN_TELEGRAM_IDS: combined };
}

function fullAdminIds(env) {
  return parseIds([env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]);
}

function kpAdminIds(env) {
  return parseIds([env.KP_ADMIN_TELEGRAM_IDS, env.KP_ADMIN_TELEGRAM_ID]);
}

function parseIds(values) {
  return [...new Set(values.filter(Boolean).join(',').split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

function isFullAdmin(env, id) {
  return fullAdminIds(env).includes(String(id));
}

function canUseKp(env, id) {
  return isFullAdmin(env, id) || kpAdminIds(env).includes(String(id));
}

function primaryAdminId(env) {
  const preferred = [env.MAIN_ADMIN_TELEGRAM_ID, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID]
    .map((value) => String(value || '').trim())
    .find((value) => /^-?\d+$/.test(value));
  return preferred || fullAdminIds(env)[0] || '';
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

function appStub(env) {
  if (!env.APP_STORE) return null;
  const id = env.APP_STORE.idFromName('house-cleaning-app-v1');
  return env.APP_STORE.get(id);
}

function normalizePaymentPercent(value) {
  const number = Math.round(Number(String(value ?? '').replace(',', '.')));
  return PAYMENT_CHOICES.has(number) ? number : 0;
}

function paymentTermsFor(percent) {
  if (percent === 100) return 'Оплата производится по счету в 100% размере.';
  return `Предоплата ${percent}%. Остаток — после выполнения работ.`;
}

function parseOutgoingNumber(value) {
  const match = String(value ?? '').match(/\d+/);
  if (!match) return 0;
  const number = Math.floor(Number(match[0]));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cleanDate(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}$/);
  return match ? String(value) : '';
}

function addDays(dateString, days) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function spbToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function clampInt(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeOptionalNumber(value) {
  const number = Number(String(value ?? '').replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : '';
}

async function proxyJson(response) {
  let data = null;
  try { data = await response.json(); } catch {}
  return json(data || { ok: response.ok }, response.status);
}

async function safeTelegram(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return data?.ok ? data.result : null;
  } catch { return null; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
