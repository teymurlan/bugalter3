import baseWorker, { ConsentStore as BaseConsentStore, AppStore as BaseAppStore } from './demo-worker-v53-client-experience.js';
import { notificationEventFromRequest, sendCentralNotification } from './central-notifications.js';

const PUBLIC_SEQUENCE_KEY = 'system:public-order-sequence:v1';
const APP_STORE_NAME = 'house-cleaning-app-v1';
const ADMIN_SETTINGS_KEY = 'ultra7:admin-settings:v1';
const USER_PREFS_PREFIX = 'ultra7:user-prefs:';
const BROADCAST_PREFIX = 'ultra7:broadcast:';
const PROFILE_PREFIX = 'profile:item:';
const PRELAUNCH_RESET_KEY = 'system:prelaunch-reset:v66';
const ACTIVE_STATUSES = new Set(['NEW','REVIEW','CONFIRMED','CLEANER_ASSIGNED','IN_PROGRESS']);
let prelaunchResetPromise = null;

const DEFAULT_ADMIN_SETTINGS = Object.freeze({
  central_new_order: true,
  central_cancellation: true,
  client_confirmed: true,
  client_reminder: true,
  client_completed: true,
  client_review: true,
  marketing_enabled: true,
});

const DEFAULT_USER_PREFS = Object.freeze({
  confirmed: true,
  reminder: true,
  completed: true,
  review: true,
  marketing: true,
});

export class ConsentStore extends BaseConsentStore {}

export class AppStore extends BaseAppStore {
  constructor(state, env) {
    super(state, env);
    this.hcState = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/system/prelaunch-reset-v66/status' && request.method === 'GET') {
      const marker = await this.hcState.storage.get(PRELAUNCH_RESET_KEY);
      return json({ ok:true, marker:marker || null });
    }

    if (url.pathname === '/system/prelaunch-reset-v66/storage' && request.method === 'POST') {
      const existing = await this.hcState.storage.get(PRELAUNCH_RESET_KEY);
      if (existing?.status === 'complete' || existing?.status === 'storage_complete') {
        return json({ ok:true, already:true, marker:existing });
      }

      const orderRows = await this.hcState.storage.list({ prefix:'order:' });
      const draftRows = await this.hcState.storage.list({ prefix:'draft:' });
      const inviteRows = await this.hcState.storage.list({ prefix:'review:invite:' });
      await deleteStorageKeys(this.hcState.storage, [
        ...orderRows.keys(),
        ...draftRows.keys(),
        ...inviteRows.keys(),
        PUBLIC_SEQUENCE_KEY,
      ]);

      const profilesRaw = await this.hcState.storage.list({ prefix:PROFILE_PREFIX });
      let profilesReset = 0;
      for (const [key, value] of profilesRaw.entries()) {
        if (!value || typeof value !== 'object') continue;
        const profile = resetSubscriptionFields(value);
        await this.hcState.storage.put(key, profile);
        profilesReset += 1;
      }

      const marker = {
        status:'storage_complete',
        orders_deleted:orderRows.size,
        drafts_deleted:draftRows.size,
        review_invites_deleted:inviteRows.size,
        profiles_reset:profilesReset,
        updated_at:new Date().toISOString(),
      };
      await this.hcState.storage.put(PRELAUNCH_RESET_KEY, marker);
      return json({ ok:true, marker });
    }

    if (url.pathname === '/system/prelaunch-reset-v66/finish' && request.method === 'POST') {
      const body = await bodyJson(request);
      const previous = await this.hcState.storage.get(PRELAUNCH_RESET_KEY) || {};
      const marker = {
        ...previous,
        status:'complete',
        d1_orders_deleted:nonNegative(body.d1_orders_deleted),
        d1_drafts_deleted:nonNegative(body.d1_drafts_deleted),
        d1_profiles_reset:nonNegative(body.d1_profiles_reset),
        completed_at:new Date().toISOString(),
      };
      await this.hcState.storage.put(PRELAUNCH_RESET_KEY, marker);
      return json({ ok:true, marker });
    }

    if (url.pathname === '/ultra7/admin-settings') {
      if (request.method === 'GET') return json({ ok:true, settings:await this.adminSettings() });
      if (request.method === 'POST') {
        const body = await bodyJson(request);
        const settings = sanitizeAdminSettings(body?.settings || body);
        await this.hcState.storage.put(ADMIN_SETTINGS_KEY, settings);
        return json({ ok:true, settings });
      }
    }

