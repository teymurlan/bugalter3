const tg = window.Telegram?.WebApp;

export const isDemoMode = new URLSearchParams(window.location.search).get('demo') === '1'
  || window.location.hostname.endsWith('.pages.dev');

const DEMO_ORDERS_KEY = 'hc-demo-orders-v1';
const DEMO_USER_KEY = 'hc-demo-user-v1';

const demoServices = [
  { id: 1, code: 'general', kind: 'primary', name: 'Генеральная уборка', description: 'Глубокая уборка квартиры или дома', price_per_m2: null, fixed_price: null, sort_order: 1 },
  { id: 2, code: 'maintenance', kind: 'primary', name: 'Поддерживающая уборка', description: 'Регулярное поддержание чистоты', price_per_m2: null, fixed_price: null, sort_order: 2 },
  { id: 3, code: 'post_renovation', kind: 'primary', name: 'После ремонта', description: 'Строительная пыль и сложные загрязнения', price_per_m2: null, fixed_price: null, sort_order: 3 },
  { id: 4, code: 'commercial', kind: 'primary', name: 'Коммерческая уборка', description: 'Офисы и коммерческие помещения', price_per_m2: null, fixed_price: null, sort_order: 4 },
  { id: 101, code: 'windows', kind: 'addon', name: 'Мытьё окон', description: 'Окна и подоконники', price_per_m2: null, fixed_price: null, sort_order: 1 },
  { id: 102, code: 'fridge', kind: 'addon', name: 'Холодильник внутри', description: 'Внутренняя мойка холодильника', price_per_m2: null, fixed_price: null, sort_order: 2 },
  { id: 103, code: 'oven', kind: 'addon', name: 'Духовка внутри', description: 'Очистка духовки изнутри', price_per_m2: null, fixed_price: null, sort_order: 3 },
  { id: 104, code: 'cabinets', kind: 'addon', name: 'Шкафы внутри', description: 'Уборка внутри кухонных шкафов', price_per_m2: null, fixed_price: null, sort_order: 4 },
  { id: 105, code: 'balcony', kind: 'addon', name: 'Балкон', description: 'Дополнительная уборка балкона', price_per_m2: null, fixed_price: null, sort_order: 5 },
];

function authHeaders(extra = {}) {
  return {
    'X-Telegram-Init-Data': tg?.initData || '',
    ...extra,
  };
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
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
  try { saved = JSON.parse(localStorage.getItem(DEMO_USER_KEY) || '{}'); } catch { /* ignore */ }
  return { ...telegramDemoUser(), ...saved };
}

function serviceById(id) {
  return demoServices.find((service) => Number(service.id) === Number(id));
}

const demoApi = {
  async bootstrap() {
    return {
      ok: true,
      demo: true,
      user: loadDemoUser(),
      services: demoServices,
      config: { botUsername: '' },
    };
  },
  async orders() {
    return { ok: true, orders: loadDemoOrders() };
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
    const slots = Array.from({ length: 10 }, (_, index) => ({
      time: `${String(index + 9).padStart(2, '0')}:00`,
      available: true,
    }));
    return { date, closed: false, slots };
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
  async createOrder(payload, photos) {
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
      area: Number(payload.area),
      rooms: Number(payload.rooms),
      bathrooms: Number(payload.bathrooms),
      pets: !!payload.pets,
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
      comment: payload.comment || '',
      addon_ids: Array.isArray(payload.addonIds) ? payload.addonIds : [],
      photo_count: Array.isArray(photos) ? photos.length : 0,
      photo_ids: '',
      estimated_price: null,
      created_at: new Date().toISOString(),
    };
    orders.unshift(order);
    saveDemoOrders(orders);
    return { ok: true, demo: true, order };
  },
  photoUrl: () => '',
};

const liveApi = {
  bootstrap: () => request('/api/bootstrap'),
  orders: () => request('/api/orders'),
  order: (id) => request(`/api/orders/${id}`),
  availability: (date) => request(`/api/availability?date=${encodeURIComponent(date)}`),
  updateMe: (payload) => request('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  cancelOrder: (id) => request(`/api/orders/${id}/cancel`, { method: 'POST' }),
  createOrder: async (payload, photos) => {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    photos.forEach((photo, index) => form.append('photos', photo, `object-${index + 1}.jpg`));
    return request('/api/orders', { method: 'POST', body: form });
  },
  photoUrl: (orderId, photoId) => `/api/orders/${orderId}/photos/${photoId}`,
};

export const api = isDemoMode ? demoApi : liveApi;
