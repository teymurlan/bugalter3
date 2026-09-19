import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const wrangler = read('wrangler.jsonc');
const publicOrderWorker = read('src/production-public-order.js');
const worker53 = read('src/demo-worker-v53-client-experience.js');
const worker50 = read('src/demo-worker-v50-shared-booking.js');
const defectRpc = read('src/client-defect-rpc.js');
const worker44 = read('src/demo-worker-v44-production.js');
const worker43 = read('src/demo-worker-v43-cache-bust.js');
const worker42 = read('src/demo-worker-v42-launch-hardening.js');
const worker34 = read('src/demo-worker-v34-launch.js');
const worker29 = read('src/demo-worker-v29-automation.js');
const api = read('public/js/api.js');
const sharedApi = read('public/js/api-shared-v50.js');
const releaseApi = read('public/js/api-release-v2.js');
const launchHardening = read('public/js/launch-hardening-v37.js');
const launchReset = read('public/js/launch-reset-v45.js');
const state = read('public/js/state.js');
const app = read('public/js/app-release.js');
const entry = read('public/js/app-release-v2.js');
const specialEntry = read('public/js/app-release-v3.js');
const clientExperience = read('public/js/client-experience-v53.js');
const publicOrderBridge = read('public/js/public-order-number-v55.js');
const clientUi = read('public/client-ui-v53.css');
const clientOrders = read('public/js/views/concierge-orders-v4.js');
const clientHome = read('public/js/views/concierge-home-v4.js');
const bookingV5 = read('public/js/views/booking-v5.js');
const bookingBase = read('public/js/views/booking-v2.js');
const index = read('public/index.html');
const staffIndex = read('public/staff/index.html');

test('release 55 wraps release 53 with stable public order numbering while production chain stays intact', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/production-public-order\.js"/);
  assert.match(publicOrderWorker, /demo-worker-v53-client-experience\.js/);
  assert.match(worker53, /demo-worker-v50-shared-booking\.js/);
  assert.match(worker50, /client-defect-rpc\.js/);
  assert.match(defectRpc, /demo-worker-v44-production\.js/);
  assert.match(worker44, /demo-worker-v43-cache-bust\.js/);
  assert.match(worker44, /\/api\/release-version/);
  assert.match(worker44, /const RELEASE = '63'/);
  assert.match(worker44, /isKpPath/);
  assert.match(worker43, /demo-worker-v42-launch-hardening\.js/);
  assert.match(worker42, /MIN_BOOKING_LEAD_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(worker29, /Уборка уже завтра/);
  assert.match(worker29, /HC_EMOJI_REMINDER_ID/);
});

test('public order numbers are server-owned, sequential and do not count test orders', () => {
  assert.match(publicOrderWorker, /PUBLIC_SEQUENCE_KEY = 'system:public-order-sequence:v1'/);
  assert.match(publicOrderWorker, /constructor\(state, env\)/);
  assert.match(publicOrderWorker, /this\.hcState = state/);
  assert.match(publicOrderWorker, /public_order_number: number, display_number: number/);
  assert.match(publicOrderWorker, /filter\(\(order\) => !order\?\.is_test\)/);
  assert.match(publicOrderWorker, /this\.hcState\.storage\.transaction/);
  assert.match(publicOrderWorker, /nextPublicOrderNumber/);
  assert.match(publicOrderWorker, /ensurePublicOrderNumbers/);
  assert.match(publicOrderWorker, /created_at/);
  assert.match(publicOrderBridge, /public_order_number \|\| value\.display_number/);
  assert.match(publicOrderBridge, /labels\.set\(technical, formatNumber\(number\)\)/);
  assert.match(staffIndex, /public-order-number-v55\.js\?v=55/);
});

test('all devices still use shared server availability', () => {
  assert.match(sharedApi, /api\.availability = sharedAvailability/);
  assert.match(sharedApi, /\/api\/demo-availability/);
  assert.match(worker50, /source: 'server'/);
  assert.match(worker50, /ACTIVE_STATUSES/);
  assert.match(worker50, /На эту дату осталось только/);
});

test('first or repeat visit remains an explicit client choice after address', () => {
  assert.match(state, /visitType: ''/);
  assert.match(state, /visitTypeConfirmed: false/);
  assert.match(bookingV5, /Первый заказ/);
  assert.match(bookingV5, /Повторный заказ/);
  assert.match(bookingV5, /Фото объекта обязательно/);
  assert.match(bookingV5, /Сразу к дате и времени/);
  assert.match(bookingV5, /state\.draft\.step = repeat \? 6 : 5/);
  assert.match(bookingV5, /state\.draft\.photoRequired = !repeat/);
  assert.match(bookingV5, /renderVisitType/);
  assert.doesNotMatch(bookingV5, /sharedKnownAddress/);
  assert.doesNotMatch(entry, /photo-repeat-fix-v51/);
});

test('first visit requires photo while repeat visit skips photo screen', () => {
  assert.match(bookingBase, /const photosRequired = d\.photoRequired !== false/);
  assert.match(bookingBase, /nextDisabled: state\.photos\.length < 1 && photosRequired/);
  assert.match(bookingBase, /if \(!state\.photos\.length && d\.photoRequired !== false\)/);
  assert.match(bookingV5, /state\.draft\.visitType === 'repeat' && state\.draft\.visitTypeConfirmed/);
  assert.match(bookingV5, /state\.draft\.photoRequired = false/);
  assert.match(bookingV5, /state\.draft\.step = 6/);
  assert.match(bookingV5, /function patchScheduleStep/);
});

