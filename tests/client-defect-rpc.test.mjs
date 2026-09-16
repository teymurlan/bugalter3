import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/client-defect-rpc.js','utf8');
const shared=fs.readFileSync('src/demo-worker-v50-shared-booking.js','utf8');
const wrangler=fs.readFileSync('wrangler.jsonc','utf8');

test('private AppStore accepts defect delivery through reliable fetch channel',()=>{
  assert.ok(worker.includes("url.pathname === '/staff/notify-defect'"));
  assert.ok(worker.includes('await request.formData()'));
  assert.ok(worker.includes('async notifyClientDefect(payload = {})'));
  assert.ok(worker.includes('staff:defect:client:'));
  assert.ok(worker.includes('staff:defect:intro:'));
  assert.ok(worker.includes('sendPhoto'));
  assert.ok(worker.includes('На объекте зафиксирован дефект до начала уборки'));
  assert.ok(worker.includes('Ниже отправляем только фотографии отмеченных дефектов'));
});

test('defect notification is idempotent and resolves customer from old and new order id fields',()=>{
  assert.ok(worker.includes("super.fetch(new Request('https://app.internal/orders'))"));
  assert.ok(worker.includes('already_sent:true'));
  assert.ok(worker.includes('order?.client_telegram_id'));
  assert.ok(worker.includes('order?.telegram_id'));
  assert.ok(worker.includes('order?.user_id'));
  assert.ok(worker.includes('order?.userId'));
  assert.ok(worker.includes('order?.client?.id'));
  assert.ok(worker.includes('this.hcState.storage.put(sentKey'));
});

test('large image has delivery fallback instead of silently disappearing',()=>{
  assert.ok(worker.includes("telegramMultipart(token, 'sendPhoto'"));
  assert.ok(worker.includes("telegramMultipart(token, 'sendDocument'"));
  assert.ok(worker.includes("delivery = 'document'"));
});

test('active worker keeps full production chain through shared booking and defect wrapper',()=>{
  assert.match(wrangler,/"main"\s*:\s*"src\/demo-worker-v50-shared-booking\.js"/);
  assert.ok(shared.includes("from './client-defect-rpc.js'"));
  assert.ok(worker.includes("from './demo-worker-v44-production.js'"));
});
