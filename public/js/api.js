const tg = window.Telegram?.WebApp;

const params = new URLSearchParams(window.location.search);
export const isDemoMode = params.get('demo') === '1'
  || window.location.hostname.endsWith('.pages.dev')
  || window.location.hostname.endsWith('.workers.dev');

const DEMO_ORDERS_KEY = 'hc-demo-orders-v2';
const DEMO_USER_KEY = 'hc-demo-user-v1';
const ACTIVE_STATUSES = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
const SELF_CANCEL_STATUSES = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED']);
const DAILY_CAPACITY_M2 = 300;
const CANCEL_CUTOFF_HOURS = 24;

const demoServices = [
  { id: 1, code: 'general', kind: 'primary', name: 'Генеральная уборка', description: 'Глубокая уборка всего объекта', price_per_m2: 230, fixed_price: null, sort_order: 1 },
  { id: 2, code: 'maintenance', kind: 'primary', name: 'Поддерживающая уборка', description: 'Регулярное поддержание чистоты', price_per_m2: 95, fixed_price: null, sort_order: 2 },
  { id: 3, code: 'post_renovation', kind: 'primary', name: 'После ремонта', description: 'Пыль, следы ремонта и сложные загрязнения', price_per_m2: 230, fixed_price: null, sort_order: 3 },
  { id: 4, code: 'commercial', kind: 'primary', name: 'Коммерческая уборка', description: 'Офисы и коммерческие помещения', price_per_m2: 95, fixed_price: null, sort_order: 4 },
  { id: 101, code: 'windows', kind: 'addon', name: 'Мытьё окон', description: 'Окна, рамы и подоконники', price_per_m2: null, fixed_price: null, sort_order: 1 },
  { id: 102, code: 'fridge', kind: 'addon', name: 'Холодильник внутри', description: 'Внутренняя мойка холодильника', price_per_m2: null, fixed_price: null, sort_order: 2 },
  { id: 103, code: 'oven', kind: 'addon', name: 'Духовка внутри', description: 'Очистка духовки изнутри', price_per_m2: null, fixed_price: null, sort_order: 3 },
  { id: 104, code: 'cabinets', kind: 'addon', name: 'Шкафы внутри', description: 'Уборка внутри кухонных шкафов', price_per_m2: null, fixed_price: null, sort_order: 4 },
  { id: 105, code: 'balcony', kind: 'addon', name: 'Балкон', description: 'Дополнительная уборка балкона', price_per_m2: null, fixed_price: null, sort_order: 5 },
  { id: 106, code: 'ironing', kind: 'addon', name: 'Глажка', description: 'Дополнительная глажка вещей', price_per_m2: null, fixed_price: null, sort_order: 6 },
];

