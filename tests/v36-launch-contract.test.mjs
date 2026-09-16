import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const wrangler = read('wrangler.jsonc');
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
const clientUi = read('public/client-ui-v53.css');
const bookingV5 = read('public/js/views/booking-v5.js');
const bookingBase = read('public/js/views/booking-v2.js');
const index = read('public/index.html');

test('release 53 wraps shared booking worker while production chain stays intact', () => {
  assert.match(wrangler, /"main"\s*:\s*"src\/demo-worker-v53-client-experience\.js"/);
  assert.match(worker53, /demo-worker-v50-shared-booking\.js/);
  assert.match(worker50, /client-defect-rpc\.js/);
  assert.match(defectRpc, /demo-worker-v44-production\.js/);
  assert.match(worker44, /demo-worker-v43-cache-bust\.js/);
  assert.match(worker44, /\/api\/release-version/);
  assert.match(worker44, /isKpPath/);
  assert.match(worker43, /demo-worker-v42-launch-hardening\.js/);
  assert.match(worker42, /MIN_BOOKING_LEAD_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(worker29, /Напоминание об уборке/);
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

test('release 53 stops date jumping and resumes abandoned booking after ten seconds', () => {
  assert.match(clientExperience, /RESUME_AFTER_MS = 10_000/);
  assert.match(clientExperience, /hc-booking-left-at-v53/);
  assert.match(clientExperience, /__HC_RESUME_DRAFT_V53/);
  assert.match(clientExperience, /Продолжить оформление/);
  assert.match(clientExperience, /location\.reload\(\)/);
  assert.match(clientExperience, /calendar-day\.selected/);
  assert.match(clientExperience, /Element\.prototype\.scrollIntoView/);
  assert.match(clientExperience, /data-calendar/);
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
  assert.match(clientExperience, /hc-order-origin-v53/);
  assert.match(clientExperience, /saveOrigin\('orders'\)/);
  assert.match(clientExperience, /saveOrigin\('home'\)/);
  assert.match(clientExperience, /queueScrollRestore/);
  assert.match(clientExperience, /cc-detail-head/);
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

test('release 53 uses fresh client entry and UI cache keys', () => {
  assert.match(index, /house-cleaning-release" content="53/);
  assert.match(index, /client-ui-v53\.css\?v=53/);
  assert.match(index, /app-release-v3\.js\?v=53/);
  assert.match(specialEntry, /client-experience-v53\.js\?v=53/);
  assert.match(specialEntry, /app-release-v2\.js\?v=53/);
  assert.match(entry, /api-release-v2\.js\?v=53/);
  assert.match(entry, /api-shared-v50\.js\?v=53/);
  assert.match(entry, /state-release-v2\.js\?v=53/);
  assert.match(entry, /app-release\.js\?v=53/);
  assert.match(app, /booking-v5\.js\?v=52/);
  assert.match(bookingV5, /booking-v2\.js\?v=52/);
  assert.match(clientUi, /hc-resume-card-v53/);
  assert.match(clientUi, /height:64px!important/);
});
