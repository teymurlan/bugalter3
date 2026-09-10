import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v12.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const OUTGOING_START = 14;
const KP_VERSION = '12';

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/kp/peek-number' && request.method === 'GET') {
      const current = await this.getOutgoingCounter();
      return json({ ok: true, number: formatOutgoingNumber(current + 1) });
    }

    return super.fetch(request);
  }

  async saveQuote(raw) {
    const existingId = cleanId(raw?.id);
    const existing = existingId ? await this.state.storage.get(`kp:item:${existingId}`) : null;
    const quote = await super.saveQuote(raw);

    // Существующие КП сохраняют свой прежний номер.
    // Для новой нумерации используем отдельный счётчик v2,
    // чтобы ближайшее новое КП после этого обновления было строго № 14.
    if (existing) return quote;

    const sequence = await this.state.storage.transaction(async (txn) => {
      const stored = Number(await txn.get(OUTGOING_COUNTER_KEY) || (OUTGOING_START - 1));
      const base = Math.max(OUTGOING_START - 1, stored);
      const next = base + 1;
      await txn.put(OUTGOING_COUNTER_KEY, next);
      return next;
    });

    const updated = {
      ...quote,
      quote_number: formatOutgoingNumber(sequence),
    };

    await this.state.storage.put(`kp:item:${updated.id}`, updated);
    return updated;
  }

  async getOutgoingCounter() {
    const stored = Number(await this.state.storage.get(OUTGOING_COUNTER_KEY) || (OUTGOING_START - 1));
    return Math.max(OUTGOING_START - 1, stored);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Новый URL версии заставляет Telegram загрузить свежую версию без старого кэша.
    if (request.method === 'GET' && url.pathname === '/kp') {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = '/kp/';
      redirectUrl.searchParams.set('v', KP_VERSION);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

function formatOutgoingNumber(sequence) {
  const safe = Math.max(OUTGOING_START, Math.floor(Number(sequence) || OUTGOING_START));
  return `Исх. № ${safe}`;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : '';
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  });
}
