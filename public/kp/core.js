export const tg = window.Telegram?.WebApp;
export const DEV = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
export const LOGO_URL = new URL('./logo.jpg', import.meta.url).href;
export const $ = (id) => document.getElementById(id);
export const state = { quote: null, history: [], logo: null, saveTimer: null };

export const COMPANY = {
  name: 'ИП Царегородцева Евгения Андреевна',
  inn: '781157991880',
  ogrnip: '325784700025441',
  address: '195030, Россия, г. Санкт-Петербург, ул. Дыбенко д. 6, корп. 2',
  phone: '+7 999 210 79 77',
  email: 'cleaning@tsaregorodtseva-1.ru',
};

export const TEMPLATES = {
  repair: { name: 'Уборка после ремонта', unit: 'м²', quantity: 1, unit_price: 480, mode: 'calc', fixed_amount: 0 },
  finish: { name: 'Финишная уборка после ремонта', unit: 'м²', quantity: 1, unit_price: 160, mode: 'calc', fixed_amount: 0 },
  windows: { name: 'Помывка окон', unit: 'шт', quantity: 1, unit_price: 1300, mode: 'calc', fixed_amount: 0 },
  mirrors: { name: 'Зеркала и зеркальные поверхности', unit: 'усл. ед.', quantity: 1, unit_price: 0, mode: 'fixed', fixed_amount: 6000 },
};

export function isoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${o.year}-${o.month}-${o.day}`;
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00+03:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function parseNum(value) {
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
export function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
export function money(n) { return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(round2(n))} ₽`; }
export function formatNumber(n) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(round2(n)); }
export function formatDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '—');
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function uid() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`; }

export function calcQuote(q = state.quote) {
  const items = (q?.items || []).map((item) => {
    const quantity = Math.max(0, parseNum(item.quantity));
    const unit_price = Math.max(0, parseNum(item.unit_price));
    const fixed_amount = Math.max(0, parseNum(item.fixed_amount));
    const amount = round2(item.mode === 'fixed' ? fixed_amount : quantity * unit_price);
    return { ...item, quantity, unit_price, fixed_amount, amount };
  });
  const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
  const discount_percent = Math.min(100, Math.max(0, parseNum(q?.discount_percent)));
  const discount_amount = round2(subtotal * discount_percent / 100);
  const total = round2(subtotal - discount_amount);
  const prepayment_percent = Math.min(100, Math.max(0, parseNum(q?.prepayment_percent)));
  const prepayment_amount = round2(total * prepayment_percent / 100);
  const balance_amount = round2(total - prepayment_amount);
  return { ...q, items, subtotal, discount_percent, discount_amount, total, prepayment_percent, prepayment_amount, balance_amount };
}

function headers() {
  return {
    'content-type': 'application/json',
    'X-Telegram-Init-Data': tg?.initData || '',
  };
}

export async function api(path, options = {}) {
  if (DEV) return devApi(path, options);
  const res = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

function defaultQuote(id, quoteNumber) {
  const today = isoToday();
  return {
    id, quote_number: quoteNumber, status: 'draft', client_name: '', object_type: 'Квартира', object_address: '',
    offer_date: today, valid_until: addDays(today, 14), prepayment_percent: 50, work_deadline: '', notes: '', discount_percent: 0,
    items: [], subtotal: 0, discount_amount: 0, total: 0, prepayment_amount: 0, balance_amount: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

function devStore() { return JSON.parse(localStorage.getItem('kp-dev-store') || '{"counter":0,"quotes":[]}'); }
function saveDevStore(v) { localStorage.setItem('kp-dev-store', JSON.stringify(v)); }

async function devApi(path, options = {}) {
  const store = devStore();
  if (path === '/api/kp/bootstrap') return { ok: true, admin: true, company: COMPANY };
  if (path === '/api/kp/new') {
    store.counter += 1;
    const year = new Date().getFullYear();
    const quote = defaultQuote(`dev-${store.counter}`, `HC-${year}-${String(store.counter).padStart(3, '0')}`);
    store.quotes.unshift(quote); saveDevStore(store); return { ok: true, quote };
  }
  if (path.startsWith('/api/kp/quotes')) return { ok: true, quotes: store.quotes };
  if (path.startsWith('/api/kp/quote?')) {
    const id = new URL(`http://x${path}`).searchParams.get('id');
    return { ok: true, quote: store.quotes.find((q) => q.id === id) };
  }
  if (path === '/api/kp/quote' && options.method === 'PUT') {
    const incoming = calcQuote(JSON.parse(options.body));
    const index = store.quotes.findIndex((q) => q.id === incoming.id);
    incoming.updated_at = new Date().toISOString();
    if (index >= 0) store.quotes[index] = incoming; else store.quotes.unshift(incoming);
    saveDevStore(store); return { ok: true, quote: incoming };
  }
  if (path === '/api/kp/duplicate') {
    const { id } = JSON.parse(options.body || '{}');
    const source = store.quotes.find((q) => q.id === id);
    store.counter += 1;
    const year = new Date().getFullYear();
    const quote = {
      ...structuredClone(source), id: `dev-${store.counter}`,
      quote_number: `HC-${year}-${String(store.counter).padStart(3, '0')}`,
      status: 'draft', offer_date: isoToday(), valid_until: addDays(isoToday(), 14),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    store.quotes.unshift(quote); saveDevStore(store); return { ok: true, quote };
  }
  throw new Error('DEV endpoint not implemented');
}

export async function loadLogo() {
  state.logo = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = LOGO_URL;
  });
}
