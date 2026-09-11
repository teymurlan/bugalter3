import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v24-referral-dashboard.js';

export { ConsentStore };

export class AppStore extends BaseAppStore {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ref/complete' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const friendId = positiveInt(body.friend_id);
      const orderNumber = cleanOrderNumber(body.order_number);
      if (!friendId || !orderNumber) return json({ ok: false, error: 'Invalid completion' }, 400);

      const completionKey = `ref:completion:${friendId}:${orderNumber}`;
      if (await this.state.storage.get(completionKey)) {
        return json({ ok: true, rewarded: false, consumed_reward: false, reason: 'already_processed' });
      }

      const order = await this.state.storage.get(`order:${friendId}:${orderNumber}`);
      if (!order || order.status !== 'COMPLETED') {
        return json({ ok: false, error: 'Order is not completed' }, 409);
      }

      const friendKey = `ref:friend:${friendId}`;
      const referral = await this.state.storage.get(friendKey);
      const ownRewardKey = `ref:reward-count:${friendId}`;
      const ownUsedKey = `ref:reward-used:${friendId}`;
      const ownRewards = Math.max(0, Number(await this.state.storage.get(ownRewardKey) || 0));
      const ownUsed = Math.max(0, Number(await this.state.storage.get(ownUsedKey) || 0));
      const consumeOwnReward = order.discount_type === 'referral_reward' && ownRewards > ownUsed;
      let awardedInvite = false;
      let nextReferral = referral || null;

      await this.state.storage.transaction(async (txn) => {
        if (await txn.get(completionKey)) return;
        await txn.put(completionKey, { processed_at: new Date().toISOString(), order_number: orderNumber });

        if (consumeOwnReward) await txn.put(ownUsedKey, ownUsed + 1);

        if (referral && referral.status !== 'completed') {
          nextReferral = { ...referral, status: 'completed', completed_at: new Date().toISOString(), completed_order_number: orderNumber };
          const inviterRewardKey = `ref:reward-count:${referral.inviter_id}`;
          const inviterCurrent = Math.max(0, Number(await txn.get(inviterRewardKey) || 0));
          await txn.put(friendKey, nextReferral);
          await txn.put(`ref:invite:${referral.inviter_id}:${friendId}`, nextReferral);
          await txn.put(inviterRewardKey, inviterCurrent + 1);
          awardedInvite = true;
        }
      });

      return json({
        ok: true,
        rewarded: awardedInvite,
        consumed_reward: consumeOwnReward,
        referral: nextReferral,
        reason: awardedInvite ? 'invite_completed' : referral ? 'already_completed' : 'not_referred',
      });
    }

    return super.fetch(request);
  }
}

export default baseWorker;

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function cleanOrderNumber(value) {
  const number = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(number) ? number : '';
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
