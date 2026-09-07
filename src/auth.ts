import type { AuthContext, Env, TelegramUser } from './types';

const encoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmac(key: ArrayBuffer | Uint8Array | string, data: string): Promise<ArrayBuffer> {
  const rawKey = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

export async function validateTelegramInitData(initData: string, botToken: string): Promise<TelegramUser> {
  if (!initData) throw new Error('Telegram initData missing');

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash') || '';
  const authDate = Number(params.get('auth_date') || '0');
  const userRaw = params.get('user');

  if (!receivedHash || !authDate || !userRaw) throw new Error('Invalid Telegram initData');

  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -60 || age > 86400) throw new Error('Telegram session expired');

  params.delete('hash');
  params.delete('signature');
  const pairs: Array<[string, string]> = [];
  params.forEach((value, key) => pairs.push([key, value]));
  const dataCheckString = pairs
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmac('WebAppData', botToken);
  const calculatedHash = bytesToHex(await hmac(secretKey, dataCheckString));

  if (!constantTimeEqual(calculatedHash, receivedHash)) throw new Error('Telegram signature mismatch');

  const user = JSON.parse(userRaw) as TelegramUser;
  if (!user?.id) throw new Error('Telegram user missing');
  return user;
}

export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const telegramUser = await validateTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);

  await env.DB.prepare(`
    INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      photo_url = excluded.photo_url,
      updated_at = datetime('now')
  `).bind(
    telegramUser.id,
    telegramUser.username || null,
    telegramUser.first_name || '',
    telegramUser.last_name || null,
    telegramUser.photo_url || null,
  ).run();

  const row = await env.DB.prepare('SELECT id FROM users WHERE telegram_id = ?')
    .bind(telegramUser.id)
    .first<{ id: number }>();

  if (!row) throw new Error('Unable to initialize user');
  return { telegramUser, dbUserId: row.id };
}
