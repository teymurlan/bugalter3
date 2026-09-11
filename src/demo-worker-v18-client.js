import baseWorker, { ConsentStore, AppStore as V17AppStore } from './demo-worker-v17-safe.js';

export { ConsentStore };

const REF_PERCENT = 15;
const APP_STORE_NAME = 'house-cleaning-app-v1';

export class AppStore extends V17AppStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/ref/register' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const inviterId = positiveInt(body.inviter_id);
      const friendId = positiveInt(body.friend_id);
      const code = cleanReferralCode(body.code);
      if (!inviterId || !friendId || inviterId === friendId || !code) {
        return json({ ok: false, error: 'Invalid referral' }, 400);
      }

      const friendKey = `ref:friend:${friendId}`;
      const existing = await this.state.storage.get(friendKey);
      if (existing) return json({ ok: true, referral: existing, already_registered: true });

      const referral = {
        inviter_id: inviterId,
        friend_id: friendId,
        code,
        percent: REF_PERCENT,
        status: 'registered',
        registered_at: new Date().toISOString(),
        completed_at: null,
      };

      await this.state.storage.transaction(async (txn) => {
        await txn.put(friendKey, referral);
        await txn.put(`ref:invite:${inviterId}:${friendId}`, referral);
      });
      return json({ ok: true, referral, already_registered: false });
    }

    if (url.pathname === '/ref/complete' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const friendId = positiveInt(body.friend_id);
      if (!friendId) return json({ ok: false, error: 'Invalid friend' }, 400);

      let usedOwnReward = false;
      const ownRewardKey = `ref:reward-count:${friendId}`;
      const ownUsedKey = `ref:reward-used:${friendId}`;
      const ownRewards = Math.max(0, Number(await this.state.storage.get(ownRewardKey) || 0));
      const ownUsed = Math.max(0, Number(await this.state.storage.get(ownUsedKey) || 0));
      if (ownRewards > ownUsed) {
        await this.state.storage.put(ownUsedKey, ownUsed + 1);
        usedOwnReward = true;
      }

      const friendKey = `ref:friend:${friendId}`;
      const referral = await this.state.storage.get(friendKey);
      if (!referral) return json({ ok: true, rewarded: false, used_own_reward: usedOwnReward, reason: 'not_referred' });
      if (referral.status === 'completed') return json({ ok: true, rewarded: false, used_own_reward: usedOwnReward, reason: 'already_completed', referral });

      const next = { ...referral, status: 'completed', completed_at: new Date().toISOString() };
      const rewardKey = `ref:reward-count:${referral.inviter_id}`;
      await this.state.storage.transaction(async (txn) => {
        const current = Math.max(0, Number(await txn.get(rewardKey) || 0));
        await txn.put(friendKey, next);
        await txn.put(`ref:invite:${referral.inviter_id}:${friendId}`, next);
        await txn.put(rewardKey, current + 1);
      });
      return json({ ok: true, rewarded: true, used_own_reward: usedOwnReward, referral: next });
    }

    if (url.pathname === '/ref/stats' && request.method === 'GET') {
      const userId = positiveInt(url.searchParams.get('user'));
      if (!userId) return json({ ok: false, error: 'Invalid user' }, 400);
      const invites = await this.state.storage.list({ prefix: `ref:invite:${userId}:` });
      const values = [...invites.values()].filter(Boolean);
      const friendReferral = await this.state.storage.get(`ref:friend:${userId}`);
      const rewardCount = Math.max(0, Number(await this.state.storage.get(`ref:reward-count:${userId}`) || 0));
      const rewardUsed = Math.max(0, Number(await this.state.storage.get(`ref:reward-used:${userId}`) || 0));
      const ownOrders = await this.state.storage.list({ prefix: `order:${userId}:` });
      const hasCompletedOwnOrder = [...ownOrders.values()].some((order) => order?.status === 'COMPLETED');
      const friendDiscount = friendReferral && !hasCompletedOwnOrder ? REF_PERCENT : 0;
      const availableRewards = Math.max(0, rewardCount - rewardUsed);
      return json({
        ok: true,
        invited_count: values.length,
        completed_friends: values.filter((item) => item.status === 'completed').length,
        reward_count: rewardCount,
        reward_used: rewardUsed,
        available_rewards: availableRewards,
        reward_percent: REF_PERCENT,
        referred_by: friendReferral?.inviter_id || null,
        friend_discount_percent: friendDiscount,
        available_discount_percent: friendDiscount || (availableRewards > 0 ? REF_PERCENT : 0),
      });
    }

    return super.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/referral' && request.method === 'GET') {
      const user = await validateRequestUser(request, env);
      if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
      return referralStats(env, user.id);
    }

    if (url.pathname === '/api/demo-admin-referral' && request.method === 'GET') {
      const admin = await validateRequestUser(request, env);
      if (!admin || !isAdmin(env, admin.id)) return json({ ok: false, error: 'Admin authorization failed' }, 403);
      const clientId = positiveInt(url.searchParams.get('user'));
      if (!clientId) return json({ ok: false, error: 'Invalid client' }, 400);
      return referralStats(env, clientId);
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      let update = null;
      try { update = await request.clone().json(); } catch {}

      const message = update?.message || update?.edited_message;
      const text = String(message?.text || '').trim();
      const friendId = positiveInt(message?.from?.id);
      const referralMatch = /^\/start(?:@\w+)?\s+ref_(HC[A-Z0-9]+)$/i.exec(text);
      if (referralMatch && friendId) {
        const code = referralMatch[1].toUpperCase();
        const inviterId = decodeReferralCode(code);
        if (inviterId && inviterId !== friendId) {
          await registerReferral(env, inviterId, friendId, code);
        }
      }

      const completedMatch = /^hc:d:(\d+):/.exec(String(update?.callback_query?.data || ''));
      const response = await baseWorker.fetch(request, env, ctx);
      if (response.ok && completedMatch) {
        await completeReferral(env, positiveInt(completedMatch[1]));
      }
      return response;
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function cleanReferralCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^HC[A-Z0-9]{3,24}$/.test(code) ? code : '';
}

