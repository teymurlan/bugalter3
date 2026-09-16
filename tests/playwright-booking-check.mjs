import assert from 'node:assert/strict';
import { webkit, devices } from 'playwright';

const BASE_URL = 'http://127.0.0.1:4173';
const DRAFT_KEY = 'hc-booking-draft-v2';
const SIX_HOURS = 6 * 60 * 60 * 1000;

const iphone = devices['iPhone 15 Pro'] || devices['iPhone 14 Pro'] || {
  viewport: { width: 393, height: 852 },
  isMobile: true,
  hasTouch: true,
};

const browser = await webkit.launch();
const failures = [];

function moscowDate(days = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const base = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day) + days));
  return base.toISOString().slice(0, 10);
}

function makeDraft(overrides = {}) {
  return {
    step: 0,
    serviceId: null,
    propertyType: 'apartment',
    area: 50,
    rooms: 2,
    bathrooms: 1,
    pets: false,
    addonIds: [],
    serviceArea: 'spb',
    city: 'Санкт-Петербург',
    address: '',
    apartment: '',
    entrance: '',
    floor: '',
    addressComment: '',
    date: '',
    time: '',
    customerName: 'Тестовый клиент',
    phone: '+79990000000',
    contactMethod: 'telegram',
    comment: '',
    photoRequired: null,
    knownAddress: false,
    idempotencyKey: `pw-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...overrides,
  };
}

function telegramStub() {
  return `
    window.Telegram = {
      WebApp: {
        initData: 'query_id=playwright-test',
        initDataUnsafe: { user: { id: 777001, first_name: 'Playwright', username: 'playwright_test' } },
        ready() {}, expand() {}, disableVerticalSwipes() {},
        setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
        openTelegramLink() {}, openLink() {}, close() {},
        HapticFeedback: {
          selectionChanged() {}, impactOccurred() {}, notificationOccurred() {}
        }
      }
    };
  `;
}

async function createApp({ draft = makeDraft(), completedOrders = [] } = {}) {
  const context = await browser.newContext({
    ...iphone,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  });

  await context.addInitScript(({ key, value }) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem('hc-demo-orders-v3', '[]');
    } catch {}
  }, { key: DRAFT_KEY, value: draft });

  await context.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: telegramStub(),
    });
  });

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(body),
    });

    if (path === '/api/demo-config') return json({ adminConfigured: true, reminder24hReady: true });
    if (path === '/api/client-draft') {
      if (method === 'GET') return json({ ok: true, draft: null });
      return json({ ok: true });
    }
    if (path === '/api/demo-client-orders') return json({ ok: true, orders: completedOrders });
    if (path === '/api/client-benefits') return json({ ok: true, referral_percent: 0 });
    if (path === '/api/demo-review') return json({ ok: true, review: null });
    if (path === '/api/demo-order' && method === 'POST') {
      const payload = request.postDataJSON() || {};
      return json({ ok: true, adminNotified: 1, order: payload.order || null });
    }
    if (path === '/api/demo-order-media' && method === 'POST') {
      return json({ ok: true, adminNotified: 1, order: null });
    }
    if (path === '/api/demo-order-status' && method === 'POST') {
      return json({ ok: true, clientNotified: true });
    }
    if (path === '/api/demo-admin-orders') return json({ ok: true, orders: [] });
    if (path === '/api/demo-admin-store-status' && method === 'POST') return json({ ok: true });
    return json({ ok: false, error: 'Playwright mock: endpoint not configured' }, 404);
  });

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/?demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app');
  return { context, page };
}

async function withApp(name, options, fn) {
  const { context, page } = await createApp(options);
  try {
    await fn(page);
    console.log(`✅ ${name}`);
  } catch (error) {
    const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await page.screenshot({ path: `playwright-failure-${safe || 'check'}.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

async function run(name, fn) {
  try {
    await fn();
  } catch (error) {
    failures.push(`${name}: ${error?.stack || error}`);
    console.error(`❌ ${name}`);
    console.error(error);
  }
}

await run('Вход в оформление уборки', async () => {
  await withApp('booking-entry', { draft: makeDraft({ step: 0 }) }, async (page) => {
    const newOrder = page.locator('[data-new-order]').first();
    await newOrder.waitFor({ state: 'visible' });
    await newOrder.click();
    await page.locator('.booking-title').filter({ hasText: 'Выберите уборку' }).waitFor();

    await page.locator('[data-service]').first().click();
    await page.locator('[data-next]').click();
    await page.locator('.booking-title').filter({ hasText: 'Расскажите об объекте' }).waitFor();
  });
});

await run('Календарь, прошлое время и правило 6 часов', async () => {
  await withApp('schedule-six-hours', {
    draft: makeDraft({ step: 6, serviceId: 1, area: 50 }),
  }, async (page) => {
    await page.locator('.hc-calendar-v2').waitFor({ state: 'visible' });

    const layout = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const card = document.querySelector('.hc-calendar-v2')?.getBoundingClientRect();
      const date = document.querySelector('.hc-manual-date')?.getBoundingClientRect();
      const heights = [...document.querySelectorAll('.calendar-day')].map((item) => item.getBoundingClientRect().height);
      return {
        viewport,
        documentWidth: document.documentElement.scrollWidth,
        card: card ? { left: card.left, right: card.right } : null,
        date: date ? { left: date.left, right: date.right } : null,
        heights,
      };
    });

    assert.ok(layout.card, 'Карточка календаря не найдена');
    assert.ok(layout.documentWidth <= layout.viewport + 2, `Страница шире iPhone: ${layout.documentWidth}px > ${layout.viewport}px`);
    assert.ok(layout.card.left >= -1 && layout.card.right <= layout.viewport + 1, 'Карточка календаря выходит за экран iPhone');
    assert.ok(!layout.date || (layout.date.left >= -1 && layout.date.right <= layout.viewport + 1), 'Поле выбора даты выходит за экран iPhone');
    if (layout.heights.length > 1) {
      const spread = Math.max(...layout.heights) - Math.min(...layout.heights);
      assert.ok(spread <= 3, `Карточки дат разной высоты: разброс ${spread.toFixed(1)}px`);
    }

    const today = moscowDate(0);
    const minDate = await page.locator('[data-date]').getAttribute('min');
    assert.equal(minDate, today, `Минимальная дата должна быть сегодня по Москве (${today})`);

    await page.locator('[data-date]').fill(today);
    await page.locator('[data-date]').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelectorAll('[data-time]').length > 0 || document.querySelector('.hc-leadtime-empty'));

    const checkedAt = Date.now();
    const slots = await page.locator('[data-time]').evaluateAll((buttons) => buttons.map((button) => ({
      time: button.dataset.time,
      hidden: button.hidden,
      disabled: button.disabled,
      unavailable: button.classList.contains('unavailable'),
    })));

    for (const slot of slots) {
      const stamp = Date.parse(`${today}T${slot.time}:00+03:00`);
      const delta = stamp - (checkedAt + SIX_HOURS);
      if (delta < -5000) {
        assert.ok(slot.hidden && slot.disabled, `Время ${slot.time} раньше 6 часов должно быть скрыто и отключено`);
      } else if (delta > 5000 && !slot.unavailable) {
        assert.ok(!slot.hidden && !slot.disabled, `Допустимое время ${slot.time} не должно быть скрыто`);
      }
    }

    await page.locator('[data-next]').click();
    await page.locator('.booking-title').filter({ hasText: 'Выберите дату и время' }).waitFor();

    const future = moscowDate(2);
    await page.locator('[data-date]').fill(future);
    await page.locator('[data-date]').dispatchEvent('change');
    const available = page.locator('[data-time]:not([hidden]):not([disabled])').first();
    await available.waitFor({ state: 'visible' });
    await available.click();
    await page.locator('[data-next]').click();
    await page.locator('.booking-title').filter({ hasText: 'Контакты и подтверждение' }).waitFor();

    await page.screenshot({ path: 'playwright-schedule.png', fullPage: true });
  });
});

