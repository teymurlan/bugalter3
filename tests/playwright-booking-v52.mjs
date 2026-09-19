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
    localStorage.setItem('hc-clean-start-generation', 'v66-final-launch');
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
  if (Number(initialDraft?.step || 0) > 0) {
    await page.locator('[data-resume-order]').waitFor({ state: 'visible' });
    await page.locator('[data-resume-order]').click();
  }
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

  const floorInput = page.locator('[data-field="floor"]');
  for (const theme of ['light','blue','dark']) {
    await page.evaluate((value) => { document.documentElement.dataset.hcTheme = value; }, theme);
    await floorInput.focus();
    const contrast = await floorInput.evaluate((node) => {
      const style = getComputedStyle(node);
      const parse = (value) => {
        const match = String(value).match(/[\d.]+/g);
        return match ? match.slice(0,3).map(Number) : [0,0,0];
      };
      const luminance = (rgb) => {
        const channels = rgb.map((value) => {
          const v = value / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const fg = luminance(parse(style.color));
      const bg = luminance(parse(style.backgroundColor));
      return {
        ratio:(Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05),
        color:style.color,
        background:style.backgroundColor,
        caret:style.caretColor,
      };
    });
    assert.ok(contrast.ratio >= 4.5, `Текст активного поля должен читаться в теме ${theme}: ${JSON.stringify(contrast)}`);
    assert.notEqual(contrast.caret, 'rgba(0, 0, 0, 0)', `Курсор должен быть видим в теме ${theme}`);
  }
  await page.evaluate(() => { document.documentElement.dataset.hcTheme = 'light'; });

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

  await page.locator('[data-global-booking-back]').waitFor({ state: 'visible' });
  await page.locator('[data-global-booking-back]').click();
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
  const firstDate = page.locator('[data-calendar-date]:not([disabled])').first();
  await firstDate.waitFor({ state: 'visible' });
  await page.locator('.hc-calendar-v2').evaluate(node => { node.dataset.stabilityToken = 'same-calendar'; });
  const beforeScroll = await page.evaluate(() => window.scrollY);
  await firstDate.click();
  assert.equal(await page.locator('.hc-calendar-v2').getAttribute('data-stability-token'), 'same-calendar', 'Выбор даты не должен перерисовывать весь экран');
  const afterScroll = await page.evaluate(() => window.scrollY);
  assert.ok(Math.abs(afterScroll - beforeScroll) < 30, `Выбор даты не должен дёргать страницу: ${beforeScroll} -> ${afterScroll}`);

  const capacity = page.locator('[data-capacity] .capacity-box-v2 strong');
  await capacity.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-capacity] .capacity-box-v2 strong')?.textContent?.includes('150 м²'));
  assert.match(await capacity.textContent(), /150 м²/);

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    width: document.documentElement.scrollWidth,
    card: (() => { const r = document.querySelector('.hc-calendar-v2')?.getBoundingClientRect(); return r && { left: r.left, right: r.right }; })(),
  }));
  assert.ok(layout.width <= layout.viewport + 2, 'Календарь не должен расширять страницу на iPhone');
  assert.ok(layout.card && layout.card.left >= -1 && layout.card.right <= layout.viewport + 1, 'Календарь должен помещаться на экран');
}, { usedM2: 150, remainingM2: 150 });

await browser.close();
console.log('\n✅ Release 66: поля, первый/повторный заказ и общая занятость проверены');