    if (url.pathname === '/ultra7/user-prefs') {
      const userId = positiveInt(url.searchParams.get('user'));
      if (request.method === 'GET') {
        if (!userId) return json({ ok:false, error:'Invalid user' }, 400);
        return json({ ok:true, settings:await this.userPrefs(userId) });
      }
      if (request.method === 'POST') {
        const body = await bodyJson(request);
        const id = positiveInt(body?.user_id || userId);
        if (!id) return json({ ok:false, error:'Invalid user' }, 400);
        const settings = sanitizeUserPrefs(body?.settings || body);
        await this.hcState.storage.put(`${USER_PREFS_PREFIX}${id}`, settings);
        return json({ ok:true, settings });
      }
    }

    if (url.pathname === '/ultra7/notification-allowed' && request.method === 'GET') {
      const userId = positiveInt(url.searchParams.get('user'));
      const type = clean(url.searchParams.get('type'), 40);
      const allowed = await this.notificationAllowed(userId, type);
      return json({ ok:true, allowed });
    }

    if (url.pathname === '/ultra7/audience' && request.method === 'GET') {
      const clients = await this.audienceRows();
      return json({
        ok:true,
        clients,
        counts:{
          all: clients.length,
          active: clients.filter((item)=>item.active_count>0).length,
          completed: clients.filter((item)=>item.completed_count>0).length,
          subscription: clients.filter((item)=>item.cleanings_remaining>0).length,
          marketing: clients.filter((item)=>item.marketing !== false).length,
        },
      });
    }

    if (url.pathname === '/ultra7/client-schedule' && request.method === 'POST') {
      const body = await bodyJson(request);
      const userId = positiveInt(body?.telegram_id || body?.user_id);
      if (!userId) return json({ ok:false, error:'Invalid user' }, 400);
      const key = `${PROFILE_PREFIX}${userId}`;
      const previous = await this.hcState.storage.get(key) || { telegram_id:userId };
      const cleaningsTotal = nonNegative(body.cleanings_total ?? previous.cleanings_total);
      const cleaningsRemaining = body.cleanings_used !== undefined && body.cleanings_used !== null
        ? Math.max(0, cleaningsTotal - Math.min(cleaningsTotal, nonNegative(body.cleanings_used)))
        : Math.min(cleaningsTotal || Number.MAX_SAFE_INTEGER, nonNegative(body.cleanings_remaining ?? previous.cleanings_remaining));
      const profile = {
        ...previous,
        telegram_id:userId,
        subscription_name:clean(body.subscription_name ?? previous.subscription_name,80),
        cleanings_total:cleaningsTotal,
        cleanings_remaining:cleaningsRemaining,
        schedule_note:clean(body.schedule_note ?? previous.schedule_note,500),
        last_cleaning_at:clean(body.last_cleaning_at ?? previous.last_cleaning_at,40),
        next_cleaning_at:clean(body.next_cleaning_at ?? previous.next_cleaning_at,40),
        updated_at:new Date().toISOString(),
      };
      await this.hcState.storage.put(key, profile);
      return json({ ok:true, profile });
    }

    if (url.pathname === '/ultra7/broadcast-log') {
      if (request.method === 'GET') {
        const raw = await this.hcState.storage.list({ prefix:BROADCAST_PREFIX, limit:20, reverse:true });
        const broadcasts = [...raw.values()].filter(Boolean)
          .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
          .slice(0,12);
        return json({ ok:true, broadcasts });
      }
      if (request.method === 'POST') {
        const body = await bodyJson(request);
        const createdAt = new Date().toISOString();
        const entry = {
          id: clean(body.id || crypto.randomUUID(),80),
          title: clean(body.title,160),
          message: clean(body.message,1200),
          segment: clean(body.segment,40) || 'all',
          sent: nonNegative(body.sent),
          failed: nonNegative(body.failed),
          skipped: nonNegative(body.skipped),
          created_at: createdAt,
        };
        await this.hcState.storage.put(`${BROADCAST_PREFIX}${createdAt}:${entry.id}`, entry);
        return json({ ok:true, broadcast:entry });
      }
    }

    if (url.pathname === '/orders' && request.method === 'GET') {
      const data = await this.ensurePublicOrderNumbers();
      if (data) return json(data);
      return super.fetch(request);
    }

    if (url.pathname === '/order' && request.method === 'GET') {
      await this.ensurePublicOrderNumbers();
      return super.fetch(request);
    }

