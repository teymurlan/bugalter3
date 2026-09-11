import baseWorker, { ConsentStore, AppStore } from './demo-worker-v23-reviews-benefits.js';

export { ConsentStore, AppStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/referral-dashboard' || request.method !== 'GET') {
      return baseWorker.fetch(request, env, ctx);
    }

    const initData = request.headers.get('X-Telegram-Init-Data') || '';
    const authRequest = new Request(`${url.origin}/api/referral`, {
      method: 'GET',
      headers: { 'X-Telegram-Init-Data': initData },
    });
    const statsResponse = await baseWorker.fetch(authRequest, env, ctx);
    if (!statsResponse.ok) return statsResponse;

    const userId = userIdFromInitData(initData);
    if (!userId) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
    const stats = await statsResponse.json().catch(() => ({}));
    const stub = appStub(env);
    if (!stub) return json({ ok: false, error: 'Referral storage unavailable' }, 503);
    const listResponse = await stub.fetch('https://app.internal/ref/admin-list');
    if (!listResponse.ok) return json({ ok: false, error: 'Referral storage unavailable' }, 503);
    const all = (await listResponse.json())?.referrals || [];
    const own = all.filter((item) => Number(item.inviter_id) === Number(userId));

    return json({
      ok: true,
      invited_count: own.length,
      ordered_friends: own.filter((item) => item.order_created).length,
      confirmed_friends: own.filter((item) => item.order_confirmed).length,
      completed_friends: own.filter((item) => item.completed).length,
      available_rewards: Number(stats.available_rewards || 0),
      reward_percent: Number(stats.reward_percent || 15),
      friend_discount_percent: Number(stats.friend_discount_percent || 0),
      available_discount_percent: Number(stats.available_discount_percent || 0),
    });
  },
};

function userIdFromInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const user = JSON.parse(params.get('user') || '{}');
    const id = Number(user?.id || 0);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  } catch { return 0; }
}

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
