import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v16.js';

export { ConsentStore };

const COUNTER_KEY = 'kp:outgoing-counter:v2';
const RESET_MARKER = 'kp:outgoing-reset-to-15:v17';
const KP_VERSION = '17';

export class AppStore extends BaseAppStore {
  async ensureV17Sequence() {
    const marker = await this.state.storage.get(RESET_MARKER);
    if (marker) return;
    await this.state.storage.put(COUNTER_KEY, 14);
    await this.state.storage.put(RESET_MARKER, new Date().toISOString());
  }

  async fetch(request) {
    // Важно: bootstrap вызывает /kp/peek-number. Не запускаем здесь
    // storage transaction/инициализацию — на iOS Telegram это могло оставлять
    // экран на «Проверяем доступ администратора…» при ожидании DO.
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