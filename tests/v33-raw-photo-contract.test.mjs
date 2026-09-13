import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync('public/js/api.js', 'utf8');
const worker = fs.readFileSync('src/demo-worker-v33-raw-order-photos.js', 'utf8');
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');

test('order creation no longer uses multipart FormData', () => {
  const start = api.indexOf('async function notifyBackend');
  const end = api.indexOf('async function notifyStatus', start);
  assert.ok(start >= 0 && end > start);
  const block = api.slice(start, end);
  assert.doesNotMatch(block, /new FormData\(\)/);
  assert.match(block, /Content-Type': 'application\/json'/);
  assert.match(block, /\/api\/demo-order-photo/);
});

test('raw photo endpoint is present and binary', () => {
  assert.match(worker, /\/api\/demo-order-photo/);
  assert.match(worker, /request\.arrayBuffer\(\)/);
  assert.match(worker, /telegramMultipart/);
  assert.match(worker, /photo_file_ids/);
});

test('v33 is active above v32', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/demo-worker-v33-raw-order-photos\.js"/);
  assert.match(worker, /demo-worker-v32-multipart-boundary\.js/);
});
