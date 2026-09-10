import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v16.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const RESET_MARKER = 'kp:outgoing-reset-to-15:stable-v1';
const KP_VERSION = '19-stable';

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/kp/peek-number' && request.method === 'GET') {
      const alreadyReset = await this.state.storage.get(RESET_MARKER);
      if (!alreadyReset) return json({ ok: true, number: 'Исх. № 15' });
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
      const response = Response.redirect(redirectUrl.toString(), 302);
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
      return new Response(null, { status: 302, headers });
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  });
}
