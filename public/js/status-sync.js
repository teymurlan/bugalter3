const ORDERS_KEYS = ['hc-demo-orders-v3', 'hc-demo-orders-v2'];
const VALID = new Set(['NEW','REVIEW','CONFIRMED','CLEANER_ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED']);

function readOrders(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function writeOrders(key, orders) {
  try { localStorage.setItem(key, JSON.stringify(orders)); } catch {}
}

function applyStatusSync() {
  const params = new URLSearchParams(window.location.search);
  const number = params.get('sync_order') || '';
  const status = params.get('sync_status') || '';
  if (!number || !VALID.has(status)) return false;

  let found = false;
  for (const key of ORDERS_KEYS) {
    const orders = readOrders(key);
    const index = orders.findIndex((order) => String(order.order_number || '') === number);
    if (index < 0) continue;
    orders[index] = { ...orders[index], status, updated_at: new Date().toISOString() };
    writeOrders(key, orders);
    found = true;
  }

  sessionStorage.setItem('hc-last-status-sync', JSON.stringify({ number, status, at: Date.now(), found }));
  return found;
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

applyStatusSync();
navigateAfterSync();
