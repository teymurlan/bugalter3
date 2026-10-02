import { state } from './state.js';
import { showToast } from './utils.js';

const params = new URLSearchParams(location.search);
const CLIENT_MODE = params.get('admin') !== '1' && params.get('staff') !== '1';
let queued = false;

function localOrders() {
  try {
    const rows = JSON.parse(localStorage.getItem('hc-demo-orders-v3') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

function currentOrder() {
  const id = Number(window.HCNavigation?.current?.()?.params?.orderId || 0);
  if (!id) return null;
  const cache = Array.isArray(window.__HC_CLIENT_ORDERS_CACHE) ? window.__HC_CLIENT_ORDERS_CACHE : [];
  return [...cache, ...localOrders()].find((item) => Number(item?.id || 0) === id) || null;
}

function serviceIdFor(order) {
  const direct = Number(order?.service_id || order?.serviceId || 0);
  if (direct > 0) return direct;
  const name = String(order?.service_name || '').trim().toLowerCase();
  const service = (state.bootstrap?.services || []).find((item) => String(item?.name || '').trim().toLowerCase() === name);
  return Number(service?.id || 0) || null;
}

async function repeatOrder(order) {
  if (!order) return showToast('Не удалось прочитать прошлую заявку', true);
  const id = serviceIdFor(order);
  if (!id) return showToast('Услуга из прошлой заявки больше недоступна', true);

  state.photos.forEach((item) => { try { URL.revokeObjectURL(item?.url); } catch {} });
  state.photos = [];
  await state.persistPhotos();

  state.draft = {
    ...state.draft,
    step: 6,
    serviceId: id,
    propertyType: order.property_type || order.propertyType || 'apartment',
    area: Math.max(10, Number(order.area || 50)),
    rooms: Math.max(0, Number(order.rooms || 0)),
    bathrooms: Math.max(0, Number(order.bathrooms || 0)),
    pets: Boolean(order.pets),
    addonIds: Array.isArray(order.addon_ids) ? order.addon_ids.map(Number).filter(Number.isFinite) : [],
    serviceArea: String(order.city || '').toLowerCase().includes('ленинград') ? 'lo' : 'spb',
    city: order.city || 'Санкт-Петербург',
    address: order.address || '',
    apartment: order.apartment || '',
    entrance: order.entrance || '',
    floor: order.floor || '',
    addressComment: order.address_comment || order.addressComment || '',
    visitType: 'repeat',
    visitTypeConfirmed: true,
    photoRequired: false,
    knownAddress: true,
    date: '',
    time: '',
    customerName: order.customer_name || order.customerName || state.draft.customerName || '',
    phone: order.phone || state.draft.phone || '',
    contactMethod: order.contact_method || order.contactMethod || state.draft.contactMethod || 'telegram',
    comment: '',
    idempotencyKey: crypto.randomUUID(),
  };
  state.saveDraft();
  try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
  showToast('Параметры прошлого заказа заполнены — выберите новую дату');
  await window.HCNavigation?.navigate?.('booking', {}, { replace:true });
}

function decorate() {
  queued = false;
  if (!CLIENT_MODE) return;
  const actions = document.querySelector('.hc-order-actions');
  if (!actions || actions.querySelector('[data-repeat-order-v70]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hc-btn hc-repeat-order-v70';
  button.dataset.repeatOrderV70 = '1';
  button.textContent = '↻ Повторить заказ';
  button.onclick = () => repeatOrder(currentOrder());
  actions.prepend(button);
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(decorate);
}

if (CLIENT_MODE) {
  new MutationObserver(queue).observe(document.documentElement, { childList:true, subtree:true });
  window.addEventListener('hc:route-rendered', queue);
  document.addEventListener('DOMContentLoaded', queue, { once:true });
  queue();
}
