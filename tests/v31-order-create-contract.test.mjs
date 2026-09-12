import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('src/demo-worker-v31-order-create-safe.js', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');

test('v31 is the active Worker and keeps v30 as the base', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/demo-worker-v31-order-create-safe\.js"/);
  assert.match(worker, /from '\.\/demo-worker-v30-contact-links\.js'/);
});

test('discounted multipart order creation is intercepted before legacy benefit rewrite', () => {
  assert.match(worker, /url\.pathname === '\/api\/demo-order'/);
  assert.match(worker, /contentType\.includes\('multipart\/form-data'\)/);
  assert.match(worker, /selected_percent/);
  assert.match(worker, /handleDiscountedMultipartOrder/);
});

test('the incoming order multipart is parsed only once in v31', () => {
  const incomingFormReads = worker.match(/request\.formData\(\)/g) || [];
  const clonedFormReads = worker.match(/request\.clone\(\)\.formData\(\)/g) || [];
  assert.equal(incomingFormReads.length, 1);
  assert.equal(clonedFormReads.length, 0);
});

test('v31 preserves discounts, photos, storage and useful error responses', () => {
  assert.match(worker, /withDiscount\(rawOrder, benefits\)/);
  assert.match(worker, /uploadPhotoSet/);
  assert.match(worker, /appPutOrder/);
  assert.match(worker, /discount_type === 'referral_reward'/);
  assert.match(worker, /Не удалось оформить заявку:/);
});