await run('Предварительная сумма не перекрыта кнопками', async () => {
  await withApp('review-layout', {
    draft: makeDraft({
      step: 8,
      serviceId: 1,
      area: 50,
      address: 'Невский проспект 10',
      apartment: '12',
      date: moscowDate(2),
      time: '18:00',
      knownAddress: true,
      photoRequired: false,
    }),
  }, async (page) => {
    await page.locator('.price-card').waitFor({ state: 'visible' });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);

    const boxes = await page.evaluate(() => {
      const price = document.querySelector('.price-card')?.getBoundingClientRect();
      const actions = document.querySelector('.wizard-actions')?.getBoundingClientRect();
      const next = document.querySelector('[data-next]')?.getBoundingClientRect();
      const back = document.querySelector('[data-back]')?.getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        price: price ? { top: price.top, bottom: price.bottom, left: price.left, right: price.right } : null,
        actions: actions ? { top: actions.top, bottom: actions.bottom, left: actions.left, right: actions.right } : null,
        next: next ? { left: next.left, right: next.right } : null,
        back: back ? { left: back.left, right: back.right } : null,
      };
    });

    assert.ok(boxes.price && boxes.actions, 'Не найдены сумма или нижние кнопки');
    assert.ok(boxes.price.bottom <= boxes.actions.top - 2, `Предварительная сумма перекрыта кнопками: сумма до ${boxes.price.bottom.toFixed(1)}px, кнопки начинаются с ${boxes.actions.top.toFixed(1)}px`);
    assert.ok(boxes.actions.left >= -1 && boxes.actions.right <= boxes.viewport + 1, 'Панель кнопок выходит за экран iPhone');
    if (boxes.next) assert.ok(boxes.next.left >= -1 && boxes.next.right <= boxes.viewport + 1, 'Кнопка «Оформить заявку» выходит за экран');
    if (boxes.back) assert.ok(boxes.back.left >= -1 && boxes.back.right <= boxes.viewport + 1, 'Кнопка «Назад» выходит за экран');

    await page.getByText('Предварительная стоимость', { exact: true }).waitFor({ state: 'visible' });
    await page.screenshot({ path: 'playwright-review.png', fullPage: true });
  });
});

