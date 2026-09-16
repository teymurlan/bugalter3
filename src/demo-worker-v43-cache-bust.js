import baseWorker, { ConsentStore, AppStore } from './demo-worker-v42-launch-hardening.js';

export { ConsentStore, AppStore };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
      headers.set('pragma', 'no-cache');
      headers.set('expires', '0');
      headers.set('x-house-cleaning-release', '40');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return response;
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};
