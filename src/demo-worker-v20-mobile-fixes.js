import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v19-kp-flow.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const USED_PREFIX = 'kp:outgoing-used:v3:';
const HARD_RESET_MARKER = 'kp:outgoing-hard-reset-to-15:mobile-v4';
const OUTGOING_START = 15;
const KP_VERSION = 'mobile-fixes-v4';

export class AppStore extends BaseAppStore {
  async hardResetOutgoingTo15Once() {
    if (await this.state.storage.get(HARD_RESET_MARKER)) return false;

    const used = await this.state.storage.list({ prefix: USED_PREFIX });
    await this.state.storage.transaction(async (txn) => {
      if (await txn.get(HARD_RESET_MARKER)) return;

      // Явный новый старт рабочей нумерации: следующее новое КП = 15.
      await txn.put(OUTGOING_COUNTER_KEY, OUTGOING_START - 1);

      // Предыдущие номера 15+ были выданы во время настройки конструктора.
      // Для нового рабочего старта очищаем только технический реестр занятых
      // номеров. Сами сохранённые КП/история не удаляются.
      for (const key of used.keys()) await txn.delete(key);

      await txn.put(HARD_RESET_MARKER, new Date().toISOString());
    });
    return true;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/kp/peek-number' && request.method === 'GET') {
      await this.hardResetOutgoingTo15Once();
    }
    return super.fetch(request);
  }

  async saveQuote(raw) {
    const existingId = cleanId(raw?.id);

    // Поле «Исх. №» всегда видно в форме, поэтому автоматический следующий
    // номер приходит как обычное outgoing_number. Если он ровно следующий по
    // счётчику, считаем его автоматическим и даём базовой логике назначить его
    // самой. Это позволяет чисто перезапустить рабочую последовательность с №15
    // и дальше сохранить обычное 15 → 16 → 17… поведение.
    if (!existingId) {
      const counter = Math.max(
        OUTGOING_START - 1,
        Number(await this.state.storage.get(OUTGOING_COUNTER_KEY) || (OUTGOING_START - 1)),
      );
      const requested = parseOutgoingNumber(raw?.outgoing_number);
      if (requested && requested === counter + 1) {
        return super.saveQuote({ ...raw, outgoing_number: null });
      }
    }

    return super.saveQuote(raw);
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
