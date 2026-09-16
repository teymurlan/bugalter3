import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const wrangler = read('wrangler.jsonc');
const worker44 = read('src/demo-worker-v44-production.js');
const worker43 = read('src/demo-worker-v43-cache-bust.js');
const worker42 = read('src/demo-worker-v42-launch-hardening.js');
const worker41 = read('src/demo-worker-v41-house-cleaning-staff.js');
const worker40 = read('src/demo-worker-v40-admin-diagnostic.js');
const worker39 = read('src/demo-worker-v39-admin-menu.js');
const worker38 = read('src/demo-worker-v38-staff.js');
const worker37 = read('src/demo-worker-v37-booking-resilience.js');
const worker36 = read('src/demo-worker-v36-release.js');
const worker35 = read('src/demo-worker-v35-bundled-orders.js');
const worker34 = read('src/demo-worker-v34-launch.js');
const worker33 = read('src/demo-worker-v33-raw-order-photos.js');
const worker29 = read('src/demo-worker-v29-automation.js');
const api = read('public/js/api.js');
const releaseApi = read('public/js/api-release-v2.js');
const launchHardening = read('public/js/launch-hardening-v37.js');
const state = read('public/js/state.js');
const app = read('public/js/app-release.js');
const entry = read('public/js/app-release-v2.js');
const specialEntry = read('public/js/app-release-v3.js');
const booking = read('public/js/views/booking-v3.js');
const bookingBase = read('public/js/views/booking-v2.js');
const ui47 = read('public/js/ui-polish-v47.js');
const profile = read('public/js/views/concierge-profile-v4.js');
const reviews = read('public/js/reviews-v2.js');
const admin = read('public/js/views/admin-v5.js');
const index = read('public/index.html');
const css = read('public/release-v1.css');
const css2 = read('public/release-v2.css');
const css3 = read('public/release-v3.css');
const banner = read('public/js/home-subscription-v2.js');

test('v44 production gate is active and preserves the full client release chain', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/demo-worker-v44-production\.js"/);
  assert.match(wrangler, /"crons"\s*:\s*\["\*\/10 \* \* \* \*"\]/);
  assert.match(worker44, /demo-worker-v43-cache-bust\.js/);
  assert.match(worker44, /\/api\/release-version/);
  assert.match(worker44, /RELEASE = '44'/);
  assert.match(worker44, /isKpPath/);
  assert.match(worker44, /kp_disabled/);
  assert.match(worker43, /demo-worker-v42-launch-hardening\.js/);
  assert.match(worker42, /demo-worker-v41-house-cleaning-staff\.js/);
  assert.match(worker41, /demo-worker-v40-admin-diagnostic\.js/);
  assert.match(worker40, /demo-worker-v39-admin-menu\.js/);
  assert.match(worker39, /demo-worker-v38-staff\.js/);
  assert.match(worker38, /demo-worker-v37-booking-resilience\.js/);
  assert.match(worker37, /demo-worker-v36-release\.js/);
  assert.match(worker36, /demo-worker-v35-bundled-orders\.js/);
  assert.match(worker35, /demo-worker-v34-launch\.js/);
  assert.match(worker34, /demo-worker-v33-raw-order-photos\.js/);
  assert.match(worker29, /Напоминание об уборке/);
});

