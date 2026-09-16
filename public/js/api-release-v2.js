import { api, isDemoMode } from './api.js';
import { state } from './state.js';

const tg = window.Telegram?.WebApp;
const DEMO_ORDERS_KEY = 'hc-demo-orders-v3';

function authHeaders(extra = {}) {
  return { 'X-Telegram-Init-Data': tg?.initData || '', ...extra };
}

function loadOrders() {
  try {
    const value = JSON.parse(localStorage.getItem(DEMO_ORDERS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function saveOrders(orders) {
  try { localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify(orders)); } catch {}
}

function serviceById(id) {
  return (state.bootstrap?.services || []).find((service) => Number(service.id) === Number(id));
}

function orderSuffix(payload) {
  const fromDraft = String(payload?.idempotencyKey || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
  return fromDraft || Date.now().toString(36).slice(-6).toUpperCase();
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function encodePhotos(files = []) {
  return Promise.all(files.map(async (file, index) => ({
    name: file?.name || `object-${index + 1}.jpg`,
    type: file?.type || 'image/jpeg',
    data: await fileToBase64(file),
  })));
}

async function sendAlbum(orderNumber, photos, prepared = null) {
  const files = Array.isArray(photos) ? photos.slice(0, 10) : [];
  if (!files.length) return { ok: true, adminNotified: 0, photoNotified: true };

  const encoded = prepared ? await prepared : await encodePhotos(files);
  const response = await fetch('/api/demo-order-media', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ order_number: orderNumber, photos: encoded }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    return {
      ok: true,
      adminNotified: Number(data?.adminNotified || 0),
      photoNotified: false,
      warning: 'Фото не удалось прикрепить автоматически',
      order: data?.order || null,
    };
  }
  return { ...data, photoNotified: data?.photoNotified !== false };
}

async function createReleaseOrder(payload, photos = []) {
  const files = Array.isArray(photos) ? photos.slice(0, 10) : [];
  const encodedPhotos = files.length ? encodePhotos(files) : Promise.resolve([]);
  const availability = await api.availability(payload.date);
  const remaining = Number(availability?.remainingM2);
  if (Number.isFinite(remaining) && Number(payload.area) > remaining) {
    throw new Error(`На эту дату осталось только ${remaining} м²`);
  }

  const orders = loadOrders();
  const localId = orders.length ? Math.max(...orders.map((item) => Number(item.id) || 0)) + 1 : 1;
  const compactDate = String(payload.date || '').replaceAll('-', '').slice(2) || 'ORDER';
  const primary = serviceById(payload.serviceId);
  const selectedAddons = (payload.addonIds || []).map(serviceById).filter(Boolean);
  const addonTotal = selectedAddons.reduce((sum, item) => sum + Number(item.fixed_price || 0), 0);
  const ratePerM2 = Number(primary?.price_per_m2 || 0);
  const area = Number(payload.area || 0);
  const estimatedPrice = ratePerM2 > 0 && area > 0 ? Math.round(ratePerM2 * area + addonTotal) : 0;
  const telegramUser = tg?.initDataUnsafe?.user || {};

  const order = {
    id: localId,
    order_number: `HC-${compactDate}-${orderSuffix(payload)}`,
    status: 'NEW',
    service_id: Number(payload.serviceId),
    service_name: primary?.name || 'Уборка',
    property_type: payload.propertyType,
    area,
    rooms: Number(payload.rooms || 0),
    bathrooms: Number(payload.bathrooms || 0),
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
    photo_count: files.length,
    photo_ids: '',
    price_per_m2: ratePerM2,
    estimated_price: estimatedPrice || null,
    client_telegram_id: Number(telegramUser.id || 0),
    created_at: new Date().toISOString(),
    idempotency_key: String(payload.idempotencyKey || ''),
  };

  if (!order.client_telegram_id) {
    throw new Error('Не удалось определить Telegram ID. Закройте Mini App и откройте его заново из бота.');
  }

  const createResponse = await fetch('/api/demo-order', {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/json',
      ...(files.length ? { 'X-HC-Photo-Bundle': '1' } : {}),
    }),
    body: JSON.stringify({ order, event: 'created' }),
  });
  const created = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok || !created?.ok) {
    throw new Error(created?.error || 'Не удалось оформить заявку. Попробуйте ещё раз.');
  }

  let media = { ok: true, photoNotified: !files.length, adminNotified: Number(created.adminNotified || 0) };
  if (files.length) {
    try {
      media = await sendAlbum(order.order_number, files, encodedPhotos);
    } catch (error) {
      console.error('Order album upload failed after successful order creation', error);
      media = { ok: true, photoNotified: false, adminNotified: 0, warning: 'Фото будут проверены менеджером отдельно' };
    }
  }

  const finalOrder = {
    ...order,
    ...(created?.order || {}),
    ...(media?.order || {}),
    id: localId,
  };
  orders.unshift(finalOrder);
  saveOrders(orders);

  return {
    ok: true,
    demo: true,
    order: finalOrder,
    notification: {
      ...created,
      ...media,
      order: finalOrder,
      bookingCreated: true,
    },
  };
}

if (isDemoMode && api && typeof api === 'object') {
  api.createOrder = createReleaseOrder;
}
