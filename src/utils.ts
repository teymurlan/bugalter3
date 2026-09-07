export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

export function unauthorized(message = 'Unauthorized'): Response {
  return json({ ok: false, error: message }, 401);
}

export function notFound(): Response {
  return json({ ok: false, error: 'Not found' }, 404);
}

export function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, '').slice(0, 18);
}

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function validTime(value: string): boolean {
  return /^(09|10|11|12|13|14|15|16|17|18):00$/.test(value);
}
