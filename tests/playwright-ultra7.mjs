import assert from 'node:assert/strict';
import { webkit, devices } from 'playwright';

const BASE_URL = 'http://127.0.0.1:4173';
const iphone = devices['iPhone 15 Pro'] || devices['iPhone 14 Pro'];
const browser = await webkit.launch();

function moscowDate(offsetDays = 0) {
  const d = new Date(Date.now() + 3 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

const clientOrders = [
  {
    id: 1,
    order_number: 'HC-U7-0001',
    display_number: 1,
    status: 'COMPLETED',
    service_name: 'Поддерживающая уборка',
    area: 48,
    city: 'Санкт-Петербург',
    address: 'Невский проспект, 1',
    date: moscowDate(-7),
    time: '11:00',
    customer_name: 'Тестовый клиент',
    phone: '+79990000000',
    created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    updated_at: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: 2,
    order_number: 'HC-U7-0002',
    display_number: 2,
    status: 'CONFIRMED',
    service_name: 'Генеральная уборка',
    area: 62,
    city: 'Санкт-Петербург',
    address: 'Литейный проспект, 10',
    date: moscowDate(1),
    time: '12:00',
    customer_name: 'Тестовый клиент',
    phone: '+79990000000',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

function telegramStub() {
  return `window.Telegram={WebApp:{initData:'query_id=ultra7-playwright',initDataUnsafe:{user:{id:770057,first_name:'Ultra'}},ready(){},expand(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},openTelegramLink(){},HapticFeedback:{selectionChanged(){},impactOccurred(){},notificationOccurred(){}}}};`;
}

async function installRoutes(context, state) {
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
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(body),
    });

    if (path === '/api/demo-config') return json({ adminConfigured:true, reminder24hReady:true });
    if (path === '/api/client-draft') return json(method === 'GET' ? { ok:true, draft:null } : { ok:true });
    if (path === '/api/client-profile') return json({
      ok:true,
      profile:{
        telegram_id:770057,
        name:'Ultra Client',
        phone:'+79990000000',
        cleanings_total:10,
        cleanings_remaining:4,
        subscription_name:'Еженедельно',
      },
    });
    if (path === '/api/demo-client-orders') return json({ ok:true, orders:clientOrders });
    if (path === '/api/client-benefits') return json({ ok:true, selected_percent:0, referral_percent:0 });
    if (path === '/api/demo-review') return json({ ok:true, review:{} });
    if (path === '/api/client-notification-settings' && method === 'GET') {
      return json({ ok:true, settings:{ confirmed:true, reminder:true, completed:true, review:true, marketing:true } });
    }
    if (path === '/api/client-notification-settings' && method === 'POST') {
      state.clientNotificationPayload = request.postDataJSON();
      return json({ ok:true, settings:state.clientNotificationPayload });
    }
    if (path === '/api/demo-admin-orders') return json({ ok:true, orders:clientOrders });
    if (path === '/api/admin-staff') return json({ ok:true, staff:[] });
    if (path === '/api/admin-ultra7' && method === 'GET') return json({
      ok:true,
      settings:{
        central_new_order:true,
        central_cancellation:true,
        client_confirmed:true,
        client_reminder:true,
        client_completed:true,
        client_review:true,
        marketing_enabled:true,
      },
      clients:[{
        telegram_id:770057,
        name:'Ultra Client',
        phone:'+79990000000',
        completed_count:1,
        active_count:1,
        cleanings_total:10,
        cleanings_remaining:4,
        subscription_name:'Еженедельно',
        last_cleaning_at:`${moscowDate(-7)} 11:00`,
        next_cleaning_at:`${moscowDate(1)} 12:00`,
        next_address:'Санкт-Петербург, Литейный проспект, 10',
        marketing:true,
      }],
      counts:{ all:1, active:1, completed:1, subscription:1, marketing:1 },
      broadcasts:[],
      notification_center:{ configured:true },
    });
    if (path === '/api/admin-ultra7/settings') return json({ ok:true, settings:request.postDataJSON() });
    if (path === '/api/admin-ultra7/client-schedule') return json({ ok:true, profile:request.postDataJSON() });
    if (path === '/api/admin-ultra7/broadcast') return json({ ok:true, sent:1, failed:0, skipped:0, segment:'all' });
    return json({ ok:true });
  });
}

