import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const worker = read('src/demo-worker-v29-automation.js');
const wrangler = read('wrangler.jsonc');
const app = read('public/js/app.js');
const index = read('public/index.html');
const admin = read('public/js/views/admin-v4.js');
const orders = read('public/js/views/concierge-orders-v4.js');
const profile = read('public/js/views/concierge-profile-v3.js');

test('v29 worker and 24h cron are active', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/demo-worker-v29-automation\.js"/);
  assert.match(wrangler, /"crons"\s*:\s*\["\*\/10 \* \* \* \*"\]/);
  assert.match(worker, /async scheduled\(/);
  assert.match(worker, /reminder\/candidates/);
  assert.match(worker, /Напоминание об уборке/);
});

test('completion message is single-purpose and has both actions without preliminary price', () => {
  const start = worker.indexOf('async function sendCompletionMessage');
  const end = worker.indexOf('async function completeReferral', start);
  assert.ok(start > -1 && end > start, 'completion message function must exist');
  const block = worker.slice(start, end);
  assert.doesNotMatch(block, /Предварительная стоимость|Стоимость предварительная|estimated_price/);
  assert.match(block, /Открыть заявку/);
  assert.match(block, /Оставить отзыв/);
});

test('client and admin screens use v29 implementations', () => {
  assert.match(app, /concierge-home-v3\.js\?v=29/);
  assert.match(app, /concierge-orders-v4\.js\?v=29/);
  assert.match(app, /concierge-profile-v3\.js\?v=29/);
  assert.match(app, /admin-v4\.js\?v=29/);
  assert.match(index, /final-ui-v29\.css\?v=29/);
  assert.match(index, /benefits-v2\.js\?v=29/);
  assert.doesNotMatch(index, /<script[^>]+benefits-v1\.js/);
});

test('admin has required sorting, reporting, review filters and direct contacts', () => {
  assert.match(admin, /status === 'IN_PROGRESS' \? 0/);
  assert.match(admin, /status === 'COMPLETED' \? 4/);
  assert.match(admin, /\['week', '7 дней'\]/);
  assert.match(admin, /\['month', 'Месяц'\]/);
  assert.match(admin, /Сначала новые/);
  assert.match(admin, /Положительные/);
  assert.match(admin, /Негативные/);
  assert.match(admin, /tg:\/\/user\?id=/);
  assert.match(admin, /📞 Позвонить/);
  assert.match(admin, /✉️ Написать/);
});

test('client completed orders hide estimate and sort completed last', () => {
  assert.match(orders, /order\.status !== 'COMPLETED' && price > 0/);
  assert.match(orders, /order\.status === 'COMPLETED' \? 4/);
  assert.match(orders, /order\.status === 'IN_PROGRESS' \? 0/);
  assert.match(orders, /tg:\/\/user\?id=/);
});

test('referral flow exposes stage tracking and selectable 15 percent reward', () => {
  assert.match(worker, /ref\/stage/);
  assert.match(worker, /ref\/reward-arm/);
  assert.match(worker, /Вам начислена скидка 15%/);
  assert.match(profile, /Применить 15% к следующей уборке/);
  assert.match(profile, /Перешёл по ссылке/);
  assert.match(profile, /Принял условия/);
  assert.match(profile, /Уборка завершена/);
});
