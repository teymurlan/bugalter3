import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v19-kp-flow.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const USED_PREFIX = 'kp:outgoing-used:v3:';
const HARD_RESET_MARKER = 'kp:outgoing-hard-reset-to-15:mobile-v4';
const KP_VERSION = 'mobile-fixes-v4';

export class AppStore extends BaseAppStore {
  async hardResetOutgoingTo15Once() {
    if (await this.state.storage.get(HARD_RESET_MARKER)) return false;

    const used = await this.state.storage.list({ prefix: USED_PREFIX });
    await this.state.storage.transaction(async (txn) => {
      if (await txn.get(HARD_RESET_MARKER)) return;

      // Явный новый старт рабочей нумерации: следующее новое КП = 15.
      await txn.put(OUTGOING_COUNTER_KEY, 14);

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
