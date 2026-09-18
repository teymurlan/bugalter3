import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const index = read('public/index.html');
const theme = read('public/js/ultra7-theme.js');
const css = read('public/ultra7.css');
const app = read('public/js/app-release.js');
const orders = read('public/js/views/concierge-orders-v4.js');
const profile = read('public/js/views/concierge-profile-v4.js');
const home = read('public/js/views/concierge-home-v4.js');
const homeBase = read('public/js/views/concierge-home-v2.js');
const admin = read('public/js/views/admin-v6.js');
const api = read('public/js/api.js');
const worker = read('src/production-public-order.js');
const automation = read('src/demo-worker-v29-automation.js');
const reviewWorker = read('src/demo-worker-v28-notifications.js');
const profileWorker = read('src/demo-worker-v27-client-profile.js');

test('Ultra 7 shell loads one design layer and three selectable themes', () => {
  assert.match(index, /house-cleaning-release" content="57/);
  assert.match(index, /ultra7\.css\?v=57/);
  assert.match(index, /ultra7-theme\.js\?v=57/);
  assert.doesNotMatch(index, /referral-v2\.css/);
  for (const id of ['light','dark','blue']) assert.match(theme, new RegExp(`['"]${id}['"]`));
  assert.match(theme, /hc-ultra7-theme-/);
  assert.match(theme, /setHeaderColor/);
  assert.match(css, /\.bottom-nav\{[\s\S]*height:54px!important/);
  assert.match(css, /\.hc-mobile-shell \.hc-m-nav\{[\s\S]*height:58px!important/);
});

test('client navigation returns to the exact previous screen and scroll position', () => {
  assert.match(app, /const backStack = \[\]/);
  assert.match(app, /function rememberCurrent/);
  assert.match(app, /function restoreScroll/);
  assert.match(app, /backStack\.push/);
  assert.match(app, /backStack\.pop/);
  assert.match(app, /window\.HCNavigation/);
  assert.match(app, /backStack\.length = 0/);
  assert.match(orders, /window\.HCNavigation\?\.back/);
  assert.match(orders, /params\.from === 'home'/);
});

test('referral product surface is disabled while customer settings are available', () => {
  assert.doesNotMatch(profile, /showReferral/);
  assert.doesNotMatch(profile, /data-menu="referral"/);
  assert.match(profile, /Уведомления/);
  assert.match(profile, /Внешний вид/);
  assert.match(profile, /\/api\/client-notification-settings/);
  assert.match(profile, /data-theme/);
  assert.match(worker, /Реферальная программа временно отключена/);
  assert.doesNotMatch(homeBase, /referral_percent/);
});

test('customer dashboard is ready for current orders and imported cleaning schedules', () => {
  assert.match(home, /Мои уборки/);
  assert.match(home, /cleanings_remaining/);
  assert.match(home, /Последняя/);
  assert.match(home, /Следующая уборка/);
  assert.match(profileWorker, /cleanings_total/);
  assert.match(profileWorker, /cleanings_remaining/);
  assert.match(profileWorker, /schedule_note/);
  assert.match(profileWorker, /last_cleaning_at/);
  assert.match(profileWorker, /next_cleaning_at/);
});

test('main admin gets customer schedules, notification controls and protected broadcasts', () => {
  assert.match(worker, /\/api\/admin-ultra7/);
  assert.match(worker, /\/api\/admin-ultra7\/settings/);
  assert.match(worker, /\/api\/admin-ultra7\/client-schedule/);
  assert.match(worker, /\/api\/admin-ultra7\/broadcast/);
  assert.match(worker, /\/api\/staff-v1\/session/);
  assert.match(worker, /data\?\.role === 'admin'/);
  assert.match(worker, /segment === 'subscription'/);
  assert.match(worker, /marketing !== false/);
  assert.match(admin, /Клиенты и графики/);
  assert.match(admin, /Уведомления и рассылки/);
  assert.match(admin, /data-broadcast-form/);
  assert.match(admin, /data-edit-client-schedule/);
  assert.match(admin, /data-admin-theme/);
  assert.match(admin, /modal\(\{/);
});

test('client notification switches affect actual Telegram delivery without breaking status changes', () => {
  assert.match(worker, /\/api\/client-notification-settings/);
  assert.match(worker, /notificationAllowed\(env, clientId, 'confirmed'\)/);
  assert.match(worker, /notificationSuppressed:true/);
  assert.match(api, /!data\?\.clientNotified && !data\?\.notificationSuppressed/);
  assert.match(automation, /ultraNotificationAllowed\(env, clientId, 'completed'\)/);
  assert.match(automation, /ultraNotificationAllowed\(env, clientId, 'review'\)/);
  assert.match(automation, /ultraNotificationAllowed\(env, clientId, 'reminder'\)/);
  assert.match(reviewWorker, /ultraNotificationAllowed\(env, clientId, 'review'\)/);
});
