import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v18-client.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const RESET_MARKER = 'kp:outgoing-reset-to-15:first5-v1';
const USED_PREFIX = 'kp:outgoing-used:v3:';
const OUTGOING_START = 15;
const KP_VERSION = 'flow-v2';

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);

    // Удаление документа не освобождает уже присвоенный исходящий номер.
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

  // Переопределяем одноразовый старт №15 безопасно: если счётчик уже выше,
  // никогда не откатываем его назад.
  async ensureOutgoingStartsAt15Once() {
    await this.state.storage.transaction(async (txn) => {
      if (await txn.get(RESET_MARKER)) return;
      const current = Math.max(0, Number(await txn.get(OUTGOING_COUNTER_KEY) || 0));
      await txn.put(OUTGOING_COUNTER_KEY, Math.max(OUTGOING_START - 1, current));
      await txn.put(RESET_MARKER, new Date().toISOString());
    });
  }

  async saveQuote(raw) {
    const existingId = cleanId(raw?.id);
    const existing = existingId ? await this.state.storage.get(`kp:item:${existingId}`) : null;
    const previousSequence = parseOutgoingNumber(existing?.quote_number);
    const requestedSequence = parseOutgoingNumber(raw?.outgoing_number);

    if (requestedSequence) {
      await this.assertNumberNeverUsed(requestedSequence, existingId, previousSequence);
    }

    const quote = await super.saveQuote(raw);
    const assignedSequence = parseOutgoingNumber(quote?.quote_number);

    if (previousSequence && previousSequence !== assignedSequence) {
      await this.markNumberUsed(previousSequence, existingId || existing?.id || 'legacy');
    }
    if (assignedSequence) {
      await this.markNumberUsed(assignedSequence, quote?.id || existingId || 'quote');
      await this.raiseCounterTo(assignedSequence);
    }

    return quote;
  }

  async assertNumberNeverUsed(sequence, currentId, currentSequence) {
    if (!sequence) return;
    if (!currentId && sequence < OUTGOING_START) {
      throw new Error(`Номер нового КП не может быть меньше ${OUTGOING_START}`);
    }

    // Свой текущий номер при редактировании разрешён.
    if (currentId && sequence === currentSequence) return;

    const used = await this.state.storage.get(`${USED_PREFIX}${sequence}`);
    if (used) throw new Error(`Исх. № ${sequence} уже использовался ранее`);

    // Счётчик — high-water mark. Всё, что ниже или равно ему, уже считается
    // использованным, даже если старый документ удалён до появления реестра v3.
    const highWater = Math.max(
      OUTGOING_START - 1,
      Number(await this.state.storage.get(OUTGOING_COUNTER_KEY) || (OUTGOING_START - 1)),
    );
    if (sequence <= highWater) {
      throw new Error(`Исх. № ${sequence} уже использовался ранее`);
    }
  }

  async markNumberUsed(sequence, quoteId) {
    if (!sequence) return;
    const key = `${USED_PREFIX}${sequence}`;
    await this.state.storage.transaction(async (txn) => {
      const existing = await txn.get(key);
      if (existing?.quote_id && String(existing.quote_id) !== String(quoteId)) {
        throw new Error(`Исх. № ${sequence} уже использовался ранее`);
      }
      await txn.put(key, {
        sequence,
        quote_id: String(quoteId || existing?.quote_id || 'legacy'),
        used_at: existing?.used_at || new Date().toISOString(),
      });
    });
  }

  async raiseCounterTo(sequence) {
    if (!sequence) return;
    await this.state.storage.transaction(async (txn) => {
      const current = Math.max(
        OUTGOING_START - 1,
        Number(await txn.get(OUTGOING_COUNTER_KEY) || (OUTGOING_START - 1)),
      );
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
