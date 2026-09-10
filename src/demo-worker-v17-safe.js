import baseWorker, { ConsentStore, AppStore as V16AppStore } from './demo-worker-v16.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const RESET_MARKER = 'kp:outgoing-reset-to-15:first5-v1';
const EMPTY_ADDRESS = '__HC_NO_ADDRESS__';
const PAYMENT_CHOICES = new Set([20, 30, 50, 100]);
const KP_VERSION = 'first5-v1';
const V15_APP_STORE_PROTO = Object.getPrototypeOf(V16AppStore.prototype);

export class AppStore extends V16AppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/kp/peek-number' && request.method === 'GET') {
      const resetDone = await this.state.storage.get(RESET_MARKER);
      if (!resetDone) return json({ ok: true, number: 'Исх. № 15' });
    }

    return super.fetch(request);
  }

  async ensureOutgoingStartsAt15Once() {
    await this.state.storage.transaction(async (txn) => {
      if (await txn.get(RESET_MARKER)) return;
      await txn.put(OUTGOING_COUNTER_KEY, 14);
      await txn.put(RESET_MARKER, new Date().toISOString());
    });
  }

  async saveQuote(raw) {
    await this.ensureOutgoingStartsAt15Once();

    const existingId = cleanId(raw?.id);
    const existing = existingId ? await this.state.storage.get(`kp:item:${existingId}`) : null;
    const paymentPercent = normalizePaymentPercent(raw?.prepayment_percent);

    const normalized = {
      ...raw,
      address: String(raw?.address || '').trim() || EMPTY_ADDRESS,
      notes: '',
      prepayment_percent: paymentPercent,
      payment_terms: paymentTermsFor(paymentPercent),
    };

    // Пропускаем только обязательную проверку предоплаты из v16,
    // остальная стабильная цепочка сохранения v15 -> v10 остаётся прежней.
    const quote = await V15_APP_STORE_PROTO.saveQuote.call(this, normalized);
    const updated = {
      ...quote,
      address: quote.address === EMPTY_ADDRESS ? '' : String(quote.address || ''),
      notes: '',
      prepayment_percent: paymentPercent,
      payment_terms: paymentTermsFor(paymentPercent),
    };

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
      const headers = new Headers({
        location: redirectUrl.toString(),
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      });
      return new Response(null, { status: 302, headers });
    }

    // v16 требовал одну из фиксированных предоплат. Для режима «без предоплаты»
    // используем стабильный preview v16 и после расчёта обнуляем только платёжные поля.
    if (url.pathname === '/api/kp/preview' && request.method === 'POST') {
      let raw;
      try { raw = await request.clone().json(); }
      catch { return baseWorker.fetch(request, env, ctx); }

      const paymentPercent = normalizePaymentPercent(raw?.prepayment_percent);
      if (paymentPercent === 0) {
        const headers = new Headers(request.headers);
        headers.set('content-type', 'application/json');
        const patchedRequest = new Request(request.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...raw, prepayment_percent: 20, payment_terms: '' }),
        });
        const response = await baseWorker.fetch(patchedRequest, env, ctx);
        if (!response.ok) return response;

        let data;
        try { data = await response.json(); }
        catch { return response; }
        if (data?.quote) {
          data.quote = {
            ...data.quote,
            prepayment_percent: 0,
            prepayment: 0,
            balance: Number(data.quote.total || 0),
            payment_terms: '',
            address: '',
          };
        }
        return json(data, response.status);
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

function normalizePaymentPercent(value) {
  const number = Math.round(Number(String(value ?? '').replace(',', '.')));
  return PAYMENT_CHOICES.has(number) ? number : 0;
}

function paymentTermsFor(percent) {
  if (!percent) return '';
  if (percent === 100) return 'Оплата производится по счету в 100% размере.';
  return `Предоплата ${percent}%. Остаток — после выполнения работ.`;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : '';
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
