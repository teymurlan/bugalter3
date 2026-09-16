import baseWorker, { ConsentStore, AppStore } from './client-defect-rpc.js';

export { ConsentStore, AppStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const DAILY_CAPACITY_M2 = 300;
const ACTIVE_STATUSES = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-availability' && request.method === 'GET') {
      const date = cleanDate(url.searchParams.get('date'));
      if (!date) return json({ ok: false, error: 'Некорректная дата' }, 400);
      const orders = await allOrders(env);
      return json(availabilityFor(date, orders));
    }

    if (url.pathname === '/api/demo-known-address' && request.method === 'POST') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      let body = {};
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректный адрес' }, 400); }
      const candidate = {
        city: String(body.city || ''),
        address: String(body.address || ''),
        apartment: String(body.apartment || ''),
      };
      if (!addressCore(candidate.address)) return json({ ok: true, known: false });
      const orders = await allOrders(env);
      const match = orders.find((order) => !order?.is_test
        && String(order?.status || '') !== 'CANCELLED'
        && Boolean(order?.order_number)
        && sameAddress(order, candidate));
      return json({ ok: true, known: Boolean(match) });
    }

    if (url.pathname === '/api/demo-order'
      && request.method === 'POST'
      && String(request.headers.get('content-type') || '').includes('application/json')) {
      let body = null;
      try { body = await request.clone().json(); } catch {}
      const event = String(body?.event || 'created');
      const order = body?.order;
      if (event === 'created' && order?.order_number && cleanDate(order?.date)) {
        const orders = await allOrders(env);
        const duplicate = orders.some((item) => String(item?.order_number || '') === String(order.order_number));
        if (!duplicate) {
          const availability = availabilityFor(String(order.date), orders);
          const area = Math.max(0, Number(order.area || 0));
          const time = normalizeTime(order.time);
          if (area > availability.remainingM2) {
            return json({ ok: false, error: `На эту дату осталось только ${availability.remainingM2} м²` }, 409);
          }
          if (time && availability.slots.some((slot) => slot.time === time && !slot.available)) {
            return json({ ok: false, error: `Время ${time} уже занято. Выберите другое время.` }, 409);
          }
        }
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function allOrders(env) {
  const stub = appStub(env);
  if (!stub) return [];
  try {
    const response = await stub.fetch('https://app.internal/orders');
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data?.orders) ? data.orders : [];
  } catch (error) {
    console.error('Shared order lookup failed', error);
    return [];
  }
}

function availabilityFor(date, all) {
  const orders = all.filter((order) => !order?.is_test
    && String(order?.date || '') === date
    && ACTIVE_STATUSES.has(String(order?.status || 'NEW')));
  const usedM2 = Math.max(0, Math.round(orders.reduce((sum, order) => sum + Math.max(0, Number(order?.area || 0)), 0)));
  const remainingM2 = Math.max(0, DAILY_CAPACITY_M2 - usedM2);
  const occupiedTimes = new Set(orders.map((order) => normalizeTime(order?.time)).filter(Boolean));
  const slots = Array.from({ length: 10 }, (_, index) => {
    const time = `${String(index + 9).padStart(2, '0')}:00`;
    return { time, available: remainingM2 > 0 && !occupiedTimes.has(time) };
  });
  return {
    ok: true,
    date,
    capacityM2: DAILY_CAPACITY_M2,
    usedM2,
    remainingM2,
    closed: remainingM2 <= 0,
    slots,
    source: 'server',
  };
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cityCore(value) {
  const city = normalize(value);
  if (!city) return '';
  if (city === 'спб' || city.includes('санкт петербург')) return 'spb';
  if (city.includes('ленинград') && city.includes('област')) return 'lo';
  return city;
}

function unitFrom(address, apartment) {
  const direct = normalize(apartment);
  if (direct) return direct.replace(/^0+(?=\d)/, '');
  const raw = String(address || '');
  const match = raw.match(/(?:квартира|кв\.?\s*\/?\s*офис|кв\.?|офис)\s*[:№#-]?\s*([0-9а-яa-z-]+)/i);
  return normalize(match?.[1] || '').replace(/^0+(?=\d)/, '');
}

function addressCore(value) {
  const withoutUnit = String(value || '').replace(/(?:квартира|кв\.?\s*\/?\s*офис|кв\.?|офис)\s*[:№#-]?\s*[0-9а-яa-z-]+/ig, ' ');
  const tokens = normalize(withoutUnit).split(' ').filter(Boolean);
  const stop = new Set([
    'россия','рф','город','г','санкт','петербург','спб','ленинградская','область',
    'улица','ул','проспект','просп','пр','переулок','пер','набережная','наб','шоссе',
    'дом','д'
  ]);
  return tokens.filter((token) => !stop.has(token)).join(' ');
}

function sameAddress(order, candidate) {
  const a = addressCore(order?.address);
  const b = addressCore(candidate?.address);
  if (!a || !b || a !== b) return false;
  if (unitFrom(order?.address, order?.apartment) !== unitFrom(candidate?.address, candidate?.apartment)) return false;
  const cityA = cityCore(order?.city);
  const cityB = cityCore(candidate?.city);
  return !cityA || !cityB || cityA === cityB;
}

function cleanDate(value) {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function normalizeTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, dataBytes);
}

function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'x-house-cleaning-booking-source': 'server-v50',
    },
  });
}
