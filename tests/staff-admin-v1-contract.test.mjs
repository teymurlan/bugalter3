import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const index = read('public/index.html');
const entry = read('public/js/app-release-v3.js');
const admin = read('public/js/views/admin-v6.js');
const polish = read('public/js/admin-v6-polish.js');
const staff = read('public/js/views/staff-v1.js');
const worker38 = read('src/demo-worker-v38-staff.js');
const worker39 = read('src/demo-worker-v39-admin-menu.js');
const wrangler = read('wrangler.jsonc');

test('client booking remains on the proven v2 path', () => {
  assert.match(index, /app-release-v3\.js\?v=36/);
  assert.match(entry, /else\s*\{\s*import\('\.\/app-release-v2\.js\?v=35'\)/s);
  assert.doesNotMatch(index, /admin-mobile-v1\.css/);
  assert.doesNotMatch(index, /staff-v1\.css/);
  assert.match(entry, /ensureStyle\('hc-admin-mobile-style'/);
});

test('admin has employee-first navigation and combined contact action', () => {
  assert.match(admin, /let section = 'staff'/);
  assert.match(admin, /Главная.*Заявки.*Сотрудники.*Ещё/s);
  assert.match(admin, /Связаться/);
  assert.match(admin, /data-contact-staff/);
  assert.match(admin, /data-contact-order/);
  assert.match(admin, /\/api\/admin-assign-staff/);
  assert.match(admin, /\/api\/admin-reschedule-order/);
  assert.match(polish, /data-staff-search/);
  assert.match(polish, /selectionChanged/);
});

test('new employees must finish regulation, lessons and 80 percent quiz before work', () => {
  for (const id of ['rules','general','safety','chemistry','photos','client']) assert.match(staff, new RegExp(`'${id}'`));
  assert.match(staff, /минимум 80%/);
  assert.match(staff, /Шпаргалка/);
  assert.match(staff, /accept_regulations/);
  assert.match(staff, /action:'quiz'/);
  assert.match(staff, /action:'finish'/);
  assert.match(worker38, /if\(!tr\?\.completed\)return json\(\{ok:false,error:'Нельзя назначить сотрудника: обучение ещё не завершено\.'/);
  assert.match(worker38, /Number\(t\.quiz_score\|\|0\)>=80/);
  assert.match(worker38, /new Set\(t\.lessons_done\|\|\[\]\)\.size>=LESSON_IDS\.length/);
});

test('staff storage and notifications remain in v38 behind the admin menu wrapper', () => {
  assert.match(wrangler, /src\/demo-worker-v39-admin-menu\.js/);
  assert.match(worker39, /demo-worker-v38-staff\.js/);
  assert.match(worker38, /demo-worker-v37-booking-resilience\.js/);
  assert.match(worker38, /\/api\/admin-staff/);
  assert.match(worker38, /\/api\/staff-me/);
  assert.match(worker38, /\/api\/staff-training/);
  assert.match(worker38, /Новый заказ назначен/);
  assert.match(worker38, /Время уборки изменено/);
});

test('admin-only Telegram entry configures native menu and slash command', () => {
  assert.match(worker39, /\/telegram\/webhook/);
  assert.match(worker39, /webhookSecretValid/);
  assert.match(worker39, /isAdminId/);
  assert.match(worker39, /'\/admin'/);
  assert.match(worker39, /setChatMenuButton/);
  assert.match(worker39, /Админ-панель/);
  assert.match(worker39, /\?admin=1/);
  assert.match(worker39, /demo-worker-v38-staff\.js/);
});
