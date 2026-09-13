import baseWorker, { ConsentStore, AppStore } from './demo-worker-v34-launch.js';

export { ConsentStore, AppStore };

const APP_STORE_NAME = 'house-cleaning-app-v1';
const CONSENT_VERSION = '2026-09-09-v1';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/demo-order'
      && request.method === 'POST'
      && request.headers.get('X-HC-Photo-Bundle') === '1') {
      return handleBundledCreate(request, env, ctx, url.origin);
    }
    return baseWorker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function handleBundledCreate(request, env, ctx, origin) {
  try {
    const user = await authorizedUser(request, env, ctx);
    if (!user) return json({ ok: false, error: 'Telegram authorization failed' }, 401);
    const consent = await getConsent(env, user.id);
    if (!(consent?.status === 'accepted' && consent?.version === CONSENT_VERSION)) {
      return json({ ok: false, error: 'Сначала подтвердите согласие на обработку персональных данных командой /start.' }, 403);
    }
    let body = {};
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Некорректные данные заявки' }, 400); }
    if (String(body.event || 'created') !== 'created') return baseWorker.fetch(request, env, ctx);
    let order = cleanOrder(body.order);
    if (!order) return json({ ok: false, error: 'Проверьте данные заявки' }, 400);

    const existing = await appOrder(env, user.id, order.order_number);
    if (existing) {
      return json({ ok: true, event: 'created', adminNotified: 0, clientNotified: true, duplicateRecovered: true, order: existing });
    }

    const benefits = await referralBenefits(env, user.id);
    order = applyReferralDiscount(order, benefits);
    const stored = await appPutOrder(env, {
      ...order,
      status: 'NEW',
      client_telegram_id: Number(user.id),
      photo_file_ids: [],
    });
    if (!stored) return json({ ok: false, error: 'Не удалось сохранить заявку. Повторите попытку.' }, 503);

    if (stored.discount_type === 'referral_reward') {
      await appStub(env)?.fetch('https://app.internal/ref/reward-arm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: Number(user.id), enabled: false }),
      });
    }

    const clientText = [
      '<b>Заявка оформлена</b>',
      '',
      `<b>${escapeHtml(stored.order_number)}</b>`,
      `Уборка: ${escapeHtml(stored.service_name || 'Уборка')}`,
      `Дата: <b>${formatDate(stored.date)}</b> · <b>${escapeHtml(String(stored.time || '').slice(0, 5))}</b>`,
      `Адрес: ${escapeHtml([stored.city, stored.address, stored.apartment ? `кв./офис ${stored.apartment}` : ''].filter(Boolean).join(', '))}`,
      Number(stored.discount_percent) > 0 ? `Скидка: <b>${Number(stored.discount_percent)}%</b>` : '',
      Number(stored.estimated_price) > 0 ? `Предварительно: <b>от ${money(stored.estimated_price)}</b>` : '',
      '',
      'Скоро менеджер свяжется с вами для подтверждения.',
    ].filter(Boolean).join('\n');

    const sent = await safeTelegram(env, 'sendMessage', {
      chat_id: Number(user.id),
      text: clientText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть заявку', web_app: { url: `${origin}/?demo=1` }, style: 'primary' }]] },
    });

    return json({ ok: true, event: 'created', adminNotified: 0, clientNotified: Boolean(sent), order: stored });
  } catch (error) {
    console.error('Bundled order create failed', error);
    return json({ ok: false, error: 'Не удалось оформить заявку. Повторите попытку через минуту.' }, 500);
  }
}

async function referralBenefits(env, userId) {
  try {
    const response = await appStub(env)?.fetch(`https://app.internal/benefits?user=${encodeURIComponent(userId)}`);
    if (!response?.ok) return null;
    const data = await response.json();
    const referralPercent = Math.max(0, Number(data.friend_discount_percent || (Number(data.available_referral_rewards || 0) > 0 && data.reward_armed ? 15 : 0)));
    const type = Number(data.friend_discount_percent || 0) > 0 ? 'referral_friend' : referralPercent ? 'referral_reward' : '';
    return { percent: referralPercent, type };
  } catch { return null; }
}

function applyReferralDiscount(order, benefit) {
  const percent = Math.max(0, Math.min(100, Number(benefit?.percent || 0)));
  const before = Math.max(0, Number(order.estimated_price || order.price_before_discount || 0));
  if (!percent || !before) return { ...order, discount_percent: 0, discount_amount: 0, discount_type: '', price_before_discount: before || 0 };
  const amount = Math.round(before * percent / 100);
  return { ...order, price_before_discount: before, discount_percent: percent, discount_amount: amount, discount_type: benefit.type, estimated_price: Math.max(0, before - amount) };
}

function cleanOrder(raw) {
  const area = Number(raw?.area || 0);
  if (!raw?.order_number || !raw?.customer_name || !raw?.date || !raw?.address || !Number.isFinite(area) || area < 1 || area > 5000) return null;
  return {
    ...raw,
    area,
    order_number: String(raw.order_number),
    customer_name: String(raw.customer_name),
    phone: String(raw.phone || ''),
    contact_method: String(raw.contact_method || raw.contactMethod || 'telegram'),
    service_name: String(raw.service_name || 'Уборка'),
    city: String(raw.city || ''),
    address: String(raw.address || ''),
    apartment: String(raw.apartment || ''),
    date: String(raw.date),
    time: String(raw.time || '').slice(0, 5),
    addon_names: Array.isArray(raw.addon_names) ? raw.addon_names.map(String) : [],
    photo_count: Math.max(0, Number(raw.photo_count || 0)),
    estimated_price: Math.max(0, Number(raw.estimated_price || 0)),
    created_at: String(raw.created_at || new Date().toISOString()),
  };
}

async function authorizedUser(request, env, ctx) {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  if (!initData) return null;
  const gateUrl = new URL(request.url);
  gateUrl.pathname = '/api/referral-dashboard';
  gateUrl.search = '';
  const gate = await baseWorker.fetch(new Request(gateUrl, { headers: { 'X-Telegram-Init-Data': initData } }), env, ctx);
  if (!gate.ok) return null;
  try {
    const user = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
    return Number(user?.id) > 0 ? user : null;
  } catch { return null; }
}

async function getConsent(env, userId) {
  if (!env.CONSENT_STORE || !userId) return null;
  try {
    const id = env.CONSENT_STORE.idFromName(String(userId));
    const response = await env.CONSENT_STORE.get(id).fetch('https://consent.internal/record');
    return response.ok ? response.json() : null;
  } catch { return null; }
}
function appStub(env) { return env.APP_STORE ? env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME)) : null; }
async function appOrder(env, userId, number) { const response = await appStub(env)?.fetch(`https://app.internal/order?user=${encodeURIComponent(userId)}&number=${encodeURIComponent(number)}`); return response?.ok ? response.json() : null; }
async function appPutOrder(env, order) { const response = await appStub(env)?.fetch('https://app.internal/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order) }); return response?.ok ? (await response.json()).order : null; }
async function safeTelegram(env, method, payload) { try { return await telegram(env, method, payload); } catch (error) { console.error(`Telegram ${method} failed`, error); return null; } }
async function telegram(env, method, payload) { const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`); return data.result; }
function formatDate(value) { const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value || ''); }
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' } }); }
