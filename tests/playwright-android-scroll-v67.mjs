import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 700 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2.75,
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  locale: 'ru-RU',
  timezoneId: 'Europe/Moscow',
});

function day(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

const orders = Array.from({ length: 5 }, (_, index) => ({
  id: index + 1,
  order_number: `HC-ANDROID-${index + 1}`,
  display_number: index + 1,
  status: index === 4 ? 'COMPLETED' : 'CONFIRMED',
  service_id: 1,
  service_name: index % 2 ? 'Поддерживающая уборка' : 'Генеральная уборка',
  property_type: 'apartment',
  area: 55 + index,
  rooms: 2,
  bathrooms: 1,
  addon_ids: [],
  city: 'Санкт-Петербург',
  address: `Тестовая улица, ${index + 1}`,
  apartment: String(index + 10),
  date: day(index + 1),
  time: '12:00',
  customer_name: 'Android Client',
  phone: '+79990000000',
  estimated_price: 12000,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));

await context.addInitScript(() => {
  localStorage.setItem('hc-clean-start-generation', 'v66-final-launch');
  localStorage.removeItem('hc-booking-draft-v2');
});

await context.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
  status: 200,
  contentType: 'application/javascript; charset=utf-8',
  body: `
    window.__swipeCalls={enable:0,disable:0};
    window.Telegram={WebApp:{
      platform:'android',
      initData:'query_id=android-scroll',
      initDataUnsafe:{user:{id:670067,first_name:'Android'}},
      ready(){},expand(){},
      disableVerticalSwipes(){window.__swipeCalls.disable+=1},
      enableVerticalSwipes(){window.__swipeCalls.enable+=1},
      setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},
      onEvent(){},openTelegramLink(){},
      HapticFeedback:{selectionChanged(){},impactOccurred(){},notificationOccurred(){}}
    }};
  `,
}));

await context.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  const json = body => route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
  if (path === '/api/demo-config') return json({ adminConfigured: true, reminder24hReady: true });
  if (path === '/api/client-draft') return json(method === 'GET' ? { ok: true, draft: null } : { ok: true });
  if (path === '/api/client-profile') return json({ ok: true, profile: { telegram_id: 670067, name: 'Android Client', cleanings_total: 10, cleanings_remaining: 5 } });
  if (path === '/api/demo-client-orders') return json({ ok: true, orders });
  if (path === '/api/client-benefits') return json({ ok: true, selected_percent: 0 });
  if (path === '/api/demo-review') return json({ ok: true, review: {} });
  if (path === '/api/client-notification-settings') return json({ ok: true, settings: {} });
  return json({ ok: true });
});

const page = await context.newPage();
await page.goto(`${BASE_URL}/?demo=1`, { waitUntil: 'domcontentloaded' });
await page.locator('.u7-home-v3').waitFor({ state: 'visible' });
await page.waitForTimeout(350);

const state = await page.evaluate(() => ({
  htmlClass: document.documentElement.className,
  htmlOverflow: getComputedStyle(document.documentElement).overflowY,
  bodyOverflow: getComputedStyle(document.body).overflowY,
  htmlTouch: getComputedStyle(document.documentElement).touchAction,
  bodyTouch: getComputedStyle(document.body).touchAction,
  scrollHeight: document.documentElement.scrollHeight,
  innerHeight: window.innerHeight,
  calls: window.__swipeCalls,
}));

assert.match(state.htmlClass, /hc-android-scroll/);
assert.notEqual(state.htmlOverflow, 'hidden');
assert.notEqual(state.bodyOverflow, 'hidden');
assert.match(state.htmlTouch, /pan-y|auto/);
assert.match(state.bodyTouch, /pan-y|auto/);
assert.ok(state.scrollHeight > state.innerHeight + 100, `Экран должен быть прокручиваемым: ${state.scrollHeight}/${state.innerHeight}`);
assert.ok(state.calls.enable >= 1, 'Android должен вызывать enableVerticalSwipes после старого disableVerticalSwipes');

const cdp = await context.newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 600 }] });
for (const y of [540, 470, 400, 330, 260, 200]) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y }] });
  await page.waitForTimeout(25);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(250);

const scrollY = await page.evaluate(() => window.scrollY);
assert.ok(scrollY > 40, `Android touch gesture должен прокрутить экран, scrollY=${scrollY}`);

await page.screenshot({ path: 'playwright-android-scroll-v67.png', fullPage: false });
console.log(`✅ Android vertical scroll works, scrollY=${scrollY}`);

await context.close();
await browser.close();
