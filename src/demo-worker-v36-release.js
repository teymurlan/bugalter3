import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v35-bundled-orders.js';

export { ConsentStore };

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/benefits' && request.method === 'GET') {
      const response = await super.fetch(request);
      if (!response.ok) return response;
      const data = await response.json().catch(() => ({}));
      const friend = Math.max(0, Number(data.friend_discount_percent || 0));
      const reward = Number(data.available_referral_rewards || 0) > 0 && data.reward_armed ? 15 : 0;
      const referral = Math.max(friend, reward);
      return json({
        ...data,
        loyalty_percent: 0,
        referral_percent: referral,
        selected_percent: referral,
        selected_type: friend ? 'referral_friend' : reward ? 'referral_reward' : 'none',
      });
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx) {
    return baseWorker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