    if (url.pathname === '/order' && request.method === 'PUT') {
      let order = null;
      try { order = await request.clone().json(); } catch {}
      if (!order || typeof order !== 'object') return super.fetch(request);

      const snapshot = await this.ensurePublicOrderNumbers();
      const existing = (Array.isArray(snapshot?.orders) ? snapshot.orders : [])
        .find((item) => String(item?.order_number || '') === String(order?.order_number || ''));
      const existingNumber = publicNumber(existing);
      let number = publicNumber(order) || existingNumber;

      if (!number && !order.is_test) number = await this.nextPublicOrderNumber();
      if (number) order = { ...order, public_order_number: number, display_number: number };

      const forwarded = new Request(request.url, {
        method: 'PUT',
        headers: request.headers,
        body: JSON.stringify(order),
      });
      return super.fetch(forwarded);
    }

    return super.fetch(request);
  }

  async adminSettings() {
    const saved = await this.hcState.storage.get(ADMIN_SETTINGS_KEY);
    return { ...DEFAULT_ADMIN_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
  }

  async userPrefs(userId) {
    const saved = await this.hcState.storage.get(`${USER_PREFS_PREFIX}${userId}`);
    return { ...DEFAULT_USER_PREFS, ...(saved && typeof saved === 'object' ? saved : {}) };
  }

  async notificationAllowed(userId, type) {
    const admin = await this.adminSettings();
    const user = userId ? await this.userPrefs(userId) : DEFAULT_USER_PREFS;
    const map = {
      confirmed:['client_confirmed','confirmed'],
      reminder:['client_reminder','reminder'],
      completed:['client_completed','completed'],
      review:['client_review','review'],
      marketing:['marketing_enabled','marketing'],
    };
    const pair = map[type];
    if (!pair) return true;
    return admin[pair[0]] !== false && user[pair[1]] !== false;
  }

  async audienceRows() {
    const snapshot = await this.ensurePublicOrderNumbers();
    const orders = (Array.isArray(snapshot?.orders) ? snapshot.orders : []).filter((order)=>order && !order.is_test);
    const profilesRaw = await this.hcState.storage.list({ prefix:PROFILE_PREFIX });
    const profiles = [...profilesRaw.values()].filter(Boolean);
    const staffIds = new Set();
    try {
      const staffResponse = await super.fetch(new Request('https://app.internal/staff/list', { method:'GET' }));
      if (staffResponse?.ok) {
        const staffData = await staffResponse.json().catch(()=>({}));
        for (const person of (Array.isArray(staffData?.staff) ? staffData.staff : [])) {
          const staffId = positiveInt(person?.telegram_id);
          if (staffId) staffIds.add(staffId);
        }
      }
    } catch {}
    const byId = new Map();

    for (const profile of profiles) {
      const id = positiveInt(profile.telegram_id);
      if (!id) continue;
      byId.set(id, {
        telegram_id:id,
        name:clean(profile.name,160),
        phone:clean(profile.phone,80),
        subscription_name:clean(profile.subscription_name,80),
        cleanings_total:nonNegative(profile.cleanings_total),
        cleanings_remaining:nonNegative(profile.cleanings_remaining),
        schedule_note:clean(profile.schedule_note,500),
        profile_last_cleaning_at:clean(profile.last_cleaning_at,40),
        profile_next_cleaning_at:clean(profile.next_cleaning_at,40),
        orders:[],
      });
    }

    for (const order of orders) {
      const id = positiveInt(order.client_telegram_id);
      if (!id) continue;
      const row = byId.get(id) || {
        telegram_id:id,name:'',phone:'',subscription_name:'',cleanings_total:0,cleanings_remaining:0,
        schedule_note:'',profile_last_cleaning_at:'',profile_next_cleaning_at:'',orders:[],
      };
      if (!row.name) row.name = clean(order.customer_name,160);
      if (!row.phone) row.phone = clean(order.phone,80);
      row.orders.push(order);
      byId.set(id,row);
    }

    const now = Date.now() - 6 * 60 * 60 * 1000;
    const rows = [];
    for (const row of byId.values()) {
      const completed = row.orders.filter((order)=>String(order.status||'')==='COMPLETED')
        .sort((a,b)=>orderTimestamp(b)-orderTimestamp(a));
      const active = row.orders.filter((order)=>ACTIVE_STATUSES.has(String(order.status||'')));
      const upcoming = active.filter((order)=>orderTimestamp(order)>=now)
        .sort((a,b)=>orderTimestamp(a)-orderTimestamp(b));
      const prefs = await this.userPrefs(row.telegram_id);
      const last = completed[0] || null;
      const next = upcoming[0] || null;
      rows.push({
        telegram_id:row.telegram_id,
        name:row.name || `ID ${row.telegram_id}`,
        phone:row.phone || '',
        subscription_name:row.subscription_name || '',
        cleanings_total:row.cleanings_total,
        cleanings_remaining:(row.cleanings_total > 0 || row.subscription_name) ? row.cleanings_remaining : upcoming.length,
        cleanings_used:row.cleanings_total > 0 ? Math.max(0, row.cleanings_total - row.cleanings_remaining) : 0,
        schedule_note:row.schedule_note || '',
        completed_count:completed.length,
        active_count:active.length,
        last_cleaning_at:row.profile_last_cleaning_at || (last ? `${last.date || ''} ${String(last.time||'').slice(0,5)}`.trim() : ''),
        next_cleaning_at:row.profile_next_cleaning_at || (next ? `${next.date || ''} ${String(next.time||'').slice(0,5)}`.trim() : ''),
        next_order_number:next?.order_number || '',
        next_service:next?.service_name || '',
        next_address:[next?.city,next?.address].filter(Boolean).join(', '),
        marketing:prefs.marketing !== false,
      });
    }
    return rows
      .filter((row)=>!staffIds.has(Number(row.telegram_id)))
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ru'));
  }

  async ensurePublicOrderNumbers() {
    const response = await super.fetch(new Request('https://app.internal/orders', { method: 'GET' }));
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data || !Array.isArray(data.orders)) return data;

    const orders = data.orders.map((order) => ({ ...order }));
    const realOrders = orders.filter((order) => !order?.is_test);
    const maxExisting = realOrders.reduce((max, order) => Math.max(max, publicNumber(order)), 0);
    if (maxExisting) await this.ensureSequenceAtLeast(maxExisting);

    const missing = realOrders
      .filter((order) => !publicNumber(order))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))
        || String(a.order_number || '').localeCompare(String(b.order_number || '')));

    for (const order of missing) {
      const number = await this.nextPublicOrderNumber();
      order.public_order_number = number;
      order.display_number = number;
      await this.persistOrder(order);
    }

    for (const order of realOrders) {
      const number = publicNumber(order);
      if (!number || Number(order.display_number || 0) === number) continue;
      order.display_number = number;
      await this.persistOrder(order);
    }

    const byTechnicalNumber = new Map(realOrders.map((order) => [String(order.order_number || ''), order]));
    data.orders = orders.map((order) => byTechnicalNumber.get(String(order.order_number || '')) || order);
    return data;
  }

  async persistOrder(order) {
    return super.fetch(new Request('https://app.internal/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    }));
  }

  async ensureSequenceAtLeast(minimum) {
    await this.hcState.storage.transaction(async (txn) => {
      const current = Math.max(0, Number(await txn.get(PUBLIC_SEQUENCE_KEY) || 0));
      if (minimum > current) await txn.put(PUBLIC_SEQUENCE_KEY, minimum);
    });
  }

  async nextPublicOrderNumber() {
    return this.hcState.storage.transaction(async (txn) => {
      const current = Math.max(0, Number(await txn.get(PUBLIC_SEQUENCE_KEY) || 0));
      const next = current + 1;
      await txn.put(PUBLIC_SEQUENCE_KEY, next);
      return next;
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/') || url.pathname === '/telegram/webhook') {
      try {
        await ensurePrelaunchReset(env);
      } catch (error) {
        console.error('Prelaunch reset v66 failed', error);
        return json({ ok:false, error:'Завершаем предстартовую очистку. Повторите через несколько секунд.' }, 503);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/prelaunch-v66-status') {
      const stub = appStub(env);
      const markerResponse = await stub?.fetch('https://app.internal/system/prelaunch-reset-v66/status');
      const marker = markerResponse?.ok ? (await markerResponse.json().catch(()=>({}))).marker : null;
      const db = findD1(env);
      let d1Orders = null;
      let d1Drafts = null;
      if (db) {
        try { d1Orders = Number((await db.prepare('SELECT COUNT(*) AS count FROM hc_orders').first())?.count || 0); } catch {}
        try { d1Drafts = Number((await db.prepare('SELECT COUNT(*) AS count FROM hc_drafts').first())?.count || 0); } catch {}
      }
      return json({ ok:true, release:66, marker, d1_orders:d1Orders, d1_drafts:d1Drafts });
    }

    if (request.method === 'GET' && url.pathname === '/api/central-notification-health') {
      return centralNotificationHealth(env);
    }

    if (url.pathname === '/api/client-notification-settings' && ['GET','POST','PATCH'].includes(request.method)) {
      const client = await authorizedClient(request, env, ctx);
      if (!client) return json({ ok:false, error:'Telegram authorization failed' }, 401);
      const stub = appStub(env);
      if (!stub) return json({ ok:false, error:'Storage unavailable' }, 503);
      if (request.method === 'GET') {
        return proxy(await stub.fetch(`https://app.internal/ultra7/user-prefs?user=${encodeURIComponent(client.id)}`));
      }
      const body = await bodyJson(request);
      return proxy(await stub.fetch('https://app.internal/ultra7/user-prefs', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({ user_id:client.id, settings:body }),
      }));
    }

    if (url.pathname === '/api/admin-ultra7' && request.method === 'GET') {
      if (!(await authorizedAdmin(request, env, ctx))) return json({ ok:false, error:'Недостаточно прав' }, 403);
      const stub = appStub(env);
      if (!stub) return json({ ok:false, error:'Storage unavailable' }, 503);
      const [settingsRes,audienceRes,historyRes] = await Promise.all([
        stub.fetch('https://app.internal/ultra7/admin-settings'),
        stub.fetch('https://app.internal/ultra7/audience'),
        stub.fetch('https://app.internal/ultra7/broadcast-log'),
      ]);
      const settings = settingsRes.ok ? (await settingsRes.json()).settings : { ...DEFAULT_ADMIN_SETTINGS };
      const audience = audienceRes.ok ? await audienceRes.json() : { clients:[], counts:{} };
      const history = historyRes.ok ? await historyRes.json() : { broadcasts:[] };
      return json({
        ok:true,
        settings,
        clients:Array.isArray(audience.clients)?audience.clients:[],
        counts:audience.counts||{},
        broadcasts:Array.isArray(history.broadcasts)?history.broadcasts:[],
        notification_center:{ configured:Boolean(env?.HC_NOTIFY_URL && env?.HC_NOTIFY_SECRET) },
      });
    }

    if (url.pathname === '/api/admin-ultra7/settings' && request.method === 'POST') {
      if (!(await authorizedAdmin(request, env, ctx))) return json({ ok:false, error:'Недостаточно прав' }, 403);
      const body = await bodyJson(request);
      const response = await appStub(env)?.fetch('https://app.internal/ultra7/admin-settings', {
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ settings:body }),
      });
      return response ? proxy(response) : json({ ok:false, error:'Storage unavailable' }, 503);
    }

    if (url.pathname === '/api/admin-ultra7/client-schedule' && request.method === 'POST') {
      if (!(await authorizedAdmin(request, env, ctx))) return json({ ok:false, error:'Недостаточно прав' }, 403);
      const body = await bodyJson(request);
      const response = await appStub(env)?.fetch('https://app.internal/ultra7/client-schedule', {
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),
      });
      return response ? proxy(response) : json({ ok:false, error:'Storage unavailable' }, 503);
    }

    if (url.pathname === '/api/admin-ultra7/broadcast' && request.method === 'POST') {
      if (!(await authorizedAdmin(request, env, ctx))) return json({ ok:false, error:'Недостаточно прав' }, 403);
      const body = await bodyJson(request);
      return handleBroadcast(env, body);
    }

    if (url.pathname === '/api/demo-order-status' && request.method === 'POST') {
      let body = {};
      try { body = await request.clone().json(); } catch {}
      const status = String(body?.status || '');
      const clientId = positiveInt(body?.clientTelegramId || body?.order?.client_telegram_id);
      const orderNumber = cleanOrderNumber(body?.order?.order_number);
      if (status === 'CONFIRMED' && clientId && orderNumber) {
        const allowed = await notificationAllowed(env, clientId, 'confirmed');
        if (!allowed) {
          if (!(await authorizedAdmin(request, env, ctx))) return json({ ok:false, error:'Недостаточно прав' }, 403);
          const stored = await appStub(env)?.fetch('https://app.internal/status', {
            method:'PATCH',
            headers:{'content-type':'application/json'},
            body:JSON.stringify({
              client_telegram_id:clientId,
              order_number:orderNumber,
              status:'CONFIRMED',
            }),
          });
          if (!stored?.ok) return json({ ok:false, error:'Не удалось сохранить статус' }, 503);
          const data = await stored.json().catch(()=>({}));
          return json({
            ok:true,
            status:'CONFIRMED',
            order:data?.order || { ...(body.order || {}), status:'CONFIRMED' },
            clientNotified:false,
            notificationSuppressed:true,
          });
        }
      }
    }

    if (['/api/referral-link','/api/referral-dashboard','/api/referral-reward'].includes(url.pathname)) {
      return json({ ok:false, disabled:true, error:'Реферальная программа временно отключена.' }, 410);
    }

    const candidate = await notificationEventFromRequest(request);
    const response = await baseWorker.fetch(request, env, ctx);

    if (candidate && response.ok) {
      let result = null;
      try { result = await response.clone().json(); } catch {}

      const event = String(result?.event || candidate.event || '');
      const order = result?.order;
      const settings = await getAdminSettings(env);
      const eventAllowed = event === 'created'
        ? settings.central_new_order !== false
        : event === 'cancelled'
          ? settings.central_cancellation !== false
          : false;
      const shouldNotify = eventAllowed
        && result?.ok === true
        && !result?.duplicate
        && order
        && !order.is_test
        && (event === 'created' || event === 'cancelled');

      if (shouldNotify) {
        const task = sendCentralNotification(env, event, order)
          .catch((error) => console.error('Central notification failed', error?.message || error));
        if (ctx?.waitUntil) ctx.waitUntil(task);
        else void task;
      }
    }

    return response;
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(controller, env, ctx);
  },
};

