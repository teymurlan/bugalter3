import baseWorker, { ConsentStore as BaseConsentStore, AppStore as BaseAppStore } from './demo-worker-v53-client-experience.js';
import { notificationEventFromRequest, sendCentralNotification } from './central-notifications.js';

const PUBLIC_SEQUENCE_KEY = 'system:public-order-sequence:v1';

export class ConsentStore extends BaseConsentStore {}

export class AppStore extends BaseAppStore {
  constructor(state, env) {
    super(state, env);
    this.hcState = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/orders' && request.method === 'GET') {
      const data = await this.ensurePublicOrderNumbers();
      if (data) return json(data);
      return super.fetch(request);
    }

    if (url.pathname === '/order' && request.method === 'GET') {
      await this.ensurePublicOrderNumbers();
      return super.fetch(request);
    }

    if (url.pathname === '/order' && request.method === 'PUT') {
      let order = null;
      try { order = await request.clone().json(); } catch {}
      if (!order || typeof order !== 'object') return super.fetch(request);

      const snapshot = await this.ensurePublicOrderNumbers();
      const existing = (Array.isArray(snapshot?.orders) ? snapshot.orders : [])
        .find((item) => String(item?.order_number || '') === String(order?.order_number || ''));
      const existingNumber = publicNumber(existing);
      let number = publicNumber(order) || existingNumber;

      if (!number && !order.is_test) number = await this.nextPublicOrderNumber();
      if (number) order = { ...order, public_order_number: number, display_number: number };

      const forwarded = new Request(request.url, {
        method: 'PUT',
        headers: request.headers,
        body: JSON.stringify(order),
      });
      return super.fetch(forwarded);
    }

    return super.fetch(request);
  }

  async ensurePublicOrderNumbers() {
    const response = await super.fetch(new Request('https://app.internal/orders', { method: 'GET' }));
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data || !Array.isArray(data.orders)) return data;

    const orders = data.orders.map((order) => ({ ...order }));
    const realOrders = orders.filter((order) => !order?.is_test);
    const maxExisting = realOrders.reduce((max, order) => Math.max(max, publicNumber(order)), 0);
    if (maxExisting) await this.ensureSequenceAtLeast(maxExisting);

    const missing = realOrders
      .filter((order) => !publicNumber(order))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))
        || String(a.order_number || '').localeCompare(String(b.order_number || '')));

    for (const order of missing) {
      const number = await this.nextPublicOrderNumber();
      order.public_order_number = number;
      order.display_number = number;
      await this.persistOrder(order);
    }

    for (const order of realOrders) {
      const number = publicNumber(order);
      if (!number || Number(order.display_number || 0) === number) continue;
      order.display_number = number;
      await this.persistOrder(order);
    }

    const byTechnicalNumber = new Map(realOrders.map((order) => [String(order.order_number || ''), order]));
    data.orders = orders.map((order) => byTechnicalNumber.get(String(order.order_number || '')) || order);
    return data;
  }

  async persistOrder(order) {
    return super.fetch(new Request('https://app.internal/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    }));
  }

  async ensureSequenceAtLeast(minimum) {
    await this.hcState.storage.transaction(async (txn) => {
      const current = Math.max(0, Number(await txn.get(PUBLIC_SEQUENCE_KEY) || 0));
      if (minimum > current) await txn.put(PUBLIC_SEQUENCE_KEY, minimum);
    });
  }

  async nextPublicOrderNumber() {
    return this.hcState.storage.transaction(async (txn) => {
      const current = Math.max(0, Number(await txn.get(PUBLIC_SEQUENCE_KEY) || 0));
      const next = current + 1;
      await txn.put(PUBLIC_SEQUENCE_KEY, next);
      return next;
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const candidate = await notificationEventFromRequest(request);
    const response = await baseWorker.fetch(request, env, ctx);

    if (candidate && response.ok) {
      let result = null;
      try { result = await response.clone().json(); } catch {}

      const event = String(result?.event || candidate.event || '');
      const order = result?.order;
      const shouldNotify = result?.ok === true
        && !result?.duplicate
        && order
        && !order.is_test
        && (event === 'created' || event === 'cancelled');

      if (shouldNotify) {
        const task = sendCentralNotification(env, event, order)
          .catch((error) => console.error('Central notification failed', error?.message || error));
        if (ctx?.waitUntil) ctx.waitUntil(task);
        else void task;
      }
    }

    return response;
  },
  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

function publicNumber(order) {
  const value = Number(order?.public_order_number || order?.display_number || 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
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
