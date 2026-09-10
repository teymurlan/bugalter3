import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v16.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const RESET_MARKER = 'kp:outgoing-reset-to-15:stable-v1';
const KP_VERSION = '17-stable';

export class AppStore extends BaseAppStore {
  async ensureOutgoingStartsAt15Once() {
    await this.state.storage.transaction(async (txn) => {
      if (await txn.get(RESET_MARKER)) return;
      await txn.put(OUTGOING_COUNTER_KEY, 14);
      await txn.put(RESET_MARKER, new Date().toISOString());
    });
  }

  async saveQuote(raw) {
    // Сброс выполняется только при фактическом сохранении КП и никак не участвует
    // в bootstrap/проверке администратора, чтобы не ломать рабочий вход v16.
    await this.ensureOutgoingStartsAt15Once();
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
      return Response.redirect(redirectUrl.toString(), 302);
    }
    return baseWorker.fetch(request, env, ctx);
  },
};
