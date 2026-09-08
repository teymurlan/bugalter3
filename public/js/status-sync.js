const ORDERS_KEY = 'hc-demo-orders-v2';
const VALID = new Set(['NEW','REVIEW','CONFIRMED','CLEANER_ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED']);

function readOrders() {
  try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); }
  catch { return []; }
}

function writeOrders(orders) {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
}

function applyStatusSync() {
  const params = new URLSearchParams(window.location.search);
  const number = params.get('sync_order') || '';
  const status = params.get('sync_status') || '';
  if (!number || !VALID.has(status)) return false;

  const orders = readOrders();
  const index = orders.findIndex((order) => String(order.order_number || '') === number);
  if (index >= 0) {
    orders[index] = { ...orders[index], status, updated_at: new Date().toISOString() };
    writeOrders(orders);
  }

  sessionStorage.setItem('hc-last-status-sync', JSON.stringify({ number, status, at: Date.now(), found: index >= 0 }));
  return index >= 0;
}

function navigateAfterSync() {
  const params = new URLSearchParams(window.location.search);
  const route = params.get('route');
  if (!route) return;

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const selector = route === 'admin' ? '[data-route="admin"]' : '[data-route="orders"]';
    const button = document.querySelector(selector);
    if (button && !button.closest('.hidden')) {
      clearInterval(timer);
      button.click();
      return;
    }
    if (attempts > 30) clearInterval(timer);
  }, 120);
}

const synced = applyStatusSync();
if (synced) {
  window.addEventListener('storage', () => {});
}
navigateAfterSync();
