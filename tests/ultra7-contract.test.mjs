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
const botBranding = read('src/demo-worker-v22-bot-branding.js');
const adminMenuWorker = read('src/demo-worker-v39-admin-menu.js');
const clientExperience = read('public/js/client-experience-v53.js');

test('Ultra 7 shell loads one design layer and three selectable themes', () => {
  assert.match(index, /house-cleaning-release" content="63/);
  assert.match(index, /ultra7\.css\?v=63/);
  assert.match(index, /ultra7-theme\.js\?v=61/);
  assert.doesNotMatch(index, /referral-v2\.css/);
  for (const id of ['light','dark','blue']) assert.match(theme, new RegExp(`['"]${id}['"]`));
  assert.match(theme, /hc-ultra7-theme-/);
  assert.match(theme, /setHeaderColor/);
  assert.match(css, /\.bottom-nav\{[\s\S]*height:50px!important/);
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

test('customer dashboard is ready for current orders, repeat booking and imported cleaning schedules', () => {
  assert.match(home, /subscriptionState/);
  assert.match(home, /cleanings_remaining/);
  assert.match(home, /ВАШ ПРОГРЕСС/);
  assert.match(home, /subscription-promo-v60\.svg/);
  assert.match(home, /Последняя/);
  assert.match(home, /Следующая/);
  assert.match(home, /Повторить последнюю уборку/);
  assert.match(home, /async function repeatOrder/);
  assert.match(home, /visitType:'repeat'/);
  assert.match(home, /step:6/);
  assert.doesNotMatch(home, /data-my-profile/);
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


test('bot start and admin menus expose the same two actions without duplicate start cards', () => {
  assert.match(botBranding, /Открыть HOUSE CLEANING/);
  assert.match(botBranding, /Панель администратора/);
  assert.match(botBranding, /const rows = \[\[/);
  assert.doesNotMatch(adminMenuWorker, /\['\/admin', '\/start', '\/menu'\]/);
  assert.match(adminMenuWorker, /command === '\/admin'/);
  assert.match(adminMenuWorker, /Открыть HOUSE CLEANING/);
  assert.match(adminMenuWorker, /Панель администратора/);
  assert.match(adminMenuWorker, /Выберите нужный раздел/);
  assert.doesNotMatch(adminMenuWorker, /HOUSE CLEANING · Администратор/);
});

test('theme bridge replaces legacy dark hardcodes with readable theme variables', () => {
  assert.match(css, /--cc-text:var\(--u7-text\)/);
  assert.match(css, /hc-order-card-v54[\s\S]*background:var\(--u7-surface\)!important/);
  assert.match(css, /hc-home-order-card-v54[\s\S]*color:var\(--u7-text\)!important/);
  assert.match(css, /bottom-nav \.nav-item\.active[\s\S]*var\(--u7-accent\)/);
  assert.match(css, /u7-home-hero/);
  assert.match(css, /u7-next-cleaning/);
});

test('client utilities include repeat booking and one-tap order details copy', () => {
  assert.match(home, /Повторить последнюю уборку/);
  assert.match(home, /async function repeatOrder/);
  assert.match(orders, /Скопировать детали/);
  assert.match(orders, /navigator\.clipboard\?\.writeText/);
  assert.match(orders, /Детали заявки скопированы/);
});


test('handwritten screens 01–04 remove clutter, hide empty service blocks and use new readable orders cards', () => {
  assert.doesNotMatch(home, /u7-home-actions/);
  assert.doesNotMatch(home, /Последние заявки/);
  assert.match(home, /function smartSection/);
  assert.match(home, /if \(!order\) return ''/);
  assert.match(home, /if \(subscriptionState\(\)\.active\) return ''/);
  assert.match(home, /if \(!upcoming\.length\) return ''/);
  assert.match(home, /u7-home-primary/);
  assert.match(orders, /u7-orders-hero/);
  assert.match(orders, /u7-order-card-v3/);
  assert.match(orders, /u7-order-inline-meta/);
  assert.match(css, /Ultra 7\.2 — handwritten client review/);
  assert.match(css, /HOUSE CLEANING CLIENT 60/);
  assert.match(css, /u7-order-status\.progress/);
  assert.match(css, /u7-home-primary[\s\S]*min-height:56px!important/);
});

test('client v60 keeps unfinished booking on home and updates schedule without full rerender', () => {
  const booking = read('public/js/views/booking-v2.js');
  assert.match(app, /const initialRoute = adminMode \? 'admin' : 'home'/);
  assert.match(home, /data-resume-order/);
  assert.match(booking, /function updateScheduleControls/);
  assert.match(booking, /selectScheduleDate/);
  assert.match(booking, /state\.draft\.time = button\.dataset\.time/);
  assert.doesNotMatch(booking, /data-time[^\n]+renderSchedule\(root, navigate\)/);
});

test('telegram reminders support animated custom emoji with safe fallback', () => {
  assert.match(automation, /function animatedEmoji/);
  assert.match(automation, /HC_EMOJI_REMINDER_ID/);
  assert.match(automation, /<tg-emoji emoji-id=/);
});


test('client release 61 removes late mutation layers that caused page jumps', () => {
  assert.doesNotMatch(index, /sticky-back-v1\.js/);
  assert.doesNotMatch(index, /release-layout-v2\.js/);
  assert.doesNotMatch(index, /\/js\/ux-v3\.js/);
  assert.doesNotMatch(index, /\/js\/ux-v4\.js/);
  assert.doesNotMatch(index, /\/js\/ux-v5\.js/);
  assert.doesNotMatch(index, /home-subscription-v2\.js/);
  assert.doesNotMatch(app, /new MutationObserver\(/);
  assert.doesNotMatch(clientExperience, /new MutationObserver\(/);
  assert.match(app, /hc:route-rendered/);
  assert.match(read('public/js/views/booking-v5.js'), /hc:booking-rendered/);
  assert.match(read('public/js/views/booking-v2.js'), /hc:booking-rendered/);
});

test('release 61 themes own booking borders controls and back button colors', () => {
  assert.match(css, /HOUSE CLEANING CLIENT 61/);
  assert.match(css, /--hc-control-line/);
  assert.match(css, /\.cc-back,.hc-fixed-back,.hc-booking-back/);
  assert.match(css, /\.calendar-day\.selected/);
  assert.match(css, /\.slot\.selected/);
  assert.match(css, /\.wizard-actions/);
  assert.match(css, /\.toast\.error/);
});

test('release 61 schedule caches availability and ignores stale date responses', () => {
  const booking = read('public/js/views/booking-v2.js');
  assert.match(booking, /availabilityCache = new Map/);
  assert.match(booking, /availabilityPending = new Map/);
  assert.match(booking, /scheduleSelectionVersion/);
  assert.match(booking, /version !== scheduleSelectionVersion/);
  assert.match(booking, /getAvailability\(date\)/);
});

test('release 61 keeps visible orders stable during background refresh', () => {
  assert.match(orders, /ordersRefreshReady/);
  assert.doesNotMatch(orders, /if \(!cached \|\| oldKey !== newKey\) renderList/);
});

test('release 61 uses standard emoji on newly refreshed Telegram surfaces', () => {
  const orderWorker = read('src/demo-worker-v31-order-create-safe.js');
  assert.doesNotMatch(automation, /HC_EMOJI_CALENDAR_ID|HC_EMOJI_CLEAN_ID|HC_EMOJI_LOCATION_ID/);
  assert.doesNotMatch(reviewWorker, /HC_EMOJI_REVIEW_ID/);
  assert.doesNotMatch(orderWorker, /HC_EMOJI_NEW_ID/);
  assert.doesNotMatch(botBranding, /HC_EMOJI_HOME_ID|HC_EMOJI_SPARK_ID/);
  assert.match(automation, /📅/);
  assert.match(automation, /🧹/);
  assert.match(automation, /📍/);
  assert.match(reviewWorker, /⭐ <b>Оцените уборку/);
  assert.match(orderWorker, /🆕 <b>Заявка оформлена/);
  assert.match(botBranding, /🏠 <b>HOUSE CLEANING/);
});


test('release 63 unifies the home booking action and keeps navigation feedback at the top', () => {
  assert.match(home, /function homeOrderAction/);
  assert.match(home, /u7-home-draft-v63/);
  assert.match(home, /Новый заказ/);
  assert.doesNotMatch(home, /function resumeCard/);
  assert.doesNotMatch(home, /Начать заново/);
  assert.match(css, /HOUSE CLEANING CLIENT 63/);
  assert.match(css, /position:fixed!important;[\s\S]*top:calc\(env\(safe-area-inset-top/);
  assert.match(css, /body\.client-concierge:has\(\.hc-fixed-back\) #app/);
  assert.match(css, /body\.client-concierge \.toast\{[\s\S]*top:calc\(env\(safe-area-inset-top/);
  assert.match(css, /body\.client-concierge \.modal-backdrop\{[\s\S]*place-items:start center/);
});