async function authorizedClient(request, env, ctx) {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  if (!initData) return null;
  const authRequest = new Request(new URL('/api/client-profile', request.url), {
    method:'GET',
    headers:{ 'X-Telegram-Init-Data':initData },
  });
  const response = await baseWorker.fetch(authRequest, env, ctx);
  if (!response.ok) return null;
  try {
    const user = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
    const id = positiveInt(user?.id);
    return id ? { ...user, id } : null;
  } catch { return null; }
}

async function authorizedAdmin(request, env, ctx) {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  if (!initData) return false;
  const authRequest = new Request(new URL('/api/staff-v1/session', request.url), {
    method:'GET',
    headers:{ 'X-Telegram-Init-Data':initData },
  });
  const response = await baseWorker.fetch(authRequest, env, ctx);
  if (!response.ok) return false;
  const data = await response.json().catch(()=>({}));
  return data?.role === 'admin';
}

async function handleBroadcast(env, body = {}) {
  if (!env?.TELEGRAM_BOT_TOKEN) return json({ ok:false, error:'Telegram bot token is not configured' }, 503);
  const title = clean(body.title,160);
  const message = cleanMultiline(body.message,3500);
  const segment = ['all','active','completed','subscription'].includes(String(body.segment||'')) ? String(body.segment) : 'all';
  const buttonText = clean(body.button_text,60);
  const buttonUrl = safeButtonUrl(body.button_url);
  if (!message) return json({ ok:false, error:'Введите текст рассылки' }, 400);

  const stub = appStub(env);
  if (!stub) return json({ ok:false, error:'Storage unavailable' }, 503);
  const [audienceRes,settingsRes,staffRes] = await Promise.all([
    stub.fetch('https://app.internal/ultra7/audience'),
    stub.fetch('https://app.internal/ultra7/admin-settings'),
    stub.fetch('https://app.internal/staff/list'),
  ]);
  if (!audienceRes.ok) return json({ ok:false, error:'Не удалось получить список клиентов' }, 503);
  const audience = await audienceRes.json();
  const settings = settingsRes.ok ? (await settingsRes.json()).settings : DEFAULT_ADMIN_SETTINGS;
  if (settings.marketing_enabled === false) return json({ ok:false, error:'Рассылки отключены в настройках' }, 409);

  let clients = Array.isArray(audience.clients) ? audience.clients : [];
  const staffData = staffRes?.ok ? await staffRes.json().catch(()=>({})) : {};
  const staffIds = new Set((Array.isArray(staffData?.staff) ? staffData.staff : [])
    .map((item)=>positiveInt(item?.telegram_id))
    .filter(Boolean));
  clients = clients.filter((client)=>client.marketing !== false && !staffIds.has(positiveInt(client.telegram_id)));
  if (segment === 'active') clients = clients.filter((client)=>Number(client.active_count||0)>0);
  if (segment === 'completed') clients = clients.filter((client)=>Number(client.completed_count||0)>0);
  if (segment === 'subscription') clients = clients.filter((client)=>Number(client.cleanings_remaining||0)>0);
  if (!clients.length) return json({ ok:false, error:'В выбранном сегменте нет получателей' }, 409);

  const text = [title ? `<b>${escapeHtml(title)}</b>` : '', message ? escapeHtml(message) : ''].filter(Boolean).join('\n\n');
  const replyMarkup = buttonText && buttonUrl
    ? { inline_keyboard:[[{ text:buttonText, url:buttonUrl }]] }
    : undefined;

  let sent = 0;
  let failed = 0;
  const chunkSize = 12;
  for (let index=0; index<clients.length; index+=chunkSize) {
    const chunk = clients.slice(index,index+chunkSize);
    const results = await Promise.allSettled(chunk.map((client)=>telegram(env,'sendMessage',{
      chat_id:Number(client.telegram_id),
      text,
      parse_mode:'HTML',
      ...(replyMarkup ? { reply_markup:replyMarkup } : {}),
    })));
    results.forEach((result)=>{ if (result.status === 'fulfilled') sent += 1; else failed += 1; });
    if (index + chunkSize < clients.length) await delay(80);
  }

  const skipped = Math.max(0, Number(audience?.counts?.all || 0) - clients.length);
  await stub.fetch('https://app.internal/ultra7/broadcast-log', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({ title, message, segment, sent, failed, skipped }),
  }).catch(()=>{});

  return json({ ok:true, sent, failed, skipped, segment });
}

