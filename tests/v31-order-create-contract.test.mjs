import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker31 = readFileSync('src/demo-worker-v31-order-create-safe.js', 'utf8');
const worker32 = readFileSync('src/demo-worker-v32-multipart-boundary.js', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');

test('v32 is the active Worker and keeps v31 as the order base', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/demo-worker-v32-multipart-boundary\.js"/);
  assert.match(worker32, /from '\.\/demo-worker-v31-order-create-safe\.js'/);
});

test('v32 repairs missing multipart boundary without touching fields or photos', () => {
  assert.match(worker32, /multipart\/form-data/);
  assert.match(worker32, /!hasBoundary/);
  assert.match(worker32, /extractBoundary/);
  assert.match(worker32, /headers\.set\('content-type', `multipart\/form-data; boundary=\$\{boundary\}`\)/);
  assert.match(worker32, /body = await request\.arrayBuffer\(\)/);
});

test('v31 still owns discounted order creation after boundary repair', () => {
  assert.match(worker31, /url\.pathname === '\/api\/demo-order'/);
  assert.match(worker31, /selected_percent/);
  assert.match(worker31, /handleDiscountedMultipartOrder/);
  assert.match(worker31, /withDiscount\(rawOrder, benefits\)/);
  assert.match(worker31, /uploadPhotoSet/);
  assert.match(worker31, /appPutOrder/);
  assert.match(worker31, /discount_type === 'referral_reward'/);
});

test('v32 preserves scheduled reminders from lower layers', () => {
  assert.match(worker32, /baseWorker\.scheduled/);
});
