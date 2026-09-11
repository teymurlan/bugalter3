import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v25-referral-safety.js';

export { ConsentStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const REF_PERCENT = 15;
const RELEASED_STATUSES = new Set(['CANCELLED']);

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/benefits' && request.method === 'GET') {
      const userId = positiveInt(url.searchParams.get('user'));
      if (!userId) return json({ ok: false, error: 'Invalid user' }, 400);
      return json({ ok: true, ...(await this.safeBenefitsFor(userId)) });
    }
    return super.fetch(request);
  }

  async safeBenefitsFor(userId) {
    const ordersRaw = await this.state.storage.list({ prefix: `order:${userId}:` });
    const orders = [...ordersRaw.values()].filter(Boolean);
    const completed = orders.filter((order) => order.status === 'COMPLETED').length;
    const loyalty = completed >= 10 ? 10 : completed >= 3 ? 5 : 0;

    const activeFriendReservation = orders.some((order) =>
      order.discount_type === 'referral_friend'
      && !RELEASED_STATUSES.has(String(order.status || '')),
    );
    const activeRewardReservations = orders.filter((order) =>
      order.discount_type === 'referral_reward'
      && !RELEASED_STATUSES.has(String(order.status || ''))
      && order.status !== 'COMPLETED',
    ).length;

    const friendReferral = await this.state.storage.get(`ref:friend:${userId}`);
    const rewardCount = Math.max(0, Number(await this.state.storage.get(`ref:reward-count:${userId}`) || 0));
    const rewardUsed = Math.max(0, Number(await this.state.storage.get(`ref:reward-used:${userId}`) || 0));
    const rawAvailableRewards = Math.max(0, rewardCount - rewardUsed);
    const availableRewards = Math.max(0, rawAvailableRewards - activeRewardReservations);

    const friendDiscount = friendReferral && completed === 0 && !activeFriendReservation ? REF_PERCENT : 0;
    const referral = friendDiscount || (availableRewards > 0 ? REF_PERCENT : 0);
    const selected = Math.max(loyalty, referral);
    const selectedType = selected === 0
      ? 'none'
      : referral >= loyalty && referral > 0
        ? (friendDiscount ? 'referral_friend' : 'referral_reward')
        : 'loyalty';

    return {
      completed_orders: completed,
      loyalty_percent: loyalty,
      friend_discount_percent: friendDiscount,
      available_referral_rewards: availableRewards,
      reserved_referral_rewards: activeRewardReservations,
      referral_percent: referral,
      selected_percent: selected,
      selected_type: selectedType,
    };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo-admin-benefits' && request.method === 'GET') {
      const clientId = positiveInt(url.searchParams.get('user'));
      if (!clientId) return json({ ok: false, error: 'Invalid client' }, 400);

      // Reuse the existing protected admin referral endpoint only as the
      // authorization gate, so this wrapper does not duplicate Telegram auth.
      const authUrl = new URL(`${url.origin}/api/demo-admin-referral`);
      authUrl.searchParams.set('user', String(clientId));
      const authRequest = new Request(authUrl, {
        method: 'GET',
        headers: { 'X-Telegram-Init-Data': request.headers.get('X-Telegram-Init-Data') || '' },
      });
      const authorized = await baseWorker.fetch(authRequest, env, ctx);
      if (!authorized.ok) return authorized;

      const benefitsResponse = await appStub(env)?.fetch(`https://app.internal/benefits?user=${encodeURIComponent(clientId)}`);
      return benefitsResponse?.ok ? proxy(benefitsResponse) : json({ ok: false, error: 'Benefits unavailable' }, 503);
    }

    if (url.pathname === '/api/referral-dashboard' && request.method === 'GET') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const initData = request.headers.get('X-Telegram-Init-Data') || '';
      const userId = userIdFromValidatedInitData(initData);
      if (!userId) return response;
      const data = await response.json().catch(() => ({}));
      const benefitsResponse = await appStub(env)?.fetch(`https://app.internal/benefits?user=${encodeURIComponent(userId)}`);
      if (!benefitsResponse?.ok) return json(data);
      const benefits = await benefitsResponse.json();
      return json({
        ...data,
        available_rewards: Number(benefits.available_referral_rewards || 0),
        reserved_rewards: Number(benefits.reserved_referral_rewards || 0),
        available_discount_percent: Number(benefits.referral_percent || 0),
      });
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

function appStub(env) {
  if (!env.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

function userIdFromValidatedInitData(initData) {
  try {
    const user = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
    return positiveInt(user?.id);
  } catch { return 0; }
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
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