async function getAdminSettings(env) {
  try {
    const response = await appStub(env)?.fetch('https://app.internal/ultra7/admin-settings');
    return response?.ok ? (await response.json()).settings || { ...DEFAULT_ADMIN_SETTINGS } : { ...DEFAULT_ADMIN_SETTINGS };
  } catch { return { ...DEFAULT_ADMIN_SETTINGS }; }
}

async function notificationAllowed(env, userId, type) {
  try {
    const response = await appStub(env)?.fetch(`https://app.internal/ultra7/notification-allowed?user=${encodeURIComponent(userId)}&type=${encodeURIComponent(type)}`);
    if (!response?.ok) return true;
    return (await response.json().catch(()=>({})))?.allowed !== false;
  } catch {
    return true;
  }
}

async function centralNotificationHealth(env) {
  const baseUrl = String(env?.HC_NOTIFY_URL || '').trim().replace(/\/+$/, '');
  const secret = String(env?.HC_NOTIFY_SECRET || '').trim();
  const result = {
    ok: false,
    urlConfigured: Boolean(baseUrl),
    secretConfigured: Boolean(secret),
    targetHost: null,
    remoteStatus: null,
    remote: null,
  };

  if (baseUrl) {
    try { result.targetHost = new URL(baseUrl).host; }
    catch { return json({ ...result, stage: 'invalid_url' }, 200); }
  }

  if (!baseUrl || !secret) return json({ ...result, stage: 'local_config' }, 200);

  try {
    const response = await fetch(`${baseUrl}/diagnostics`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    });
    const data = await response.json().catch(() => null);
    result.remoteStatus = response.status;
    result.remote = data;
    result.ok = response.ok && data?.ok === true;
    return json({ ...result, stage: result.ok ? 'ready' : 'remote' }, 200);
  } catch (error) {
    return json({ ...result, stage:'network', error:String(error?.message || error || 'Connection failed').slice(0,500) }, 200);
  }
}

