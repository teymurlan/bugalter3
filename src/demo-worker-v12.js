import baseWorker, { ConsentStore, AppStore } from './demo-worker-v11.js';

export { ConsentStore, AppStore };

const EMPTY_CUSTOMER = '__HC_NO_CUSTOMER__';
const KP_VERSION = '10';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/kp') {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = '/kp/';
      redirectUrl.searchParams.set('v', KP_VERSION);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    if (url.pathname === '/api/kp/save' && request.method === 'POST') {
      let body;
      try {
        body = await request.clone().json();
      } catch {
        return baseWorker.fetch(request, env, ctx);
      }

      if (!String(body?.client_name || '').trim()) {
        body.client_name = EMPTY_CUSTOMER;
      }

      const headers = new Headers(request.headers);
      headers.set('content-type', 'application/json');
      const patchedRequest = new Request(request.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const response = await baseWorker.fetch(patchedRequest, env, ctx);
      return sanitizeQuoteResponse(response);
    }

    if (url.pathname === '/api/kp/list' || url.pathname === '/api/kp/get') {
      const response = await baseWorker.fetch(request, env, ctx);
      return sanitizeQuoteResponse(response);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function sanitizeQuoteResponse(response) {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) return response;

  let data;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }

  if (data?.quote) data.quote = sanitizeQuote(data.quote);
  if (Array.isArray(data?.quotes)) data.quotes = data.quotes.map(sanitizeQuote);

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=UTF-8');
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sanitizeQuote(quote) {
  if (!quote || typeof quote !== 'object') return quote;
  if (quote.client_name === EMPTY_CUSTOMER) {
    return { ...quote, client_name: '' };
  }
  return quote;
}
