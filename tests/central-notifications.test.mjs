import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCentralNotificationPayload, sendCentralNotification } from '../src/central-notifications.js';

test('builds new order payload for notification center', () => {
  const payload = buildCentralNotificationPayload('created', {
    public_order_number: 184,
    customer_name: 'Тимур',
    phone: '+79990000000',
    service_name: 'Генеральная уборка',
    area: 72,
    date: '2026-09-18',
    time: '14:00',
    city: 'Санкт-Петербург',
    address: 'Комендантский пр., 15',
    apartment: '42',
    addon_names: ['Мытьё окон'],
    estimated_price: 6500,
    photo_count: 2,
  });

  assert.equal(payload.type, 'new_order');
  assert.equal(payload.order_id, '184');
  assert.equal(payload.source, 'Бот записи');
  assert.match(payload.message, /Тимур/);
  assert.match(payload.message, /6\s?500 ₽/);
  assert.match(payload.message, /Комендантский/);
});

test('builds cancellation payload', () => {
  const payload = buildCentralNotificationPayload('cancelled', {
    display_number: 184,
    customer_name: 'Тимур',
    date: '2026-09-18',
    time: '14:00',
    address: 'Комендантский пр., 15',
  });

  assert.equal(payload.type, 'cancellation');
  assert.equal(payload.order_id, '184');
  assert.match(payload.title, /отменил/i);
});

test('sender uses bearer secret and /notify endpoint', async () => {
  let request = null;
  const fakeFetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await sendCentralNotification({
    HC_NOTIFY_URL: 'https://notify.example.workers.dev/',
    HC_NOTIFY_SECRET: 'secret-value',
  }, 'created', { order_number: 'HC-1' }, fakeFetch);

  assert.equal(result.ok, true);
  assert.equal(request.url, 'https://notify.example.workers.dev/notify');
  assert.equal(request.init.headers.authorization, 'Bearer secret-value');
  const body = JSON.parse(request.init.body);
  assert.equal(body.type, 'new_order');
});

test('sender skips safely when not configured', async () => {
  const result = await sendCentralNotification({}, 'created', { order_number: 'HC-1' }, async () => {
    throw new Error('must not be called');
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'not_configured');
});
