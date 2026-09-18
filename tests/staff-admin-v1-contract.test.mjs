import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const index = read('public/index.html');
const entry = read('public/js/app-release-v3.js');
const admin = read('public/js/views/admin-v6.js');
const polish = read('public/js/admin-v6-polish.js');
const staff = read('public/js/views/staff-v1.js');
const staffHtml = read('public/staff/index.html');
const staffCss = read('public/staff/staff.css');
const staffApp = read('public/staff/app.js');
const staffSystem = read('src/house-cleaning-staff.js');
const worker38 = read('src/demo-worker-v38-staff.js');
const worker39 = read('src/demo-worker-v39-admin-menu.js');
const worker40 = read('src/demo-worker-v40-admin-diagnostic.js');
const worker41 = read('src/demo-worker-v41-house-cleaning-staff.js');
const worker42 = read('src/demo-worker-v42-launch-hardening.js');
const worker43 = read('src/demo-worker-v43-cache-bust.js');
const worker44 = read('src/demo-worker-v44-production.js');
const defectRpc = read('src/client-defect-rpc.js');
const worker50 = read('src/demo-worker-v50-shared-booking.js');
const worker53 = read('src/demo-worker-v53-client-experience.js');
const publicOrderWorker = read('src/production-public-order.js');
const wrangler = read('wrangler.jsonc');

test('client booking stays isolated while the client bundle uses Ultra 7 cache keys', () => {
  assert.match(index, /app-release-v3\.js\?v=60/);
  assert.match(entry, /client-experience-v53\.js\?v=60/);
  assert.match(entry, /app-release-v2\.js\?v=60/);
  assert.doesNotMatch(index, /staff\/staff\.css/);
  assert.doesNotMatch(index, /staff\/app\.js/);
});

test('legacy employee onboarding remains intact', () => {
  assert.match(admin, /let section = 'home'/);
  assert.match(admin, /Клиенты и графики/);
  assert.match(admin, /Уведомления и рассылки/);
  assert.match(admin, /Связаться/);
  assert.match(polish, /data-staff-search/);
  for (const id of ['rules','general','safety','chemistry','photos','client']) assert.match(staff, new RegExp(`'${id}'`));
  assert.match(staff, /минимум 80%/);
  assert.match(staff, /Шпаргалка/);
  assert.match(worker38, /Нельзя назначить сотрудника: обучение ещё не завершено/);
});

test('HOUSE CLEANING STAFF is an isolated second Mini App', () => {
  assert.match(staffHtml, /HOUSE CLEANING STAFF/);
  assert.match(staffHtml, /\/staff\/staff\.css\?v=1/);
  assert.match(staffHtml, /\/staff\/app\.js\?v=1/);
  assert.match(staffHtml, /public-order-number-v55\.js\?v=55/);
  assert.match(staffCss, /--blue:#1476f2/);
  assert.match(staffCss, /--surface:#fff/);
  assert.match(staffCss, /safe-area-inset-bottom/);
  assert.match(staffApp, /\/api\/staff-v1\/session/);
  assert.match(staffApp, /\/api\/staff-v1\/admin\/bootstrap/);
  assert.match(staffApp, /\/api\/staff-v1\/admin\/assign/);
  assert.match(staffApp, /\/api\/staff-v1\/me\/bootstrap/);
  assert.match(staffApp, /Принять задание/);
  assert.match(staffApp, /Подтвердить выход/);
  assert.match(staffApp, /Начать уборку/);
  assert.match(staffApp, /Фото ДО/);
  assert.match(staffApp, /Фото ПОСЛЕ/);
});

test('server checks Telegram role and supports multi-employee assignment', () => {
  assert.match(staffSystem, /validateTelegramUser/);
  assert.match(staffSystem, /isFullAdmin\(env, user\.id\)/);
  assert.match(staffSystem, /assigned_staff_ids/);
  assert.match(staffSystem, /assigned_staff_names/);
  assert.match(staffSystem, /training_complete/);
  assert.match(staffSystem, /staff_progress/);
  assert.match(staffSystem, /activity_log/);
  assert.match(staffSystem, /required_before/);
  assert.match(staffSystem, /required_after/);
  assert.match(staffSystem, /Нельзя завершить уборку/);
  assert.match(staffSystem, /ADMIN_TELEGRAM_IDS,env\.ADMIN_TELEGRAM_ID,env\.ADMIN_ID/);
  assert.doesNotMatch(staffSystem, /KP_ADMIN_TELEGRAM_IDS/);
});

test('v44 gate and defect RPC remain intact through release 55 public number wrapper, release 53 and shared booking v50', () => {
  assert.match(wrangler, /src\/production-public-order\.js/);
  assert.match(publicOrderWorker, /demo-worker-v53-client-experience\.js/);
  assert.match(worker53, /demo-worker-v50-shared-booking\.js/);
  assert.match(worker50, /client-defect-rpc\.js/);
  assert.match(defectRpc, /demo-worker-v44-production\.js/);
  assert.match(worker44, /demo-worker-v43-cache-bust\.js/);
  assert.match(worker44, /command === '\/kp'/);
  assert.match(worker44, /isKpPath/);
  assert.doesNotMatch(worker44, /Коммерческие предложения/);
  assert.match(worker43, /demo-worker-v42-launch-hardening\.js/);
  assert.match(worker42, /demo-worker-v41-house-cleaning-staff\.js/);
  assert.match(worker41, /demo-worker-v40-admin-diagnostic\.js/);
  assert.match(worker40, /demo-worker-v39-admin-menu\.js/);
  assert.match(worker39, /demo-worker-v38-staff\.js/);
  assert.match(worker38, /demo-worker-v37-booking-resilience\.js/);
  assert.match(worker41, /command === '\/admin'/);
  assert.match(worker41, /command === '\/staff'/);
  assert.match(worker41, /isFullAdmin/);
  assert.match(worker41, /staffExists/);
  assert.match(worker41, /Полный доступ HOUSE CLEANING STAFF есть только у главного администратора/);
  assert.match(worker41, /staffAppUrl\(origin\)/);
});
