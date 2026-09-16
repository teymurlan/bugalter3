import assert from 'node:assert/strict';
import { webkit, devices } from 'playwright';

const BASE_URL = 'http://127.0.0.1:4173';
const DRAFT_KEY = 'hc-booking-draft-v2';
const iphone = devices['iPhone 15 Pro'] || devices['iPhone 14 Pro'];
const browser = await webkit.launch();

function draft(overrides = {}) {
  return {
    step: 4,
    serviceId: 1,
    propertyType: 'apartment',
    area: 50,
    rooms: 2,
    bathrooms: 1,
    pets: false,
    addonIds: [],
    serviceArea: 'spb',
    city: 'Санкт-Петербург',
    address: 'Невский проспект 10',
    apartment: '12',
    entrance: '',
    floor: '',
    addressComment: '',
    visitType: '',
    visitTypeConfirmed: false,
    date: '',
    time: '',
    customerName: 'Тестовый клиент',
    phone: '+79990000000',
    contactMethod: 'telegram',
    comment: '',
    photoRequired: null,
    knownAddress: false,
    idempotencyKey: `pw52-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...overrides,
  };
}

function telegramStub() {
  return `window.Telegram={WebApp:{initData:'query_id=playwright-v52',initDataUnsafe:{user:{id:777052,first_name:'Playwright'}},ready(){},expand(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},HapticFeedback:{selectionChanged(){},impactOccurred(){},notificationOccurred(){}}}};`;
}

async function createApp(initialDraft, availability = { usedM2: 0, remainingM2: 300 }) {
  const context = await browser.newContext({ ...iphone, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  let knownAddressCalls = 0;
  await context.addInitScript(({ key, value }) => {
    localStorage.setItem('hc-clean-start-generation', 'v45-clean-launch');
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('hc-demo-orders-v3', '[]');
  }, { key: DRAFT_KEY, value: initialDraft });

  await context.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: telegramStub(),
  }));

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });

    if (path === '/api/demo-config') return json({ adminConfigured: true, reminder24hReady: true });
    if (path === '/api/client-draft') return json(method === 'GET' ? { ok: true, draft: null } : { ok: true });
    if (path === '/api/client-profile') return json({ ok: true, profile: null });
    if (path === '/api/demo-client-orders') return json({ ok: true, orders: [] });
    if (path === '/api/client-benefits') return json({ ok: true, referral_percent: 0 });
    if (path === '/api/demo-review') return json({ ok: true, review: null });
    if (path === '/api/demo-known-address') { knownAddressCalls += 1; return json({ ok: true, known: true }); }
    if (path === '/api/demo-availability') {
      const slots = Array.from({ length: 10 }, (_, index) => ({ time: `${String(index + 9).padStart(2, '0')}:00`, available: true }));
      return json({ ok: true, date: url.searchParams.get('date'), capacityM2: 300, usedM2: availability.usedM2, remainingM2: availability.remainingM2, closed: false, slots, source: 'server' });
    }
    return json({ ok: true });
  });

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/?demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app');
  return { context, page, getKnownAddressCalls: () => knownAddressCalls };
}

async function run(name, initialDraft, fn, availability) {
  const app = await createApp(initialDraft, availability);
  try {
    await fn(app.page, app.getKnownAddressCalls);
    console.log(`✅ ${name}`);
  } catch (error) {
    await app.page.screenshot({ path: `playwright-v52-${name.replace(/[^a-zа-я0-9]+/gi, '-').toLowerCase()}.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await app.context.close();
  }
}

await run('первый заказ требует фото', draft(), async (page, knownCalls) => {
  await page.locator('.booking-title').filter({ hasText: 'Куда приехать?' }).waitFor();
  await page.locator('[data-next]').click();
  await page.getByText('Вы уже заказывали уборку по этому адресу?').waitFor();
  assert.equal(knownCalls(), 0, 'Автоматическая проверка истории адреса больше не должна вызываться');

  await page.locator('[data-visit-type="first"]').click();
  await page.locator('[data-next]').click();
  await page.locator('.booking-title').filter({ hasText: 'Фотографии объекта' }).waitFor();
  assert.match(await page.locator('.booking-title-block .page-subtitle').textContent(), /первого заказа/i);
  assert.equal(await page.locator('[data-next]').isDisabled(), true, 'Для первого заказа без фото продолжить нельзя');

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), DRAFT_KEY);
  assert.equal(saved.visitType, 'first');
  assert.equal(saved.photoRequired, true);
  assert.equal(knownCalls(), 0);
});

await run('повторный заказ сразу открывает дату и время', draft(), async (page, knownCalls) => {
  await page.locator('[data-next]').click();
  await page.getByText('Вы уже заказывали уборку по этому адресу?').waitFor();
  await page.locator('[data-visit-type="repeat"]').click();
  await page.locator('[data-next]').click();

  await page.locator('.hc-calendar-v2').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.photo-step').count(), 0, 'Для повторного заказа экран фотографий не должен открываться');
  assert.equal(knownCalls(), 0, 'История адресов не должна проверяться автоматически');

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), DRAFT_KEY);
  assert.equal(saved.visitType, 'repeat');
  assert.equal(saved.visitTypeConfirmed, true);
  assert.equal(saved.photoRequired, false);
  assert.equal(saved.step, 6, 'Повторный заказ должен сразу переходить на шаг даты и времени');

  await page.locator('[data-back]:visible').click();
  await page.getByText('Вы уже заказывали уборку по этому адресу?').waitFor();
  assert.equal(await page.locator('.photo-step').count(), 0, 'Назад из даты не должен вести на фотографии для повторного заказа');
});

await run('общая занятость приходит с сервера', draft({
  step: 6,
  visitType: 'repeat',
  visitTypeConfirmed: true,
  photoRequired: false,
}), async (page) => {
  await page.locator('.hc-calendar-v2').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.body.textContent.includes('150 м²'));
  assert.match(await page.locator('[data-capacity]').textContent(), /150 м²/);

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    width: document.documentElement.scrollWidth,
    card: (() => { const r = document.querySelector('.hc-calendar-v2')?.getBoundingClientRect(); return r && { left: r.left, right: r.right }; })(),
  }));
  assert.ok(layout.width <= layout.viewport + 2, 'Календарь не должен расширять страницу на iPhone');
  assert.ok(layout.card && layout.card.left >= -1 && layout.card.right <= layout.viewport + 1, 'Календарь должен помещаться на экран');
}, { usedM2: 150, remainingM2: 150 });

await browser.close();
console.log('\n✅ Release 54: первый/повторный заказ и общая занятость проверены');