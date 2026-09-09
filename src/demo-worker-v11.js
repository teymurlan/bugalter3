import baseWorker, { ConsentStore, AppStore } from './demo-worker-v10.js';

export { ConsentStore, AppStore };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/kp' || url.pathname === '/kp/')) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/kp/index.html';
      assetUrl.search = '';
      return env.ASSETS.fetch(new Request(assetUrl.toString(), {
        method: 'GET',
        headers: request.headers,
      }));
    }

    if (request.method === 'GET' && url.pathname.startsWith('/kp/')) {
      return env.ASSETS.fetch(request);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};