function sanitizeAdminSettings(value = {}) {
  const result = {};
  for (const key of Object.keys(DEFAULT_ADMIN_SETTINGS)) result[key] = value[key] !== false;
  return result;
}

function sanitizeUserPrefs(value = {}) {
  const result = {};
  for (const key of Object.keys(DEFAULT_USER_PREFS)) result[key] = value[key] !== false;
  return result;
}

function appStub(env) {
  if (!env?.APP_STORE) return null;
  return env.APP_STORE.get(env.APP_STORE.idFromName(APP_STORE_NAME));
}

async function ensurePrelaunchReset(env) {
  if (!env?.APP_STORE) return;
  if (!prelaunchResetPromise) {
    prelaunchResetPromise = runPrelaunchReset(env).catch((error) => {
      prelaunchResetPromise = null;
      throw error;
    });
  }
  return prelaunchResetPromise;
}

async function runPrelaunchReset(env) {
  const stub = appStub(env);
  if (!stub) return;

  const statusResponse = await stub.fetch('https://app.internal/system/prelaunch-reset-v66/status');
  const statusData = statusResponse?.ok ? await statusResponse.json().catch(()=>({})) : {};
  if (statusData?.marker?.status === 'complete') return;

  const storageResponse = await stub.fetch('https://app.internal/system/prelaunch-reset-v66/storage', { method:'POST' });
  if (!storageResponse?.ok) throw new Error('Unable to reset durable prelaunch data');

  let d1OrdersDeleted = 0;
  let d1DraftsDeleted = 0;
  let d1ProfilesReset = 0;
  const db = findD1(env);
  if (db) {
    try {
      const before = await db.prepare('SELECT COUNT(*) AS count FROM hc_orders').first();
      d1OrdersDeleted = Number(before?.count || 0);
      await db.prepare('DELETE FROM hc_orders').run();
    } catch (error) {
      console.warn('D1 order cleanup skipped', error);
    }

    try {
      const before = await db.prepare('SELECT COUNT(*) AS count FROM hc_drafts').first();
      d1DraftsDeleted = Number(before?.count || 0);
      await db.prepare('DELETE FROM hc_drafts').run();
    } catch (error) {
      console.warn('D1 draft cleanup skipped', error);
    }

    try {
      const rows = await db.prepare('SELECT telegram_id, profile_json FROM hc_clients').all();
      const profiles = Array.isArray(rows?.results) ? rows.results : [];
      for (const row of profiles) {
        let profile = {};
        try { profile = JSON.parse(String(row?.profile_json || '{}')); } catch {}
        const reset = resetSubscriptionFields(profile);
        await db.prepare('UPDATE hc_clients SET profile_json = ?, updated_at = ? WHERE telegram_id = ?')
          .bind(JSON.stringify(reset), new Date().toISOString(), Number(row.telegram_id || 0)).run();
        d1ProfilesReset += 1;
      }
    } catch (error) {
      console.warn('D1 profile cleanup skipped', error);
    }
  }

  const finish = await stub.fetch('https://app.internal/system/prelaunch-reset-v66/finish', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      d1_orders_deleted:d1OrdersDeleted,
      d1_drafts_deleted:d1DraftsDeleted,
      d1_profiles_reset:d1ProfilesReset,
    }),
  });
  if (!finish?.ok) throw new Error('Unable to finish prelaunch reset');
}

