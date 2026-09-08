const tg = window.Telegram?.WebApp;

const params = new URLSearchParams(window.location.search);
export const isDemoMode = params.get('demo') === '1'
  || window.location.hostname.endsWith('.pages.dev')
  || window.location.hostname.endsWith('.workers.dev');

const DEMO_ORDERS_KEY = 'hc-demo-orders-v2';
const DEMO_USER_KEY = 'hc-demo-user-v1';
const ACTIVE_STATUSES = new Set(['NEW', 'REVIEW', 'CONFIRMED', 'CLEANER_ASSIGNED', 'IN_PROGRESS']);
const DAILY_CAPACITY_M2 = 300;

const demoServices = [
  { id: 1, code: 'general', kind: 'primary', name: 'Генеральная уборка', description: 'Глубокая уборка всего объекта', price_per_m2: null, fixed_price: null, sort_order: 1 },
  { id: 2, code: 'maintenance', kind: 'primary', name: 'Поддерживающая уборка', description: 'Регулярное поддержание чистоты', price_per_m2: null, fixed_price: null, sort_order: 2 },
  { id: 3, code: 'post_renovation', kind: 'primary', name: 'После ремонта', description: 'Пыль, следы ремонта и сложные загрязнения', price_per_m2: null, fixed_price: null, sort_order: 3 },
  { id: 4, code: 'commercial', kind: 'primary', name: 'Коммерческая уборка', description: 'Офисы и коммерческие помещения', price_per_m2: null, fixed_price: null, sort_order: 4 },
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
function saveDemoOrders(orders) { localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify(orders)); }

function telegramDemoUser() {
  const user = tg?.initDataUnsafe?.user || {};
  return {
    id: 1,
    telegram_id: user.id || 'demo',
    username: user.username || '',
    first_name: user.first_name || 'Клиент',
    last_name: user.last_name || '',
    name: '', phone: '', photo_url: user.photo_url || '',
  };
}

function loadDemoUser() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DEMO_USER_KEY) || '{}'); } catch { /* ignore */ }
  return { ...telegramDemoUser(), ...saved };
}

function serviceById(id) { return demoServices.find((service) => Number(service.id) === Number(id)); }

function capacityForDate(date) {
  const orders = loadDemoOrders().filter((order) => order.date === date && ACTIVE_STATUSES.has(order.status));
  const usedM2 = orders.reduce((sum, order) => sum + Number(order.area || 0), 0);
  return { capacityM2: DAILY_CAPACITY_M2, usedM2, remainingM2: Math.max(0, DAILY_CAPACITY_M2 - usedM2) };
}

async function notifyAdmin(order) {
  if (!tg?.initData) return;
  try {
    await fetch('/api/demo-order', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ order }),
    });
  } catch (error) {
    console.warn('Admin notification failed', error);
  }
}

const demoApi = {
  async bootstrap() {
    return { ok: true, demo: true, user: loadDemoUser(), services: demoServices, config: { botUsername: '' } };
  },
  async orders() { return { ok: true, orders: loadDemoOrders() }; },
  async adminOrders() { return { ok: true, demo: true, orders: loadDemoOrders() }; },
  async order(id) {
    const order = loadDemoOrders().find((item) => Number(item.id) === Number(id));
    if (!order) throw new Error('Заявка не найдена');
    return { ok: true, order, addons: (order.addon_ids || []).map(serviceById).filter(Boolean), photos: [] };
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
    const next = { ...loadDemoUser(), name: (payload.name || '').trim(), phone: (payload.phone || '').trim() };
    localStorage.setItem(DEMO_USER_KEY, JSON.stringify(next));
    return { ok: true, user: next };
  },
  async cancelOrder(id) {
    const orders = loadDemoOrders();
    const index = orders.findIndex((item) => Number(item.id) === Number(id));
    if (index < 0) throw new Error('Заявка не найдена');
    orders[index] = { ...orders[index], status: 'CANCELLED' };
    saveDemoOrders(orders);
    return { ok: true, order: orders[index] };
  },
  async adminSetStatus(id, status) {
    const orders = loadDemoOrders();
    const index = orders.findIndex((item) => Number(item.id) === Number(id));
    if (index < 0) throw new Error('Заявка не найдена');
    orders[index] = { ...orders[index], status };
    saveDemoOrders(orders);
    return { ok: true, order: orders[index] };
  },
  async createOrder(payload, photos) {
    const capacity = capacityForDate(payload.date);
    if (Number(payload.area) > capacity.remainingM2) throw new Error(`На эту дату осталось только ${capacity.remainingM2} м²`);
    const orders = loadDemoOrders();
    const id = orders.length ? Math.max(...orders.map((item) => Number(item.id) || 0)) + 1 : 1;
    const compactDate = String(payload.date || '').replaceAll('-', '').slice(2) || 'DEMO';
    const primary = serviceById(payload.serviceId);
    const order = {
      id,
      order_number: `HC-${compactDate}-${String(id).padStart(4, '0')}`,
      status: 'NEW',
      service_id: Number(payload.serviceId),
      service_name: primary?.name || 'Уборка',
      property_type: payload.propertyType,
      area: Number(payload.area), rooms: Number(payload.rooms), bathrooms: Number(payload.bathrooms), pets: !!payload.pets,
      city: payload.city, address: payload.address, apartment: payload.apartment || '', entrance: payload.entrance || '', floor: payload.floor || '',
      address_comment: payload.addressComment || '', date: payload.date, time: payload.time,
      customer_name: payload.customerName, phone: payload.phone, comment: payload.comment || '',
      addon_ids: Array.isArray(payload.addonIds) ? payload.addonIds : [],
      addon_names: (payload.addonIds || []).map(serviceById).filter(Boolean).map((item) => item.name),
      photo_count: Array.isArray(photos) ? photos.length : 0, photo_ids: '', estimated_price: null,
      created_at: new Date().toISOString(),
    };
    orders.unshift(order);
    saveDemoOrders(orders);
    notifyAdmin(order);
    return { ok: true, demo: true, order };
  },
  photoUrl: () => '',
};

const liveApi = {
  bootstrap: () => request('/api/bootstrap'),
  orders: () => request('/api/orders'),
  adminOrders: () => request('/api/admin/orders'),
  order: (id) => request(`/api/orders/${id}`),
  availability: (date) => request(`/api/availability?date=${encodeURIComponent(date)}`),
  updateMe: (payload) => request('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  cancelOrder: (id) => request(`/api/orders/${id}/cancel`, { method: 'POST' }),
  adminSetStatus: (id, status) => request(`/api/admin/orders/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }),
  createOrder: async (payload, photos) => {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    photos.forEach((photo, index) => form.append('photos', photo, `object-${index + 1}.jpg`));
    return request('/api/orders', { method: 'POST', body: form });
  },
  photoUrl: (orderId, photoId) => `/api/orders/${orderId}/photos/${photoId}`,
};

export const api = isDemoMode ? demoApi : liveApi;
