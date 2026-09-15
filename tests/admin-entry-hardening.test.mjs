import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/demo-worker-v40-admin-diagnostic.js','utf8');

test('admin entry does not depend on webhook secret and accepts existing KP admin ids', () => {
  assert.doesNotMatch(worker, /webhookAllowed\(/);
  assert.match(worker, /KP_ADMIN_TELEGRAM_IDS/);
  assert.match(worker, /KP_ADMIN_TELEGRAM_ID/);
  assert.match(worker, /command === '\/admin'/);
  assert.match(worker, /\?demo=1&admin=1/);
});