function decodeReferralCode(code) {
  const clean = cleanReferralCode(code);
  if (!clean) return 0;
  const value = Number.parseInt(clean.slice(2), 36);
  return positiveInt(value);
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  const id = env.APP_STORE.idFromName(APP_STORE_NAME);
  return env.APP_STORE.get(id);
}

async function referralStats(env, userId) {
  const stub = appStub(env);
  if (!stub) return json({ ok: false, error: 'Referral storage unavailable' }, 503);
  const response = await stub.fetch(`https://app.internal/ref/stats?user=${encodeURIComponent(userId)}`);
  return proxy(response);
}

async function registerReferral(env, inviterId, friendId, code) {
  try {
    const stub = appStub(env);
    if (!stub) return false;
    const response = await stub.fetch('https://app.internal/ref/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviter_id: inviterId, friend_id: friendId, code }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function completeReferral(env, friendId) {
  try {
    const stub = appStub(env);
    if (!stub || !friendId) return false;
    const response = await stub.fetch('https://app.internal/ref/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ friend_id: friendId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function adminIds(env) {
  const raw = [env.ADMIN_TELEGRAM_IDS, env.ADMIN_TELEGRAM_ID, env.ADMIN_ID].filter(Boolean).join(',');
  return [...new Set(String(raw).split(/[;,\s]+/).map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)))];
}

function isAdmin(env, id) {
  return adminIds(env).includes(String(id));
}

async function validateRequestUser(request, env) {
  return validateInitData(request.headers.get('X-Telegram-Init-Data') || '', env.TELEGRAM_BOT_TOKEN);
}

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const receivedHash = (params.get('hash') || '').toLowerCase();
    const authDate = Number(params.get('auth_date') || 0);
    const userRaw = params.get('user');
    if (!receivedHash || !authDate || !userRaw || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
    params.delete('hash');
    const entries = [...params.entries()];
    const candidates = [entries, entries.filter(([key]) => key !== 'signature')];
    const encoder = new TextEncoder();
    const secret = await hmac(encoder.encode('WebAppData'), encoder.encode(botToken));
    for (const candidate of candidates) {
      const check = [...candidate].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
      const digest = await hmac(secret, encoder.encode(check));
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (constantEqual(hex, receivedHash)) {
        const user = JSON.parse(userRaw);
        return user?.id ? user : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, dataBytes);
}

function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function proxy(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
