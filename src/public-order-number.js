import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v53-client-experience.js';

export { ConsentStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const COUNTER_KEY = 'public:order-number:counter';

export class AppStore extends BaseAppStore {
  constructor(state, env) {
    super(state, env);
    this.hcState = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/public-number/ensure' && request.method === 'POST') {
      return json(await this.ensurePublicNumbers());
    }

    if (url.pathname === '/public-number/allocate' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const orderNumber = cleanOrderNumber(body.order_number);
      if (!orderNumber) return json({ ok: false, error: 'Некорректный номер заказа' }, 400);
      const data = await this.ensurePublicNumbers();
      const existing = data.orders.find((order) => String(order?.order_number || '') === orderNumber);
      if (positiveInt(existing?.display_number)) {
        return json({ ok: true, display_number: positiveInt(existing.display_number), existing: true });
      }
      const current = Math.max(
        positiveInt(await this.hcState.storage.get(COUNTER_KEY)),
        ...data.orders.map((order) => positiveInt(order?.display_number)),
        0,
      );
      const next = current + 1;
      await this.hcState.storage.put(COUNTER_KEY, next);
      return json({ ok: true, display_number: next, existing: false });
    }

    return super.fetch(request);
  }

  async ensurePublicNumbers() {
    const response = await super.fetch(new Request('https://app.internal/orders'));
    if (!response?.ok) return { ok: false, orders: [] };
    const data = await response.json().catch(() => ({}));
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    const realOrders = orders
      .filter((order) => !order?.is_test && order?.order_number)
      .sort((a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')) || String(a?.order_number || '').localeCompare(String(b?.order_number || '')));

    const used = new Set();
    let counter = positiveInt(await this.hcState.storage.get(COUNTER_KEY));
    let changed = 0;

    for (const order of realOrders) {
      let number = positiveInt(order?.display_number || order?.short_number);
      if (!number || used.has(number)) {
        do { counter += 1; } while (used.has(counter));
        number = counter;
        const next = { ...order, display_number: number, short_number: number, updated_at: order.updated_at || new Date().toISOString() };
        const saved = await super.fetch(new Request('https://app.internal/order', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        }));
        if (saved?.ok) Object.assign(order, next);
        changed += 1;
      }
      used.add(number);
      counter = Math.max(counter, number);
    }

    await this.hcState.storage.put(COUNTER_KEY, counter);
    return { ok: true, changed, counter, orders };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && shouldEnsureNumbers(url.pathname)) {
      await ensurePublicNumbers(env);
    }

    if (url.pathname === '/api/demo-order'
      && request.method === 'POST'
      && String(request.headers.get('content-type') || '').includes('application/json')) {
      let body = null;
      try { body = await request.clone().json(); } catch {}
      if (String(body?.event || 'created') === 'created' && body?.order?.order_number) {
        const displayNumber = positiveInt(body.order.display_number)
          || await allocatePublicNumber(env, body.order.order_number);
        if (displayNumber) {
          body.order = { ...body.order, display_number: displayNumber, short_number: displayNumber };
          const headers = new Headers(request.headers);
          headers.set('content-type', 'application/json');
          headers.delete('content-length');
          request = new Request(request.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
        }
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

function shouldEnsureNumbers(pathname) {
  return pathname.startsWith('/api/demo-client-order')
    || pathname === '/api/demo-admin-orders'
    || pathname.startsWith('/api/staff-v1/');
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function ensurePublicNumbers(env) {
  try {
    const stub = appStub(env);
    if (!stub) return null;
    const response = await stub.fetch('https://app.internal/public-number/ensure', { method: 'POST' });
    return response.ok ? await response.json().catch(() => null) : null;
  } catch (error) {
    console.error('Public order number backfill failed', error);
    return null;
  }
}

async function allocatePublicNumber(env, orderNumber) {
  try {
    const stub = appStub(env);
    if (!stub) return 0;
    const response = await stub.fetch('https://app.internal/public-number/allocate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_number: orderNumber }),
    });
    if (!response.ok) return 0;
    return positiveInt((await response.json().catch(() => ({})))?.display_number);
  } catch (error) {
    console.error('Public order number allocation failed', error);
    return 0;
  }
}

function cleanOrderNumber(value) {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,120}$/.test(raw) ? raw : '';
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  });
}
