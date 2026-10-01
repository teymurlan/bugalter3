import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const index = read('public/index.html');
const css = read('public/mobile-flow-v68.css');
const client = read('public/js/mobile-flow-v68.js');
const contacts = read('public/js/contact-links-v30.js');
const worker = read('src/production-start-fix.js');

test('release 68 safely neutralizes stale prelaunch reset without deleting live production data', () => {
  assert.match(worker, /PRELAUNCH_OWNER = 'production-runtime-v68'/);
  assert.match(worker, /neutralizePrelaunchReset/);
  assert.match(worker, /system\/prelaunch-reset-v66\/claim/);
  assert.match(worker, /system\/prelaunch-reset-v66\/finish/);
  assert.doesNotMatch(worker, /system\/prelaunch-reset-v66\/storage/);
  assert.match(worker, /d1_orders_deleted: 0/);
  assert.match(worker, /runtimeWorker\.fetch/);
  assert.match(worker, /X-HC-Runtime-Fallback/);
});

test('mobile booking content stays scrollable above fixed controls', () => {
  assert.match(index, /mobile-flow-v68\.css\?v=68/);
  assert.match(css, /booking-flow #app[\s\S]*padding-bottom:calc\(286px/);
  assert.match(css, /wizard-actions[\s\S]*bottom:calc\(62px/);
  assert.match(css, /scroll-margin-bottom:250px/);
});

test('narrow-phone unfinished order action no longer contains a clipped arrow', () => {
  assert.match(css, /u7-home-draft-resume-v66 b\{display:none!important\}/);
  assert.match(client, /resume\?\.querySelector\('b'\)\?\.remove\(\)/);
  assert.match(css, /u7-home-draft-actions-v66[\s\S]*grid-template-columns:1fr/);
});

test('manager action and order sharing are upgraded for mobile clients', () => {
  assert.match(css, /button\[data-manager\]/);
  assert.match(client, /Написать менеджеру/);
  assert.match(client, /navigator\.share/);
  assert.match(client, /Поделиться заявкой/);
  assert.match(client, /hc-share-order-v68/);
  assert.match(contacts, /function managerFallback/);
  assert.match(contacts, /contact-manager-fallback/);
  assert.doesNotMatch(contacts, /button\.onclick = \(\) => notify\(error\.message/);
});

test('calendar error fallback stays compact and gives the client a retry action', () => {
  assert.match(css, /hc-calendar-v2 \.calendar-strip>\.empty-inline/);
  assert.match(client, /Не удалось обновить расписание/);
  assert.match(client, /location\.reload\(\)/);
});
