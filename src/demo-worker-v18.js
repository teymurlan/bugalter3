import baseWorker, { ConsentStore, AppStore } from './demo-worker-v17.js';

export { ConsentStore, AppStore };

const KP_VERSION = '18';

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