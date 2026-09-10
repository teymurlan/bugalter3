import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v18.js';
import { calcQuote, moneyToWordsRu } from './kp-math.js';

export { ConsentStore };

const KP_VERSION = '20';
const DEFAULT_EQUIPMENT = [
  'Моющий пылесос Karcher WD 3',
  'Пылесос для сухой уборки Karcher WD 6',
  'Пароочиститель Karcher SC 4',
].join('\n');

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
  { group: 'Основные тарифы', name: 'Коммерческая уборка', unit: 'м²', price: 95 },
  { group: 'Основные тарифы', name: 'Генеральная уборка', unit: 'м²', price: 230 },
  { group: 'Основные тарифы', name: 'Поддерживающая уборка', unit: 'м²', price: 95 },
  { group: 'Основные тарифы', name: 'Уборка после ремонта', unit: 'м²', price: 230 },
  { group: 'Отдельные услуги', name: 'Обеспыливание потолков, вентиляционных решёток и коммуникаций', unit: 'м²', price: 0 },
  { group: 'Отдельные услуги', name: 'Обеспыливание стен и поверхностей', unit: 'м²', price: 0 },
  { group: 'Отдельные услуги', name: 'Мытьё окон', unit: 'шт.', price: 0 },
  { group: 'Отдельные услуги', name: 'Мытьё витрин', unit: 'м²', price: 0 },
  { group: 'Отдельные услуги', name: 'Мытьё дверей', unit: 'шт.', price: 0 },
  { group: 'Отдельные услуги', name: 'Мытьё стеклянных перегородок', unit: 'м²', price: 0 },
  { group: 'Отдельные услуги', name: 'Мытьё полов', unit: 'м²', price: 0 },
  { group: 'Отдельные услуги', name: 'Мытьё плинтусов', unit: 'пог. м', price: 0 },
  { group: 'Отдельные услуги', name: 'Уборка санузлов', unit: 'усл.', price: 0 },
  { group: 'Отдельные услуги', name: 'Удаление строительной пыли и загрязнений', unit: 'м²', price: 0 },
  { group: 'Отдельные услуги', name: 'Локальная очистка труднодоступных участков', unit: 'усл.', price: 0 },
]);

export class AppStore extends BaseAppStore {
  async saveQuote(raw) {
    const percent = normalizePaymentPercent(raw?.prepayment_percent);
    if (percent !== 0) return super.saveQuote({ ...raw, prepayment_percent: percent });

    // Старый слой требовал 20/30/50/100. Для варианта без предоплаты
    // сохраняем через совместимое значение, а затем корректируем итоговую запись.
    const quote = await super.saveQuote({
      ...raw,
      prepayment_percent: 100,
      payment_terms: 'Оплата производится по счету в 100% размере.',
    });
    const updated = {
      ...quote,
      prepayment_percent: 0,
      prepayment: 0,
      balance: Number(quote.total || 0),
      payment_terms: '',
    };
    await this.state.storage.put(`kp:item:${updated.id}`, updated);
    return updated;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/kp/health') {
      return json({ ok: true, version: KP_VERSION, time: new Date().toISOString() });
    }

    if (request.method === 'GET' && url.pathname === '/kp') {
      const target = new URL(request.url);
      target.pathname = '/kp/';
      target.searchParams.set('v', KP_VERSION);
      return Response.redirect(target.toString(), 302);
    }