async function clientCheck() {
  const context = await browser.newContext({ ...iphone, locale:'ru-RU', timezoneId:'Europe/Moscow' });
  const state = { clientNotificationPayload:null };
  await context.addInitScript(({ orders }) => {
    localStorage.setItem('hc-clean-start-generation','v45-clean-launch');
    localStorage.removeItem('hc-booking-draft-v2');
    localStorage.setItem('hc-demo-orders-v3', JSON.stringify(orders));
  }, { orders:clientOrders });
  await installRoutes(context,state);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/?demo=1`, { waitUntil:'domcontentloaded' });
    await page.getByText('Мои уборки').waitFor({ state:'visible' });
    const summary = page.locator('.u7-summary');
    assert.match(await summary.textContent(), /Осталось\s*4/);
    assert.match(await summary.textContent(), /Следующая уборка/);

    const navHeight = await page.locator('#bottom-nav').evaluate((node)=>node.getBoundingClientRect().height);
    assert.ok(navHeight <= 72, `Нижнее меню должно быть компактным, сейчас ${navHeight}px`);

    const next = page.locator('[data-summary-next]');
    await next.scrollIntoViewIfNeeded();
    const before = await page.evaluate(()=>window.scrollY);
    await next.click();
    await page.locator('.cc-detail-head').waitFor({ state:'visible' });
    await page.locator('[data-back]').click();
    await page.getByText('Мои уборки').waitFor({ state:'visible' });
    const after = await page.evaluate(()=>window.scrollY);
    assert.ok(Math.abs(after - before) < 80, `Назад должен восстановить позицию: было ${before}, стало ${after}`);

    await page.locator('#bottom-nav [data-route="profile"]').click();
    await page.getByText('Внешний вид').waitFor({ state:'visible' });
    assert.equal(await page.locator('[data-menu="referral"]').count(),0,'Реферального пункта быть не должно');
    await page.locator('[data-menu="appearance"]').click();
    await page.locator('[data-theme="dark"]').click();
    assert.equal(await page.locator('html').getAttribute('data-hc-theme'),'dark');
    assert.equal(await page.evaluate(()=>localStorage.getItem('hc-ultra7-theme-client')),'dark');

    await page.locator('[data-back]').click();
    await page.locator('[data-menu="notifications"]').click();
    const marketing = page.locator('[data-notify="marketing"]');
    await marketing.uncheck();
    await page.locator('[data-save-notifications]').click();
    await page.waitForFunction(()=>document.querySelector('[data-save-notifications]')?.disabled === false);
    assert.equal(state.clientNotificationPayload?.marketing,false,'Настройка клиента должна уходить на сервер');

    await page.screenshot({ path:'playwright-ultra7-client.png', fullPage:true });
    console.log('✅ Ultra 7 client iPhone UX');
  } finally {
    await context.close();
  }
}

async function adminCheck() {
  const context = await browser.newContext({ ...iphone, locale:'ru-RU', timezoneId:'Europe/Moscow' });
  const state = {};
  await installRoutes(context,state);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/?demo=1&admin=1`, { waitUntil:'domcontentloaded' });
    await page.getByText('Сегодня',{ exact:true }).first().waitFor({ state:'visible' });
    await page.locator('[data-sec="more"]').last().click();
    await page.getByText('Клиенты и графики').waitFor({ state:'visible' });
    await page.locator('[data-sec="clients"]').click();
    await page.getByText('Ultra Client').waitFor({ state:'visible' });
    assert.match(await page.locator('.u7-client-card').textContent(), /Осталось\s*4/);

    await page.locator('[data-sec="more"]').last().click();
    await page.locator('[data-sec="notifications"]').click();
    await page.getByText('Рассылка клиентам').waitFor({ state:'visible' });
    assert.equal(await page.locator('[data-broadcast-form]').count(),1);
    assert.equal(await page.locator('[data-admin-notify]').count(),7);

    await page.locator('[data-sec="more"]').last().click();
    await page.locator('[data-admin-theme]').click();
    await page.locator('[data-admin-theme-choice="blue"]').click();
    assert.equal(await page.locator('html').getAttribute('data-hc-theme'),'blue');

    const navHeight = await page.locator('.hc-m-nav').evaluate((node)=>node.getBoundingClientRect().height);
    assert.ok(navHeight <= 76, `Админское нижнее меню должно быть компактным, сейчас ${navHeight}px`);
    await page.screenshot({ path:'playwright-ultra7-admin.png', fullPage:true });
    console.log('✅ Ultra 7 admin iPhone UX');
  } finally {
    await context.close();
  }
}

await clientCheck();
await adminCheck();
await browser.close();
console.log('\n✅ HOUSE CLEANING ULTRA 7 WebKit checks passed');
