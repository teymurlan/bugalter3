import baseWorker, { ConsentStore, AppStore } from './demo-worker-v10.js';

export { ConsentStore, AppStore };

const KP_VERSION = '6';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/kp') {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = '/kp/';
      redirectUrl.searchParams.set('v', KP_VERSION);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    if (request.method === 'GET' && url.pathname === '/kp/') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/kp/index.html';
      assetUrl.search = '';
      const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
        method: 'GET',
        headers: request.headers,
      }));
      return noStore(assetResponse, 'text/html; charset=UTF-8');
    }

    if (request.method === 'GET' && url.pathname.startsWith('/kp/')) {
      const assetResponse = await env.ASSETS.fetch(request);
      return noStore(assetResponse);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

function noStore(response, contentType = '') {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  if (contentType) headers.set('content-type', contentType);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