    if (request.method === 'GET' && url.pathname === '/kp/') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/kp/index.html';
      assetUrl.search = '';
      const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
      return noStore(response, 'text/html; charset=UTF-8');
    }

    if (request.method === 'GET' && url.pathname === '/api/kp/bootstrap') {
      return handleBootstrap(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/kp/preview') {
      return handlePreview(request, env);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function handleBootstrap(request, env) {
  const user = await validateRequestUser(request, env);
  if (!user) {
    return json({ ok: false, error: 'Не удалось подтвердить Telegram. Закройте мини-приложение и откройте КП заново через кнопку в боте.' }, 401);
  }
  if (!canUseKp(env, user.id)) {
    return json({ ok: false, error: `Telegram ID ${user.id} не добавлен в администраторы КП.` }, 403);
  }

  let nextNumber = 'Исх. № 15';
  try {
    const stub = appStub(env);
    if (stub) {
      const response = await withTimeout(stub.fetch('https://app.internal/kp/peek-number'), 650);
      if (response?.ok) {
        const data = await response.json();
        if (data?.number) nextNumber = String(data.number);
      }
    }
  } catch {
    // Номер не должен блокировать вход в КП. При сохранении сервер всё равно
    // присвоит/проверит фактический номер.
  }

  return json({
    ok: true,
    version: KP_VERSION,
    admin: { id: Number(user.id), first_name: String(user.first_name || '') },
    company: COMPANY,
    presets: PRESETS,
    defaults: {
      quote_number: nextNumber,
      issue_date: spbToday(),
      valid_days: 14,
      prepayment_percent: 0,
      payment_terms: '',
      vat_label: COMPANY.vat_label,
      duration: '1–2 дня',
      equipment: DEFAULT_EQUIPMENT,
      object_type: 'Коммерческое помещение',
      title: 'Коммерческое предложение на оказание клининговых услуг',
    },
  });
}

async function handlePreview(request, env) {
  const user = await validateRequestUser(request, env);
  if (!user || !canUseKp(env, user.id)) return json({ ok: false, error: 'Доступ только для администратора КП' }, 403);

  let raw;
  try { raw = await request.json(); }
  catch { return json({ ok: false, error: 'Некорректные данные' }, 400); }

  try {
    const percent = normalizePaymentPercent(raw?.prepayment_percent);
    const calculation = calcQuote({ ...raw, prepayment_percent: percent });
    if (!calculation.items.length) throw new Error('Добавьте хотя бы одну услугу');
    if (calculation.total <= 0) throw new Error('Укажите количество и цену услуги. Итоговая стоимость должна быть больше нуля');

    const issueDate = cleanDate(raw?.issue_date) || spbToday();
    const validDays = clampInt(raw?.valid_days, 1, 90, 14);
    const sequence = parseOutgoingNumber(raw?.outgoing_number) || 15;
    const paymentTerms = percent ? paymentTermsFor(percent) : '';
    const quote = {
      id: cleanId(raw?.id),
      quote_number: `Исх. № ${sequence}`,
      issue_date: issueDate,
      valid_days: validDays,
      valid_until: addDays(issueDate, validDays),
      client_name: String(raw?.client_name || '').trim().slice(0, 180),
      client_company: String(raw?.client_company || '').trim().slice(0, 180),
      address: '',
      object_type: String(raw?.object_type || 'Коммерческое помещение').trim().slice(0, 100),
      area: normalizeOptionalNumber(raw?.area),
      title: String(raw?.title || 'Коммерческое предложение на оказание клининговых услуг').trim().slice(0, 220),
      duration: String(raw?.duration || '1–2 дня').trim().slice(0, 220),
      payment_terms: paymentTerms,
      notes: '',
      vat_label: String(raw?.vat_label || COMPANY.vat_label).trim().slice(0, 80),
      equipment: String(raw?.equipment || '').trim().slice(0, 1400),
      ...calculation,
      prepayment_percent: percent,
      total_words: moneyToWordsRu(calculation.total),
      company: COMPANY,
    };
    return json({ ok: true, quote });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 400);
  }
}

function normalizePaymentPercent(value) {
  const n = Math.round(Number(String(value ?? 0).replace(',', '.')) || 0);
  return [20, 30, 50, 100].includes(n) ? n : 0;
}

function paymentTermsFor(percent) {
  if (percent === 100) return 'Оплата производится по счету в 100% размере.';
  return `Предоплата ${percent}%. Остаток — после выполнения работ.`;
}

function canUseKp(env, id) {
  return parseIds([
    env.MAIN_ADMIN_TELEGRAM_ID,
    env.ADMIN_TELEGRAM_IDS,
    env.ADMIN_TELEGRAM_ID,
    env.ADMIN_ID,
    env.KP_ADMIN_TELEGRAM_IDS,
    env.KP_ADMIN_TELEGRAM_ID,
  ]).includes(String(id));
}

function parseIds(values) {
  return [...new Set(values.filter(Boolean).join(',').split(/[;,\s]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v)))];
}

async function validateRequestUser(request, env) {
  return validateInitData(request.headers.get('X-Telegram-Init-Data') || '', env.TELEGRAM_BOT_TOKEN);
}

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const receivedHash = String(params.get('hash') || '').toLowerCase();
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
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  const id = env.APP_STORE.idFromName('house-cleaning-app-v1');
  return env.APP_STORE.get(id);
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function spbToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function cleanDate(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function normalizeOptionalNumber(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseOutgoingNumber(value) {
  const match = String(value ?? '').match(/\d+/);
  if (!match) return 0;
  const n = Math.floor(Number(match[0]));
  return Number.isFinite(n) && n > 0 && n <= 999999 ? n : 0;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : '';
}

function noStore(response, contentType = '') {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  if (contentType) headers.set('content-type', contentType);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}
