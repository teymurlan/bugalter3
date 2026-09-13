import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker31 = readFileSync('src/demo-worker-v31-order-create-safe.js', 'utf8');
const worker32 = readFileSync('src/demo-worker-v32-multipart-boundary.js', 'utf8');
const worker33 = readFileSync('src/demo-worker-v33-raw-order-photos.js', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');

test('v33 is active and keeps v32/v31 below it', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/demo-worker-v33-raw-order-photos\.js"/);
  assert.match(worker33, /from '\.\/demo-worker-v32-multipart-boundary\.js'/);
  assert.match(worker32, /from '\.\/demo-worker-v31-order-create-safe\.js'/);
});

test('legacy multipart repair remains available only as fallback', () => {
  assert.match(worker32, /multipart\/form-data/);
  assert.match(worker32, /extractBoundary/);
  assert.match(worker32, /body = await request\.arrayBuffer\(\)/);
});

test('v31 still preserves discounted multipart fallback behavior', () => {
  assert.match(worker31, /url\.pathname === '\/api\/demo-order'/);
  assert.match(worker31, /selected_percent/);
  assert.match(worker31, /handleDiscountedMultipartOrder/);
  assert.match(worker31, /withDiscount\(rawOrder, benefits\)/);
});

test('v33 preserves scheduled reminders from lower layers', () => {
  assert.match(worker33, /baseWorker\.scheduled/);
});
