import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const worker29 = read('src/demo-worker-v29-automation.js');
const worker30 = read('src/demo-worker-v30-contact-links.js');
const wrangler = read('wrangler.jsonc');
const app = read('public/js/app.js');
const index = read('public/index.html');
const admin = read('public/js/views/admin-v4.js');
const orders = read('public/js/views/concierge-orders-v4.js');
const profile = read('public/js/views/concierge-profile-v3.js');
const contacts = read('public/js/contact-links-v30.js');

test('v30 contact worker is active and preserves 24h cron', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/demo-worker-v30-contact-links\.js"/);
  assert.match(wrangler, /"crons"\s*:\s*\["\*\/10 \* \* \* \*"\]/);
  assert.match(worker30, /baseWorker\.scheduled/);
  assert.match(worker29, /reminder\/candidates/);
  assert.match(worker29, /Напоминание об уборке/);
});

test('completion message remains combined and has both actions without preliminary price', () => {
  const start = worker29.indexOf('async function sendCompletionMessage');
  const end = worker29.indexOf('async function completeReferral', start);
  assert.ok(start > -1 && end > start, 'completion message function must exist');
  const block = worker29.slice(start, end);
  assert.doesNotMatch(block, /Предварительная стоимость|Стоимость предварительная|estimated_price/);
  assert.match(block, /Открыть заявку/);
  assert.match(block, /Оставить отзыв/);
});

test('client and admin v29 screens remain active under v30 cache refresh', () => {
  assert.match(app, /concierge-home-v3\.js\?v=29/);
  assert.match(app, /concierge-orders-v4\.js\?v=29/);
  assert.match(app, /concierge-profile-v3\.js\?v=29/);
  assert.match(app, /admin-v4\.js\?v=29/);
  assert.match(index, /final-ui-v29\.css\?v=30/);
  assert.match(index, /benefits-v2\.js\?v=30/);
  assert.match(index, /contact-links-v30\.js\?v=30/);
  assert.match(index, /contact-links-v30\.css\?v=30/);
  assert.doesNotMatch(index, /<script[^>]+benefits-v1\.js/);
});

test('v30 contact layer uses native phone links and Telegram usernames with safe fallback', () => {
  assert.match(contacts, /`tel:\$\{directPhone\}`/);
  assert.match(contacts, /https:\/\/t\.me\/\$\{username\}/);
  assert.match(contacts, /openTelegramLink/);
  assert.match(contacts, /api\/contact-manager-fallback/);
  assert.match(contacts, /api\/admin-client-chat-fallback/);
  assert.match(worker30, /api\/admin-client-contact/);
  assert.match(worker30, /getChat/);
  assert.match(worker30, /Открыть чат с менеджером/);
  assert.match(worker30, /Открыть чат с клиентом/);
});

test('admin keeps required sorting, reporting and review filters', () => {
  assert.match(admin, /status === 'IN_PROGRESS' \? 0/);
  assert.match(admin, /status === 'COMPLETED' \? 4/);
  assert.match(admin, /\['week', '7 дней'\]/);
  assert.match(admin, /\['month', 'Месяц'\]/);
  assert.match(admin, /Сначала новые/);
  assert.match(admin, /Положительные/);
  assert.match(admin, /Негативные/);
  assert.match(admin, /📞 Позвонить/);
  assert.match(admin, /✉️ Написать/);
});

test('client completed orders hide estimate and sort completed last', () => {
  assert.match(orders, /order\.status !== 'COMPLETED' && price > 0/);
  assert.match(orders, /order\.status === 'COMPLETED' \? 4/);
  assert.match(orders, /order\.status === 'IN_PROGRESS' \? 0/);
});

test('referral flow still exposes stage tracking and selectable 15 percent reward', () => {
  assert.match(worker29, /ref\/stage/);
  assert.match(worker29, /ref\/reward-arm/);
  assert.match(worker29, /Вам начислена скидка 15%/);
  assert.match(profile, /Применить 15% к следующей уборке/);
  assert.match(profile, /Перешёл по ссылке/);
  assert.match(profile, /Принял условия/);
  assert.match(profile, /Уборка завершена/);
});