function findD1(env) {
  for (const name of ['DB','D1','DATABASE']) {
    const value = env?.[name];
    if (value && typeof value.prepare === 'function') return value;
  }
  for (const value of Object.values(env || {})) {
    if (value && typeof value.prepare === 'function' && typeof value.batch === 'function') return value;
  }
  return null;
}

function resetSubscriptionFields(profile) {
  const value = profile && typeof profile === 'object' ? profile : {};
  return {
    ...value,
    subscription_name:'',
    cleanings_total:0,
    cleanings_remaining:0,
    schedule_note:'',
    last_cleaning_at:'',
    next_cleaning_at:'',
    updated_at:new Date().toISOString(),
  };
}

async function deleteStorageKeys(storage, keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  for (let index=0; index<unique.length; index+=128) {
    const chunk = unique.slice(index,index+128);
    try { await storage.delete(chunk); }
    catch { for (const key of chunk) await storage.delete(key); }
  }
}

function orderTimestamp(order) {
  const date = String(order?.date || '').trim();
  const time = String(order?.time || '00:00').slice(0,5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(`${date}T${time}:00+03:00`);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function publicNumber(order) {
  const value = Number(order?.public_order_number || order?.display_number || 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function cleanOrderNumber(value) {
  const number = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(number) ? number : '';
}

function nonNegative(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function clean(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g,' ').slice(0,max);
}

function cleanMultiline(value, max = 3500) {
  return String(value ?? '').replace(/\r/g,'').trim().slice(0,max);
}

function safeButtonUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['https:','http:','tg:'].includes(url.protocol) ? raw.slice(0,1000) : '';
  } catch { return ''; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g,(char)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
}

async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(payload),
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function delay(ms) { return new Promise((resolve)=>setTimeout(resolve,ms)); }

function proxy(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control','no-store');
  return new Response(response.body,{ status:response.status, headers });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
  });
}
