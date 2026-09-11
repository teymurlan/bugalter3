import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v18-client.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const USED_PREFIX = 'kp:outgoing-used:v3:';
const OUTGOING_START = 15;
const KP_VERSION = 'flow-v2';

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    // Перед удалением навсегда запоминаем уже присвоенный исходящий номер.
    // Сам документ можно удалить из истории, но номер больше никогда не освобождается.
    if (url.pathname === '/kp/delete' && request.method === 'POST') {
      let body = {};
      try { body = await request.clone().json(); } catch {}
      const id = cleanId(body?.id);
      if (id) {
        const quote = await this.state.storage.get(`kp:item:${id}`);
        const sequence = parseOutgoingNumber(quote?.quote_number);
        if (sequence) await this.markNumberUsed(sequence, id);
      }
    }

    return super.fetch(request);
  }

  async saveQuote(raw) {
    const existingId = cleanId(raw?.id);
    const existing = existingId ? await this.state.storage.get(`kp:item:${existingId}`) : null;
    const previousSequence = parseOutgoingNumber(existing?.quote_number);
    let requestedSequence = parseOutgoingNumber(raw?.outgoing_number);

    if (!existing && requestedSequence && requestedSequence < OUTGOING_START) {
      throw new Error(`Номер нового КП не может быть меньше ${OUTGOING_START}`);
    }

    // Если интерфейс не передал номер, выделяем следующий номер сами.
    // Бронирование и счётчик находятся в Durable Object и выполняются транзакционно.
    let reservationToken = '';
    if (!requestedSequence) {
      const allocation = await this.allocateNextNumber();
      requestedSequence = allocation.sequence;
      reservationToken = allocation.token;
    } else {
      reservationToken = await this.reserveRequestedNumber(requestedSequence, existingId);
    }

    if (previousSequence && previousSequence !== requestedSequence) {
      // Старый номер остаётся использованным даже после ручной смены номера документа.
      await this.markNumberUsed(previousSequence, existingId || existing?.id || 'legacy');
    }

    try {
      const quote = await super.saveQuote({ ...raw, outgoing_number: requestedSequence });
      const assignedSequence = parseOutgoingNumber(quote?.quote_number) || requestedSequence;
      await this.finalizeReservation(assignedSequence, reservationToken, quote?.id || existingId || 'quote');
      await this.raiseCounterTo(assignedSequence);
      return quote;
    } catch (error) {
      await this.releaseReservation(requestedSequence, reservationToken);
      throw error;
    }
  }

  async allocateNextNumber() {
    const token = crypto.randomUUID();
    const sequence = await this.state.storage.transaction(async (txn) => {
      let current = Math.max(OUTGOING_START - 1, Number(await txn.get(OUTGOING_COUNTER_KEY) || (OUTGOING_START - 1)));
      for (let tries = 0; tries < 10000; tries += 1) {
        const candidate = current + 1;
        const usedKey = `${USED_PREFIX}${candidate}`;
        const used = await txn.get(usedKey);
        if (!used) {
          await txn.put(usedKey, {
            sequence: candidate,
            reserved_by: token,
            quote_id: null,
            reserved_at: new Date().toISOString(),
          });
          await txn.put(OUTGOING_COUNTER_KEY, candidate);
          return candidate;
        }
        current = candidate;
        await txn.put(OUTGOING_COUNTER_KEY, current);
      }
      throw new Error('Не удалось выделить новый исходящий номер');
    });
    return { sequence, token };
  }

  async reserveRequestedNumber(sequence, currentId) {
    const token = crypto.randomUUID();
    await this.state.storage.transaction(async (txn) => {
      const key = `${USED_PREFIX}${sequence}`;
      const used = await txn.get(key);

      if (used) {
        if (currentId && String(used.quote_id || '') === currentId) return;
        throw new Error(`Исх. № ${sequence} уже использовался ранее`);
      }

      // Совместимость со старыми КП, созданными до появления реестра использованных номеров.
      const quotes = await txn.list({ prefix: 'kp:item:' });
      for (const quote of quotes.values()) {
        if (!quote || String(quote.id || '') === currentId) continue;
        if (parseOutgoingNumber(quote.quote_number) === sequence) {
          throw new Error(`Исх. № ${sequence} уже используется в другом КП`);
        }
      }

      await txn.put(key, {
        sequence,
        reserved_by: token,
        quote_id: currentId || null,
        reserved_at: new Date().toISOString(),
      });
    });
    return token;
  }

  async finalizeReservation(sequence, token, quoteId) {
    await this.state.storage.transaction(async (txn) => {
      const key = `${USED_PREFIX}${sequence}`;
      const used = await txn.get(key);
      if (used && used.quote_id && String(used.quote_id) !== String(quoteId)) {
        throw new Error(`Исх. № ${sequence} уже использовался ранее`);
      }
      if (used && used.reserved_by && token && used.reserved_by !== token) {
        throw new Error(`Исх. № ${sequence} уже забронирован`);
      }
      await txn.put(key, {
        sequence,
        quote_id: String(quoteId || ''),
        used_at: used?.used_at || new Date().toISOString(),
      });
    });
  }

  async markNumberUsed(sequence, quoteId) {
    if (!sequence) return;
    await this.state.storage.transaction(async (txn) => {
      const key = `${USED_PREFIX}${sequence}`;
      const used = await txn.get(key);
      if (used?.quote_id && String(used.quote_id) !== String(quoteId)) return;
      await txn.put(key, {
        sequence,
        quote_id: String(quoteId || used?.quote_id || 'legacy'),
        used_at: used?.used_at || new Date().toISOString(),
      });
    });
  }

  async releaseReservation(sequence, token) {
    if (!sequence || !token) return;
    await this.state.storage.transaction(async (txn) => {
      const key = `${USED_PREFIX}${sequence}`;
      const used = await txn.get(key);
      if (used?.reserved_by === token && !used?.used_at) await txn.delete(key);
    });
  }

  async raiseCounterTo(sequence) {
    if (!sequence) return;
    await this.state.storage.transaction(async (txn) => {
      const current = Math.max(OUTGOING_START - 1, Number(await txn.get(OUTGOING_COUNTER_KEY) || (OUTGOING_START - 1)));
      if (sequence > current) await txn.put(OUTGOING_COUNTER_KEY, sequence);
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/kp') {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = '/kp/';
      redirectUrl.searchParams.set('v', KP_VERSION);
      return new Response(null, {
        status: 302,
        headers: {
          location: redirectUrl.toString(),
          'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      });
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

function parseOutgoingNumber(value) {
  const match = String(value ?? '').match(/\d+/);
  if (!match) return 0;
  const number = Math.floor(Number(match[0]));
  return Number.isFinite(number) && number > 0 && number <= 999999 ? number : 0;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : '';
}
