import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v16.js';

export { ConsentStore };

const COUNTER_KEY = 'kp:outgoing-counter:v2';
const RESET_MARKER = 'kp:outgoing-reset-to-15:v17';
const KP_VERSION = '17';

export class AppStore extends BaseAppStore {
  async ensureV17Sequence() {
    await this.state.storage.transaction(async (txn) => {
      if (await txn.get(RESET_MARKER)) return;
      await txn.put(COUNTER_KEY, 14);
      await txn.put(RESET_MARKER, new Date().toISOString());
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/kp/')) await this.ensureV17Sequence();
    return super.fetch(request);
  }

  async saveQuote(raw) {
    await this.ensureV17Sequence();
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