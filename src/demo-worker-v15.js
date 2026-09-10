import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v14.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const OUTGOING_START = 14;
const KP_VERSION = '14';

export class AppStore extends BaseAppStore {
  async saveQuote(raw) {
    const manualNumber = parseOutgoingNumber(raw?.outgoing_number);
    const existingId = cleanId(raw?.id);

    if (manualNumber) {
      await this.assertOutgoingNumberAvailable(manualNumber, existingId);
    }

    const quote = await super.saveQuote(raw);
    if (!manualNumber) return quote;

    const autoSequence = parseQuoteSequence(quote?.quote_number);
    const updated = {
      ...quote,
      quote_number: formatOutgoingNumber(manualNumber),
    };

    await this.state.storage.transaction(async (txn) => {
      const stored = Number(await txn.get(OUTGOING_COUNTER_KEY) || (OUTGOING_START - 1));
      let counter = stored;

      if (manualNumber > counter) {
        // Если администратор поставил номер вперёд, следующий автоматический
        // номер продолжит последовательность уже после него.
        counter = manualNumber;
      } else if (!existingId && autoSequence && stored === autoSequence && manualNumber < autoSequence) {
        // Ручной номер назад не должен «съедать» следующий автоматический номер.
        counter = Math.max(OUTGOING_START - 1, autoSequence - 1);
      }

      if (counter !== stored) await txn.put(OUTGOING_COUNTER_KEY, counter);
      await txn.put(`kp:item:${updated.id}`, updated);
    });

    return updated;
  }

  async assertOutgoingNumberAvailable(sequence, currentId) {
    const target = formatOutgoingNumber(sequence);
    const values = await this.state.storage.list({ prefix: 'kp:item:' });
    for (const quote of values.values()) {
      if (!quote || String(quote.id || '') === currentId) continue;
      if (String(quote.quote_number || '').trim() === target) {
        throw new Error(`${target} уже используется в другом КП`);
      }
    }
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

    return baseWorker.fetch(request, env, ctx);
  },
};

function parseOutgoingNumber(value) {
  const match = String(value ?? '').match(/\d+/);
  if (!match) return 0;
  const number = Math.floor(Number(match[0]));
  if (!Number.isFinite(number) || number < 1 || number > 999999) return 0;
  return number;
}

function parseQuoteSequence(value) {
  const match = String(value || '').match(/(?:Исх\.\s*№\s*)?(\d+)\s*$/i);
  return match ? Number(match[1]) : 0;
}

function formatOutgoingNumber(sequence) {
  return `Исх. № ${Math.max(1, Math.floor(Number(sequence) || OUTGOING_START))}`;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : '';
}
