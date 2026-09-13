import baseWorker, { ConsentStore, AppStore } from './demo-worker-v31-order-create-safe.js';

export { ConsentStore, AppStore };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-order' && request.method === 'POST') {
      const contentType = String(request.headers.get('content-type') || '');
      const isMultipart = /multipart\/form-data/i.test(contentType);
      const hasBoundary = /boundary\s*=\s*(?:"[^"]+"|[^;\s]+)/i.test(contentType);

      if (isMultipart && !hasBoundary) {
        try {
          const body = await request.arrayBuffer();
          const boundary = extractBoundary(new Uint8Array(body));
          if (!boundary) {
            return json({
              ok: false,
              error: 'Не удалось обработать фотографии заявки. Закройте Mini App, откройте заново и повторите отправку.',
            }, 400);
          }

          const headers = new Headers(request.headers);
          headers.set('content-type', `multipart/form-data; boundary=${boundary}`);
          headers.delete('content-length');

          const repaired = new Request(request.url, {
            method: request.method,
            headers,
            body,
          });

          return baseWorker.fetch(repaired, env, ctx);
        } catch (error) {
          console.error('Multipart boundary repair failed', error);
          return json({
            ok: false,
            error: 'Не удалось обработать фотографии заявки. Повторите отправку ещё раз.',
          }, 400);
        }
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(controller, env, ctx);
    }
  },
};

function extractBoundary(bytes) {
  if (!bytes?.length) return '';
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  const text = new TextDecoder().decode(sample);
  const lineEnd = text.search(/\r?\n/);
  const firstLine = (lineEnd >= 0 ? text.slice(0, lineEnd) : text).trim();
  if (!firstLine.startsWith('--')) return '';
  const boundary = firstLine.slice(2).trim();
  if (!boundary || boundary.length > 200) return '';
  if (!/^[0-9A-Za-z'()+_,\-.\/:=?]+$/.test(boundary)) return '';
  return boundary;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  });
}
