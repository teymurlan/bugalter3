import baseWorker, { ConsentStore, AppStore } from './demo-worker-v41-house-cleaning-staff.js';

export { ConsentStore, AppStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const MIN_BOOKING_LEAD_MS = 6 * 60 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-order-media-async' && request.method === 'POST') {
      const target = new URL(request.url);
      target.pathname = '/api/demo-order-media';
      const forwarded = new Request(target.toString(), request);
      const task = baseWorker.fetch(forwarded, env, ctx).then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          console.error('Background order media failed', data?.error || response.status);
        }
      }).catch((error) => console.error('Background order media failed', error));
      if (ctx?.waitUntil) {
        ctx.waitUntil(task);
        return json({ ok: true, queued: true }, 202);
      }
      await task;
      return json({ ok: true, queued: true });
    }

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      let body = null;
      try { body = await request.clone().json(); } catch {}
      if (String(body?.event || 'created') === 'created') {
        const error = validateBookingLead(body?.order);
        if (error) return json({ ok: false, error }, 409);
      }
    }

    if (url.pathname === '/api/demo-client-orders' && request.method === 'GET') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const data = await response.json().catch(() => ({}));
      const orders = Array.isArray(data?.orders) ? data.orders : [];
      const userId = initUserId(request);
      const reconciled = userId ? await reconcileCompletedFromMirror(env, userId, orders) : orders;
      return json({ ...data, orders: reconciled });
    }

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      let body = null;
      try { body = await request.clone().json(); } catch {}
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok || String(body?.status || '') !== 'COMPLETED') return response;

      const persisted = await ensureCompleted(env, body);
      if (!persisted || String(persisted.status || '') !== 'COMPLETED') {
        return json({ ok: false, error: 'Не удалось сохранить завершение заявки. Повторите действие.' }, 503);
      }

      const data = await response.clone().json().catch(() => ({}));
      return json({ ...data, ok: true, status: 'COMPLETED', order: persisted });
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

function validateBookingLead(order) {
  const date = String(order?.date || '').trim();
  const time = String(order?.time || '').trim().slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return 'Выберите корректные дату и время.';
  }
  const start = Date.parse(`${date}T${time}:00+03:00`);
  if (!Number.isFinite(start)) return 'Выберите корректные дату и время.';
  if (start < Date.now() + MIN_BOOKING_LEAD_MS) {
    return 'Уборку можно оформить минимум за 6 часов до начала. Выберите более позднее время.';
  }
  return '';
}

async function reconcileCompletedFromMirror(env, userId, orders) {
  const binding = findD1(env);
  if (!binding || !orders.length) return orders;
  try {
    const result = await binding.prepare('SELECT order_number, status, order_json FROM hc_orders WHERE client_telegram_id = ?').bind(userId).all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    const completed = new Map(rows.filter((row) => String(row?.status || '') === 'COMPLETED').map((row) => [String(row.order_number), row]));
    if (!completed.size) return orders;

    const out = [];
    for (const order of orders) {
      const row = completed.get(String(order?.order_number || ''));
      if (!row || String(order?.status || '') === 'COMPLETED') {
        out.push(order);
        continue;
      }
      let mirrored = {};
      try { mirrored = JSON.parse(String(row.order_json || '{}')); } catch {}
      const next = { ...order, ...mirrored, status: 'COMPLETED', updated_at: mirrored.updated_at || new Date().toISOString() };
      out.push(next);
      try {
        await appStub(env)?.fetch('https://app.internal/order', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        });
      } catch (error) {
        console.error('Completed order reconciliation save failed', error);
      }
    }
    return out;
  } catch (error) {
    console.error('Completed order reconciliation skipped', error);
    return orders;
  }
}

async function ensureCompleted(env, body) {
  const clientId = positiveInt(body?.clientTelegramId || body?.order?.client_telegram_id);
  const orderNumber = cleanOrderNumber(body?.order?.order_number);
  const stub = appStub(env);
  if (!stub || !clientId || !orderNumber) return null;

  try {
    const patch = await stub.fetch('https://app.internal/status', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_telegram_id: clientId, order_number: orderNumber, status: 'COMPLETED' }),
    });
    if (patch?.ok) {
      const data = await patch.json().catch(() => ({}));
      if (String(data?.order?.status || '') === 'COMPLETED') return data.order;
    }
  } catch (error) {
    console.error('Completion status patch failed', error);
  }

  try {
    const currentResponse = await stub.fetch(`https://app.internal/order?user=${encodeURIComponent(clientId)}&number=${encodeURIComponent(orderNumber)}`);
    if (!currentResponse?.ok) return null;
    const current = await currentResponse.json().catch(() => null);
    if (!current) return null;
    const next = {
      ...current,
      ...(body?.order && typeof body.order === 'object' ? body.order : {}),
      client_telegram_id: clientId,
      order_number: orderNumber,
      status: 'COMPLETED',
      completed_at: current.completed_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const save = await stub.fetch('https://app.internal/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!save?.ok) return null;
    const data = await save.json().catch(() => ({}));
    return data?.order || next;
  } catch (error) {
    console.error('Completion status fallback save failed', error);
    return null;
  }
}

function initUserId(request) {
  try {
    const raw = request.headers.get('X-Telegram-Init-Data') || '';
    const user = JSON.parse(new URLSearchParams(raw).get('user') || '{}');
    return positiveInt(user?.id);
  } catch { return 0; }
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

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function cleanOrderNumber(value) {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(raw) ? raw : '';
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
