function clean(value, max = 500) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function money(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `${Math.round(amount).toLocaleString('ru-RU')} ₽`;
}

function orderDisplayNumber(order) {
  return clean(order?.public_order_number || order?.display_number || order?.order_number, 100);
}

function orderAddress(order) {
  return [
    clean(order?.city, 120),
    clean(order?.address, 350),
    order?.apartment ? `кв./офис ${clean(order.apartment, 80)}` : '',
    order?.entrance ? `подъезд ${clean(order.entrance, 80)}` : '',
    order?.floor ? `этаж ${clean(order.floor, 80)}` : '',
  ].filter(Boolean).join(', ');
}

export function buildCentralNotificationPayload(event, order = {}) {
  const normalizedEvent = event === 'cancelled' ? 'cancelled' : 'created';
  const created = normalizedEvent === 'created';
  const lines = [];

  if (order.customer_name) lines.push(`👤 Клиент: ${clean(order.customer_name, 180)}`);
  if (order.phone) lines.push(`📞 Телефон: ${clean(order.phone, 80)}`);
  if (order.service_name) lines.push(`🧹 Услуга: ${clean(order.service_name, 160)}`);
  if (Number(order.area || 0) > 0) lines.push(`📐 Площадь: ${Number(order.area)} м²`);
  if (order.date || order.time) lines.push(`📅 Дата и время: ${[clean(order.date, 20), clean(order.time, 20)].filter(Boolean).join(' · ')}`);

  const address = orderAddress(order);
  if (address) lines.push(`📍 Адрес: ${address}`);

  if (created) {
    const addons = Array.isArray(order.addon_names)
      ? order.addon_names.map((item) => clean(item, 160)).filter(Boolean)
      : [];
    if (addons.length) lines.push(`➕ Дополнительно: ${addons.join(', ')}`);

    const price = money(order.estimated_price);
    if (price) lines.push(`💰 Предварительно: ${price}`);
    lines.push(`📸 Фото объекта: ${Math.max(0, Number(order.photo_count || 0))} шт.`);
    if (order.comment) lines.push(`💬 Комментарий: ${clean(order.comment, 1000)}`);
  }

  return {
    type: created ? 'new_order' : 'cancellation',
    title: created ? 'Новая заявка от клиента' : 'Клиент отменил заявку',
    order_id: orderDisplayNumber(order),
    source: 'Бот записи',
    message: lines.join('\n'),
  };
}

export async function sendCentralNotification(env, event, order, fetchImpl = fetch) {
  const baseUrl = clean(env?.HC_NOTIFY_URL, 1000).replace(/\/+$/, '');
  const secret = clean(env?.HC_NOTIFY_SECRET, 1000);
  if (!baseUrl || !secret) {
    return { ok: false, skipped: true, reason: 'not_configured' };
  }

  const response = await fetchImpl(`${baseUrl}/notify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(buildCentralNotificationPayload(event, order)),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Notification center error: ${response.status}`);
  }

  return data || { ok: true };
}
