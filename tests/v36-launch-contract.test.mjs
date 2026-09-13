import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const wrangler = read('wrangler.jsonc');
const worker36 = read('src/demo-worker-v36-release.js');
const worker35 = read('src/demo-worker-v35-bundled-orders.js');
const worker34 = read('src/demo-worker-v34-launch.js');
const worker33 = read('src/demo-worker-v33-raw-order-photos.js');
const worker29 = read('src/demo-worker-v29-automation.js');
const api = read('public/js/api.js');
const state = read('public/js/state.js');
const app = read('public/js/app-release.js');
const booking = read('public/js/views/booking-v3.js');
const profile = read('public/js/views/concierge-profile-v4.js');
const reviews = read('public/js/reviews-v2.js');
const admin = read('public/js/views/admin-v5.js');
const index = read('public/index.html');
const css = read('public/release-v1.css');

test('v36 release worker is active and preserves reminder chain', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/demo-worker-v36-release\.js"/);
  assert.match(wrangler, /"crons"\s*:\s*\["\*\/10 \* \* \* \*"\]/);
  assert.match(worker36, /demo-worker-v35-bundled-orders\.js/);
  assert.match(worker35, /demo-worker-v34-launch\.js/);
  assert.match(worker34, /demo-worker-v33-raw-order-photos\.js/);
  assert.match(worker29, /Напоминание об уборке/);
});

test('D1 launch layer is optional and mirrors structured data with health check', () => {
  assert.match(worker34, /findD1/);
  assert.match(worker34, /typeof value\.prepare === 'function'/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_orders/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_clients/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_reviews/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_referrals/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_drafts/);
  assert.match(worker34, /\/api\/admin-system-health/);
});

test('prelaunch orders are isolated as tests and admin can create dedicated test orders', () => {
  assert.match(worker34, /release:v1:initialized/);
  assert.match(worker34, /prelaunch_test: true/);
  assert.match(worker34, /\/api\/admin-create-test-order/);
  assert.match(worker34, /is_test: true/);
  assert.match(api, /hc-demo-orders-v3/);
  assert.match(admin, /Тестовая заявка/);
});

test('order photos are delivered as one bundled album and not one client request per photo', () => {
  assert.match(api, /\/api\/demo-order-media/);
  assert.match(api, /X-HC-Photo-Bundle/);
  assert.doesNotMatch(api, /\/api\/demo-order-photo\?order=/);
  assert.match(worker34, /sendAlbumRaw/);
  assert.match(worker34, /sendMediaGroup/);
  assert.match(worker35, /X-HC-Photo-Bundle/);
});

test('reviews use JSON transport, combined photo album and numeric ratings', () => {
  assert.match(reviews, /\/api\/demo-review-v2/);
  assert.match(reviews, /data-review-score/);
  assert.match(reviews, /toFixed\(1\)/);
  assert.match(worker34, /reviewCaption/);
  assert.match(worker34, /sendAlbumRaw/);
  assert.match(profile, /\/api\/public-reviews/);
  assert.match(profile, /Сначала новые/);
});

test('new address requires photos and completed known address may skip them', () => {
  assert.match(booking, /order\?\.status === 'COMPLETED'/);
  assert.match(booking, /sameAddress/);
  assert.match(booking, /photoRequired = !known/);
  assert.match(booking, /Для нового адреса добавьте минимум одно фото/);
});

test('draft resumes from server and app reopens booking at saved step', () => {
  assert.match(state, /\/api\/client-draft/);
  assert.match(state, /hydrateRemoteDraft/);
  assert.match(app, /state\.hydrateRemoteDraft\(\)/);
  assert.match(app, /Number\(state\.draft\?\.step \|\| 0\) > 0 \? 'booking' : 'home'/);
});

test('profile hides loyalty levels, exposes reviews/subscriptions and referral link is last in share text', () => {
  assert.doesNotMatch(profile, /Программа лояльности/);
  assert.match(profile, /menuRow\('reviews'/);
  assert.match(profile, /Абонементы/);
  assert.match(profile, /'', link\]\.join/);
  assert.doesNotMatch(profile, /Позвонить/);
});

test('client navigation uses one active outline and phone actions are hidden globally', () => {
  assert.doesNotMatch(index, /nav-active-indicator/);
  assert.match(css, /\[data-call\]\{display:none!important\}/);
  assert.match(css, /bottom-nav \.nav-item\.active/);
});

test('release bundle is the one loaded by index', () => {
  assert.match(index, /app-release\.js\?v=34/);
  assert.match(index, /reviews-v2\.js\?v=34/);
  assert.match(index, /release-v1\.css\?v=34/);
  assert.doesNotMatch(index, /<script[^>]+app\.js\?v=/);
  assert.doesNotMatch(index, /reviews-v1\.js\?v=/);
});