function authHeaders(extra = {}) {
  return { 'X-Telegram-Init-Data': tg?.initData || '', ...extra };
}

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: authHeaders(options.headers || {}) });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Ошибка ${response.status}`);
  return data;
}

function loadDemoOrders() {
  try { return JSON.parse(localStorage.getItem(DEMO_ORDERS_KEY) || '[]'); }
  catch { return []; }
}

function saveDemoOrders(orders) {
  localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify(orders));
}

function telegramDemoUser() {
  const user = tg?.initDataUnsafe?.user || {};
  return {
    id: 1,
    telegram_id: user.id || 'demo',
    username: user.username || '',
    first_name: user.first_name || 'Клиент',
    last_name: user.last_name || '',
    name: '',
    phone: '',
    photo_url: user.photo_url || '',
  };
}

function loadDemoUser() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DEMO_USER_KEY) || '{}'); }
  catch { /* ignore */ }
  return { ...telegramDemoUser(), ...saved };
}

function serviceById(id) {
  return demoServices.find((service) => Number(service.id) === Number(id));
}

function capacityForDate(date) {
  const orders = loadDemoOrders().filter((order) => order.date === date && ACTIVE_STATUSES.has(order.status));
  const usedM2 = orders.reduce((sum, order) => sum + Number(order.area || 0), 0);
  return {
    capacityM2: DAILY_CAPACITY_M2,
    usedM2,
    remainingM2: Math.max(0, DAILY_CAPACITY_M2 - usedM2),
  };
}

function orderStartTimestamp(order) {
  if (!order?.date || !order?.time) return NaN;
  return Date.parse(`${order.date}T${order.time}:00+03:00`);
}

export function hoursUntilOrder(order) {
  const start = orderStartTimestamp(order);
  if (!Number.isFinite(start)) return -Infinity;
  return (start - Date.now()) / 3600000;
}

export function canSelfCancel(order) {
  return SELF_CANCEL_STATUSES.has(order?.status)
    && hoursUntilOrder(order) >= CANCEL_CUTOFF_HOURS;
}

async function notifyBackend(order, event = 'created', photos = []) {
  let response;

  if (event === 'created' && Array.isArray(photos) && photos.length) {
    const form = new FormData();
    form.append('order', JSON.stringify(order));
    form.append('event', event);
    photos.slice(0, 10).forEach((photo, index) => form.append('photos', photo, photo.name || `object-${index + 1}.jpg`));
    response = await fetch('/api/demo-order', {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
  } else {
    response = await fetch('/api/demo-order', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ order, event }),
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    const details = Array.isArray(data?.adminErrors) && data.adminErrors.length
      ? ` (${data.adminErrors[0]})`
      : '';
    throw new Error(`${data?.error || `Ошибка уведомления ${response.status}`}${details}`);
  }
  return data;
}

async function notifyStatus(order, status) {
  const response = await fetch('/api/demo-order-status', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      order,
      status,
      clientTelegramId: order.client_telegram_id || 0,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok || !data?.clientNotified) {
    throw new Error(data?.error || `Не удалось уведомить клиента (${response.status})`);
  }
  return data;
}

async function demoConfig() {
  try {
    const response = await fetch('/api/demo-config', { headers: authHeaders() });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

const demoApi = {
  async bootstrap() {
    const config = await demoConfig();
    return {
      ok: true,
      demo: true,
      user: loadDemoUser(),
      services: demoServices,
      config: {
        botUsername: config.botUsername || '',
        managerUsername: config.managerUsername || config.botUsername || '',
        cancelCutoffHours: CANCEL_CUTOFF_HOURS,
        adminConfigured: Boolean(config.adminConfigured),
        reminder24hReady: Boolean(config.reminder24hReady),
      },
    };
  },

  async orders() {
    return { ok: true, orders: loadDemoOrders() };
  },

  async adminOrders() {
    return request('/api/demo-admin-orders');
  },

  async order(id) {
    const order = loadDemoOrders().find((item) => Number(item.id) === Number(id));
    if (!order) throw new Error('Заявка не найдена');
    return {
      ok: true,
      order,
      addons: (order.addon_ids || []).map(serviceById).filter(Boolean),
      photos: [],
    };
  },

  async availability(date) {
    const capacity = capacityForDate(date);
    const orders = loadDemoOrders().filter((order) => order.date === date && ACTIVE_STATUSES.has(order.status));
    const occupiedTimes = new Set(orders.map((order) => order.time));
    const slots = Array.from({ length: 10 }, (_, index) => {
      const time = `${String(index + 9).padStart(2, '0')}:00`;
      return { time, available: !occupiedTimes.has(time) && capacity.remainingM2 > 0 };
    });
    return { date, closed: capacity.remainingM2 <= 0, slots, ...capacity };
  },

  async updateMe(payload) {
    const next = {
      ...loadDemoUser(),
      name: (payload.name || '').trim(),
      phone: (payload.phone || '').trim(),
    };
    localStorage.setItem(DEMO_USER_KEY, JSON.stringify(next));
    return { ok: true, user: next };
  },

  async cancelOrder(id) {
    const orders = loadDemoOrders();
    const index = orders.findIndex((item) => Number(item.id) === Number(id));
    if (index < 0) throw new Error('Заявка не найдена');

    const current = orders[index];
    if (!SELF_CANCEL_STATUSES.has(current.status)) throw new Error('Эту заявку нельзя отменить самостоятельно');
    if (hoursUntilOrder(current) < CANCEL_CUTOFF_HOURS) throw new Error('До уборки осталось меньше 24 часов. Свяжитесь с менеджером');

    const cancelled = { ...current, status: 'CANCELLED', cancelled_at: new Date().toISOString() };
    const notification = await notifyBackend(cancelled, 'cancelled');
    if (Number(notification.adminNotified || 0) < 1) throw new Error('Отмена не сохранена: администратор не получил уведомление');

    orders[index] = cancelled;
    saveDemoOrders(orders);
    return { ok: true, order: cancelled, notification };
  },

  async adminSetStatus(order, status) {
    if (!order?.order_number) throw new Error('Заявка не найдена');
    const next = { ...order, status, updated_at: new Date().toISOString() };

    if (['CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      const notification = await notifyStatus(next, status);
      return { ok: true, order: next, notification };
    }

    return request('/api/demo-admin-store-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: next, status }),
    });
  },

  async createOrder(payload, photos) {
    const capacity = capacityForDate(payload.date);
    if (Number(payload.area) > capacity.remainingM2) throw new Error(`На эту дату осталось только ${capacity.remainingM2} м²`);

    const orders = loadDemoOrders();
    const id = orders.length ? Math.max(...orders.map((item) => Number(item.id) || 0)) + 1 : 1;
    const compactDate = String(payload.date || '').replaceAll('-', '').slice(2) || 'DEMO';
    const primary = serviceById(payload.serviceId);
    const selectedAddons = (payload.addonIds || []).map(serviceById).filter(Boolean);
    const addonTotal = selectedAddons.reduce((sum, item) => sum + Number(item.fixed_price || 0), 0);
    const ratePerM2 = Number(primary?.price_per_m2 || 0);
    const area = Number(payload.area || 0);
    const estimatedPrice = ratePerM2 > 0 && area > 0 ? Math.round(ratePerM2 * area + addonTotal) : 0;
    const telegramUser = tg?.initDataUnsafe?.user || {};

    const order = {
      id,
      order_number: `HC-${compactDate}-${String(id).padStart(4, '0')}`,
      status: 'NEW',
      service_id: Number(payload.serviceId),
      service_name: primary?.name || 'Уборка',
      property_type: payload.propertyType,
      area,
      rooms: Number(payload.rooms),
      bathrooms: Number(payload.bathrooms),
      pets: Boolean(payload.pets),
      city: payload.city,
      address: payload.address,
      apartment: payload.apartment || '',
      entrance: payload.entrance || '',
      floor: payload.floor || '',
      address_comment: payload.addressComment || '',
      date: payload.date,
      time: payload.time,
      customer_name: payload.customerName,
      phone: payload.phone,
      contact_method: payload.contact_method || payload.contactMethod || 'telegram',
      comment: payload.comment || '',
      addon_ids: Array.isArray(payload.addonIds) ? payload.addonIds : [],
      addon_names: selectedAddons.map((item) => item.name),
      photo_count: Array.isArray(photos) ? photos.length : 0,
      photo_ids: '',
      price_per_m2: ratePerM2,
      estimated_price: estimatedPrice || null,
      client_telegram_id: Number(telegramUser.id || 0),
      created_at: new Date().toISOString(),
    };

    if (!order.client_telegram_id) throw new Error('Не удалось определить Telegram ID. Закройте Mini App и откройте его заново из бота.');

    const notification = await notifyBackend(order, 'created', photos);
    if (Number(notification.adminNotified || 0) < 1) throw new Error('Заявка не отправлена: администратор не получил уведомление');

    if (notification?.order?.photo_file_ids) order.photo_file_ids = notification.order.photo_file_ids;
    orders.unshift(order);
    saveDemoOrders(orders);

    return { ok: true, demo: true, order, notification };
  },

  photoUrl: () => '',
};

const liveApi = {
  bootstrap: () => request('/api/bootstrap'),
  orders: () => request('/api/orders'),
  adminOrders: () => request('/api/admin/orders'),
  order: (id) => request(`/api/orders/${id}`),
  availability: (date) => request(`/api/availability?date=${encodeURIComponent(date)}`),
  updateMe: (payload) => request('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  cancelOrder: (id) => request(`/api/orders/${id}/cancel`, { method: 'POST' }),
  adminSetStatus: (id, status) => request(`/api/admin/orders/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }),
  createOrder: async (payload, photos) => {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    photos.forEach((photo, index) => form.append('photos', photo, `object-${index + 1}.jpg`));
    return request('/api/orders', { method: 'POST', body: form });
  },
  photoUrl: (orderId, photoId) => `/api/orders/${orderId}/photos/${photoId}`,
};

export const api = isDemoMode ? demoApi : liveApi;