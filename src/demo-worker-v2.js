import baseWorker from './demo-worker.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/demo-order') {
      const headers = new Headers(request.headers);
      const initData = headers.get('X-Telegram-Init-Data') || '';
      if (initData) {
        const params = new URLSearchParams(initData);
        params.delete('signature');
        headers.set('X-Telegram-Init-Data', params.toString());
        request = new Request(request, { headers });
      }
    }
    return baseWorker.fetch(request, env, ctx);
  },
};