test('release 60 stops date jumping and keeps abandoned booking behind an explicit resume action', () => {
  assert.match(clientExperience, /RESUME_AFTER_MS = 0/);
  assert.match(clientExperience, /hc-booking-left-at-v53/);
  assert.match(clientExperience, /__HC_RESUME_DRAFT_V53/);
  assert.match(clientHome, /Продолжить оформление/);
  assert.match(clientHome, /data-resume-order/);
  assert.match(app, /const initialRoute = adminMode \? 'admin' : 'home'/);
  assert.match(bookingBase, /function updateScheduleControls/);
  assert.match(bookingBase, /selectScheduleDate/);
});

test('release 53 blocks more than 300 square metres before scheduling and offers manager contact', () => {
  assert.match(clientExperience, /Number\(input\.value \|\| state\.draft\?\.area \|\| 0\)/);
  assert.match(clientExperience, /area > 300/);
  assert.match(clientExperience, /Объект больше 300 м²/);
  assert.match(clientExperience, /Написать менеджеру/);
  assert.match(clientExperience, /next\.disabled = true/);
});

test('success stays inside Mini App and client booking chat message is suppressed', () => {
  assert.match(clientExperience, /Посмотреть мои заявки/);
  assert.match(clientExperience, /Вернуться на главную/);
  assert.match(clientExperience, /X-HC-Silent-Client/);
  assert.match(worker53, /X-HC-Silent-Client/);
  assert.match(worker53, /clientNotified: false/);
  assert.match(worker53, /notificationSuppressed: true/);
  assert.match(worker53, /adminNotified: deliveredAdmins\.length/);
});

test('order detail back remembers whether client came from home or orders', () => {
  assert.match(app, /const backStack = \[\]/);
  assert.match(app, /backStack\.push/);
  assert.match(app, /backStack\.pop/);
  assert.match(app, /restoreScroll/);
  assert.match(clientOrders, /params\.from === 'home'/);
  assert.match(clientOrders, /window\.HCNavigation\?\.back/);
});

test('release 59 applies handwritten home and orders revisions', () => {
  assert.match(clientOrders, /let currentFilter = 'active'/);
  assert.match(clientOrders, /function shortOrderNumber/);
  assert.match(clientOrders, /display_number/);
  assert.match(clientOrders, /Заказ \$\{escapeHtml\(shortOrderNumber\(order\)\)\}/);
  assert.match(clientOrders, /\['history'\s*,\s*'История'\]/);
  assert.match(clientOrders, /u7-order-card-v3/);
  assert.match(clientOrders, /<h1>Заказ \$\{escapeHtml\(shortOrderNumber\(order\)\)\}<\/h1>/);
  assert.doesNotMatch(clientHome, /Последние заявки/);
  assert.match(clientHome, /Повторить последнюю уборку/);
  assert.match(clientHome, /Ближайшие 7 дней/);
    assert.match(clientHome, /hc-home-order-card-v54/);
  assert.match(clientUi, /hc-order-card-v54/);
  assert.match(clientUi, /hc-home-order-card-v54/);
});

test('launch hardening keeps minimum six hour lead time', () => {
  assert.match(launchHardening, /MIN_LEAD_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(worker42, /ensureCompleted/);
  assert.match(worker42, /reconcileCompletedFromMirror/);
  assert.match(worker53, /MIN_BOOKING_LEAD_MS = 6 \* 60 \* 60 \* 1000/);
});

test('D1 launch mirror and prelaunch isolation remain available', () => {
  assert.match(worker34, /findD1/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_orders/);
  assert.match(worker34, /CREATE TABLE IF NOT EXISTS hc_clients/);
  assert.match(worker34, /\/api\/admin-system-health/);
  assert.match(worker34, /prelaunch_test: true/);
  assert.match(worker53, /CREATE TABLE IF NOT EXISTS hc_orders/);
  assert.match(api, /hc-demo-orders-v3/);
});

test('photo order delivery remains asynchronous after booking save', () => {
  assert.match(releaseApi, /\/api\/demo-order-media-async/);
  assert.match(releaseApi, /bookingCreated: true/);
  assert.match(worker42, /waitUntil/);
});

test('one-time clean launch no longer clears draft on every reopen', () => {
  assert.match(launchReset, /current === 'pending'/);
  assert.match(launchReset, /localStorage\.setItem\(KEY, GENERATION\)/);
  assert.doesNotMatch(launchReset, /localStorage\.setItem\(KEY, 'pending'\)/);
});

test('release 63 cache-busts the client home and navigation UX without invalidating production worker layers', () => {
  assert.match(index, /house-cleaning-release" content="63/);
  assert.match(index, /public-order-number-v55\.js\?v=55/);
  assert.match(index, /client-ui-v53\.css\?v=54/);
  assert.match(index, /app-release-v3\.js\?v=63/);
  assert.match(specialEntry, /client-experience-v53\.js\?v=63/);
  assert.match(specialEntry, /app-release-v2\.js\?v=63/);
  assert.match(entry, /api-release-v2\.js\?v=63/);
  assert.match(entry, /api-shared-v50\.js\?v=63/);
  assert.match(entry, /state-release-v2\.js\?v=63/);
  assert.match(entry, /app-release\.js\?v=63/);
  assert.match(app, /booking-v5\.js\?v=63/);
  assert.match(app, /concierge-home-v4\.js\?v=63/);
  assert.match(app, /concierge-orders-v4\.js\?v=63/);
  assert.match(bookingV5, /booking-v2\.js\?v=63/);
  assert.match(clientUi, /hc-resume-card-v53/);
  assert.match(clientUi, /height:64px!important/);
});
