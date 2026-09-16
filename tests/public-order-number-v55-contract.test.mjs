import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const worker = read('src/production-public-order.js');
const bridge = read('public/js/public-order-number-v55.js');
const wrangler = read('wrangler.jsonc');
const clientIndex = read('public/index.html');
const staffIndex = read('public/staff/index.html');

test('stable public order number is owned by the server', () => {
  assert.match(wrangler, /src\/production-public-order\.js/);
  assert.match(worker, /PUBLIC_SEQUENCE_KEY/);
  assert.match(worker, /public_order_number/);
  assert.match(worker, /display_number/);
  assert.match(worker, /storage\.transaction/);
  assert.match(worker, /!order\?\.is_test/);
  assert.match(worker, /sort\(\(a, b\) => String\(a\.created_at/);
});

test('client, admin and staff use the same visible number bridge', () => {
  assert.match(clientIndex, /public-order-number-v55\.js\?v=55/);
  assert.match(staffIndex, /public-order-number-v55\.js\?v=55/);
  assert.match(bridge, /public_order_number \|\| value\.display_number/);
  assert.match(bridge, /#\$\{String\(number\)\.padStart\(3, '0'\)\}/);
  assert.match(bridge, /MutationObserver/);
});