await run('Повторный адрес разрешает оформление без фото', async () => {
  const address = 'Невский проспект 10';
  const apartment = '12';
  const completedOrders = [{
    id: 501,
    order_number: 'HC-TEST-0501',
    status: 'COMPLETED',
    city: 'Санкт-Петербург',
    address,
    apartment,
    date: moscowDate(-10),
    time: '12:00',
    service_name: 'Генеральная уборка',
    area: 50,
  }];

  await withApp('repeat-address-no-photo', {
    draft: makeDraft({
      step: 5,
      serviceId: 1,
      area: 50,
      address,
      apartment,
    }),
    completedOrders,
  }, async (page) => {
    await page.locator('[data-next]').waitFor({ state: 'visible' });
    await page.locator('[data-next]').click();
    await page.locator('.hc-calendar-v2').waitFor({ state: 'visible' });

    const known = await page.evaluate((key) => {
      const draft = JSON.parse(localStorage.getItem(key) || '{}');
      return { knownAddress: draft.knownAddress, photoRequired: draft.photoRequired };
    }, DRAFT_KEY);
    assert.equal(known.knownAddress, true, 'Завершённая уборка по тому же адресу должна распознаваться');
    assert.equal(known.photoRequired, false, 'Для повторного адреса фото должны быть необязательными');

    await page.evaluate(({ key, date }) => {
      const draft = JSON.parse(localStorage.getItem(key) || '{}');
      Object.assign(draft, {
        step: 8,
        date,
        time: '18:00',
        customerName: 'Тестовый клиент',
        phone: '+79990000000',
        contactMethod: 'telegram',
      });
      localStorage.setItem(key, JSON.stringify(draft));
    }, { key: DRAFT_KEY, date: moscowDate(2) });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.locator('.review-head').waitFor({ state: 'visible' });
    const photoRow = page.locator('.summary-row').filter({ hasText: 'Фото для оценки' });
    await photoRow.waitFor({ state: 'visible' });
    assert.match(await photoRow.textContent(), /Не требуются/i, 'На финальном шаге должно быть указано, что фото не требуются');
    assert.equal(await page.locator('[data-next]').isDisabled(), false, 'Кнопка оформления должна быть доступна без фото для повторного адреса');
  });
});

await browser.close();

if (failures.length) {
  console.error('\nPlaywright нашёл проблемы:');
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log('\n✅ Все расширенные проверки HOUSE CLEANING пройдены');