test('launch hardening enforces lead time and completed status persistence', () => {
  assert.match(worker42, /MIN_BOOKING_LEAD_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(worker42, /\/api\/demo-order-status/);
  assert.match(worker42, /ensureCompleted/);
  assert.match(worker42, /reconcileCompletedFromMirror/);
  assert.match(launchHardening, /MIN_LEAD_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(booking, /MIN_BOOKING_LEAD_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(booking, /bookingTimeAllowed/);
});

test('D1 launch layer remains optional and mirrors structured data with health check', () => {
  assert.match(worker34, /findD1/);
  assert.match(worker34, /typeof value\.prepare === 'function'/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_orders/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_clients/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_reviews/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_referrals/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_drafts/);
  assert.match(worker34, /\/api\/admin-system-health/);
});

test('prelaunch orders stay isolated as tests', () => {
  assert.match(worker34, /release:v1:initialized/);
  assert.match(worker34, /prelaunch_test: true/);
  assert.match(worker34, /\/api\/admin-create-test-order/);
  assert.match(worker34, /is_test: true/);
  assert.match(api, /hc-demo-orders-v3/);
  assert.match(admin, /Тестовая заявка/);
});

test('photo orders still use one album and failed photo delivery cannot invalidate a saved booking', () => {
  assert.match(releaseApi, /\/api\/demo-order-media-async/);
  assert.match(releaseApi, /X-HC-Photo-Bundle/);
  assert.match(releaseApi, /bookingCreated: true/);
  assert.match(worker42, /\/api\/demo-order-media-async/);
  assert.match(worker42, /waitUntil/);
  assert.match(worker34, /sendAlbumRaw/);
  assert.match(worker34, /sendMediaGroup/);
  assert.match(worker35, /X-HC-Photo-Bundle/);
  assert.match(worker37, /fallback notification used/);
  assert.match(worker37, /photoNotified: false/);
});

test('reviews keep JSON transport, combined photo album and numeric ratings', () => {
  assert.match(reviews, /\/api\/demo-review-v2/);
  assert.match(reviews, /data-review-score/);
  assert.match(reviews, /toFixed\(1\)/);
  assert.match(worker34, /reviewCaption/);
  assert.match(worker34, /sendAlbumRaw/);
  assert.match(profile, /\/api\/public-reviews/);
  assert.match(profile, /Сначала новые/);
});

test('repeat address is checked before photos and may skip photo upload', () => {
  assert.match(bookingBase, /'Дополнительно', 'Адрес', 'Фото', 'Дата'/);
  assert.match(bookingBase, /draft\.step === 4\) return renderAddress/);
  assert.match(bookingBase, /draft\.step === 5\) return renderPhotos/);
  assert.match(bookingBase, /state\.draft\.photoRequired === false/);
  assert.match(bookingBase, /!state\.photos\.length && d\.photoRequired !== false/);
  assert.match(booking, /Boolean\(order\?\.order_number\) && sameAddress/);
  assert.match(booking, /if \(step === 4\) decorateAddressStep/);
  assert.match(booking, /if \(step === 5\) void decoratePhotoStep/);
  assert.match(booking, /Мы уже обслуживали этот адрес и квартиру/);
});

test('draft resumes from server and app reopens booking at saved step', () => {
  assert.match(state, /\/api\/client-draft/);
  assert.match(state, /hydrateRemoteDraft/);
  assert.match(app, /state\.hydrateRemoteDraft\(\)/);
  assert.match(app, /Number\(state\.draft\?\.step \|\| 0\) > 0 \? 'booking' : 'home'/);
});

test('profile still hides loyalty levels and keeps reviews subscriptions and final referral link', () => {
  assert.doesNotMatch(profile, /Программа лояльности/);
  assert.match(profile, /menuRow\('reviews'/);
  assert.match(profile, /Абонементы/);
  assert.match(profile, /'', link\]\.join/);
  assert.doesNotMatch(profile, /Позвонить/);
});

test('client navigation and layout protections remain unchanged', () => {
  assert.doesNotMatch(index, /nav-active-indicator/);
  assert.match(css, /\[data-call\]\{display:none!important\}/);
  assert.match(css, /bottom-nav \.nav-item\.active/);
  assert.match(css2, /hc-review-flow #app/);
  assert.match(css2, /hc-subscription-banner-v2/);
  assert.match(css3, /calendar-strip/);
  assert.match(css3, /wizard-actions\{position:relative!important/);
  assert.match(banner, /hc-subscription-visual/);
  assert.match(banner, /cc-for-you-section/);
});

test('client router uses release 48 cache keys for the repeat-address flow', () => {
  assert.match(index, /house-cleaning-release" content="48/);
  assert.match(index, /app-release-v3\.js\?v=48/);
  assert.match(index, /ui-polish-v47\.js\?v=47/);
  assert.doesNotMatch(index, /launch-polish-v45/);
  assert.doesNotMatch(index, /repeat-address-date-v46/);
  assert.match(index, /launch-hardening-v37\.js\?v=44/);
  assert.match(specialEntry, /import\('\.\/app-release-v2\.js\?v=48'\)/);
  assert.match(specialEntry, /admin-v6\.js\?v=44/);
  assert.match(specialEntry, /staff-v1\.js\?v=44/);
  assert.match(index, /reviews-v2\.js\?v=44/);
  assert.match(index, /release-v2\.css\?v=44/);
  assert.match(index, /release-v3\.css\?v=44/);
  assert.match(index, /release-layout-v2\.js\?v=44/);
  assert.match(index, /home-subscription-v2\.js\?v=44/);
  assert.match(entry, /api-release-v2\.js\?v=44/);
  assert.match(entry, /state-release-v2\.js\?v=44/);
  assert.match(entry, /app-release\.js\?v=48/);
  assert.match(app, /booking-v3\.js\?v=48/);
  assert.match(booking, /booking-v2\.js\?v=48/);
  assert.match(ui47, /hc-date-shell-v47/);
  assert.doesNotMatch(index, /\/staff\/app\.js/);
});
