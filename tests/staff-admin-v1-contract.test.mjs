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
const wrangler = read('wrangler.jsonc');

test('client booking remains on the proven v2 path', () => {
  assert.match(index, /app-release-v3\.js\?v=36/);
  assert.match(entry, /else\s*\{\s*import\('\.\/app-release-v2\.js\?v=35'\)/s);
  assert.doesNotMatch(index, /staff\/staff\.css/);
  assert.doesNotMatch(index, /staff\/app\.js/);
});

test('legacy admin and employee onboarding remain intact', () => {
  assert.match(admin, /let section = 'staff'/);
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
  assert.match(staffSystem, /isAdmin\(env, user\.id\)/);
  assert.match(staffSystem, /assigned_staff_ids/);
  assert.match(staffSystem, /assigned_staff_names/);
  assert.match(staffSystem, /training_complete/);
  assert.match(staffSystem, /staff_progress/);
  assert.match(staffSystem, /activity_log/);
  assert.match(staffSystem, /required_before/);
  assert.match(staffSystem, /required_after/);
  assert.match(staffSystem, /Нельзя завершить уборку/);
});

test('v41 wrapper preserves the entire previous worker chain', () => {
  assert.match(wrangler, /src\/demo-worker-v41-house-cleaning-staff\.js/);
  assert.match(worker41, /demo-worker-v40-admin-diagnostic\.js/);
  assert.match(worker40, /demo-worker-v39-admin-menu\.js/);
  assert.match(worker39, /demo-worker-v38-staff\.js/);
  assert.match(worker38, /demo-worker-v37-booking-resilience\.js/);
  assert.match(worker41, /'\/admin','\/staff'/);
  assert.match(worker41, /staffAppUrl\(origin\)/);
});
