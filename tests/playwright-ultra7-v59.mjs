import assert from 'node:assert/strict';
import { webkit, devices } from 'playwright';

const BASE_URL='http://127.0.0.1:4173';
const DRAFT_KEY='hc-booking-draft-v2';
const iphone=devices['iPhone 15 Pro'] || devices['iPhone 14 Pro'];
const browser=await webkit.launch();

function moscowDay(offset=0){
  const d=new Date(Date.now()+3*3600000+offset*86400000);
  return d.toISOString().slice(0,10);
}

const completedOrder={
  id:1,order_number:'HC-U59-0001',display_number:1,status:'COMPLETED',
  service_id:2,service_name:'Поддерживающая уборка',property_type:'apartment',
  area:50,rooms:2,bathrooms:1,pets:false,addon_ids:[],city:'Санкт-Петербург',
  address:'Дыбенко, 5',apartment:'315',date:moscowDay(-7),time:'11:00',
  customer_name:'Ultra Client',phone:'+79990000000',contact_method:'telegram',
  created_at:new Date(Date.now()-8*86400000).toISOString(),updated_at:new Date(Date.now()-7*86400000).toISOString(),
};
const activeOrder={
  id:2,order_number:'HC-U59-0002',display_number:2,status:'CONFIRMED',
  service_id:1,service_name:'Генеральная уборка',property_type:'apartment',
  area:60,rooms:2,bathrooms:1,pets:false,addon_ids:[],city:'Санкт-Петербург',
  address:'Невский проспект, 10',apartment:'12',date:moscowDay(1),time:'12:00',
  customer_name:'Ultra Client',phone:'+79990000000',contact_method:'telegram',
  estimated_price:13800,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
};

function telegramStub(){
  return `window.Telegram={WebApp:{initData:'query_id=ultra59',initDataUnsafe:{user:{id:790059,first_name:'Ultra'}},ready(){},expand(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},openTelegramLink(){},HapticFeedback:{selectionChanged(){},impactOccurred(){},notificationOccurred(){}}}};`;
}

async function createApp({orders=[completedOrder,activeOrder],remaining=4}={}){
  const context=await browser.newContext({...iphone,locale:'ru-RU',timezoneId:'Europe/Moscow'});
  await context.addInitScript(({orders,key})=>{
    localStorage.setItem('hc-clean-start-generation','v45-clean-launch');
    localStorage.setItem('hc-demo-orders-v3',JSON.stringify(orders));
    localStorage.removeItem(key);
    localStorage.setItem('hc-ultra7-theme-client','light');
  },{orders,key:DRAFT_KEY});

  await context.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({
    status:200,contentType:'application/javascript; charset=utf-8',body:telegramStub(),
  }));

  await context.route('**/api/**',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    const path=url.pathname;
    const method=request.method();
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json; charset=utf-8',body:JSON.stringify(body)});

    if(path==='/api/demo-config') return json({adminConfigured:true,reminder24hReady:true});
    if(path==='/api/client-draft') return json(method==='GET'?{ok:true,draft:null}:{ok:true});
    if(path==='/api/client-profile') return json({ok:true,profile:{telegram_id:790059,name:'Ultra Client',phone:'+79990000000',cleanings_remaining:remaining,cleanings_total:10}});
    if(path==='/api/demo-client-orders') return json({ok:true,orders});
    if(path==='/api/demo-client-order'){
      const number=url.searchParams.get('order');
      return json({ok:true,order:orders.find(item=>item.order_number===number)||null});
    }
    if(path==='/api/client-benefits') return json({ok:true,selected_percent:0,referral_percent:0});
    if(path==='/api/demo-review') return json({ok:true,review:{}});
    if(path==='/api/manager-contact') return json({ok:true,telegram_id:790059});
    if(path==='/api/client-notification-settings') return json({ok:true,settings:{confirmed:true,reminder:true,completed:true,review:true,marketing:true}});
    if(path==='/api/demo-availability'){
      const slots=Array.from({length:10},(_,i)=>({time:`${String(i+9).padStart(2,'0')}:00`,available:true}));
      return json({ok:true,date:url.searchParams.get('date'),capacityM2:300,usedM2:0,remainingM2:300,closed:false,slots,source:'server'});
    }
    return json({ok:true});
  });

  const page=await context.newPage();
  await page.goto(`${BASE_URL}/?demo=1`,{waitUntil:'domcontentloaded'});
  await page.locator('.u7-home-v3').waitFor({state:'visible'});
  return {context,page};
}

function rgb(value){
  const numbers=String(value).match(/[\d.]+/g)?.slice(0,3).map(Number)||[];
  if(numbers.length!==3) return null;
  return Math.max(...numbers)<=1.01 ? numbers.map(item=>item*255) : numbers;
}
function luminance([r,g,b]){
  const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};
  return .2126*f(r)+.7152*f(g)+.0722*f(b);
}
function contrast(a,b){
  const A=luminance(a),B=luminance(b);
  return (Math.max(A,B)+.05)/(Math.min(A,B)+.05);
}

async function assertContrast(locator,label){
  const values=await locator.evaluate(node=>{
    const title=node.querySelector('h1,h2,h3,strong') || node;
    return {bg:getComputedStyle(node).backgroundColor,fg:getComputedStyle(title).color};
  });
  const bg=rgb(values.bg),fg=rgb(values.fg);
  assert.ok(bg&&fg&&contrast(bg,fg)>=4.2,`${label}: контраст ${bg&&fg?contrast(bg,fg):'n/a'}`);
}

{
  const {context,page}=await createApp();
  try{
    assert.equal(await page.locator('.u7-home-actions').count(),0,'Старые быстрые кнопки на главной должны быть убраны');
    assert.equal(await page.locator('.hc-home-orders-section-v54').count(),0,'Последние заявки на главной должны быть убраны');
    assert.equal(await page.locator('.u7-smart-card').count(),1,'Вместо последних заявок нужен полезный быстрый повтор');
    assert.match(await page.locator('.u7-smart-card').textContent(),/Повторить последнюю уборку/);
    assert.match(await page.locator('.u7-home-summary-v3').textContent(),/Осталось по графику\s*4/);
    assert.equal(await page.locator('.u7-week-v3').count(),1);

    const primaryHeight=await page.locator('.u7-home-primary').evaluate(node=>node.getBoundingClientRect().height);
    assert.ok(primaryHeight>=54,`Главная кнопка должна быть крупной и удобной, сейчас ${primaryHeight}px`);

    for(const theme of ['light','dark','blue']){
      await page.evaluate(t=>window.HCUltraTheme.set(t),theme);
      await assertContrast(page.locator('.u7-home-hero'),`${theme} hero`);
      await assertContrast(page.locator('.u7-home-summary-v3'),`${theme} summary`);
    }

    await page.evaluate(()=>window.HCUltraTheme.set('light'));
    const next=page.locator('[data-next-order]');
    await next.scrollIntoViewIfNeeded();
    const before=await page.evaluate(()=>window.scrollY);
    await next.click();
    await page.locator('.cc-detail-head').waitFor({state:'visible'});
    await page.locator('[data-back]').click();
    await page.locator('.u7-home-v3').waitFor({state:'visible'});
    await page.waitForTimeout(120);
    const after=await page.evaluate(()=>window.scrollY);
    assert.ok(Math.abs(after-before)<100,`Назад должен вернуть главную позицию: ${before} -> ${after}`);

    await page.locator('#bottom-nav [data-route="orders"]').click();
    await page.locator('.u7-order-card-v3').first().waitFor({state:'visible'});
    assert.equal(await page.locator('.hc-order-card-v54').count(),0,'Старые большие карточки заявок не должны использоваться');

    for(const theme of ['light','dark','blue']){
      await page.evaluate(t=>window.HCUltraTheme.set(t),theme);
      await assertContrast(page.locator('.u7-order-card-v3').first(),`${theme} order card`);
    }

    const firstCard=page.locator('.u7-order-card-v3').first();
    await firstCard.scrollIntoViewIfNeeded();
    const ordersBefore=await page.evaluate(()=>window.scrollY);
    await firstCard.locator('[data-open]').click();
    await page.locator('.cc-detail-head').waitFor({state:'visible'});
    await page.locator('[data-back]').click();
    await page.locator('.u7-order-card-v3').first().waitFor({state:'visible'});
    await page.waitForTimeout(120);
    const ordersAfter=await page.evaluate(()=>window.scrollY);
    assert.ok(Math.abs(ordersAfter-ordersBefore)<100,`Назад должен вернуть список заявок: ${ordersBefore} -> ${ordersAfter}`);

    await page.locator('#bottom-nav [data-route="home"]').click();
    await page.locator('[data-repeat-order]').click();
    await page.locator('.hc-calendar-v2').waitFor({state:'visible'});
    const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),DRAFT_KEY);
    assert.equal(saved.step,6);
    assert.equal(saved.visitType,'repeat');
    assert.equal(saved.photoRequired,false);
    assert.equal(saved.address,'Дыбенко, 5');

    await page.screenshot({path:'playwright-ultra7-v59-client.png',fullPage:true});
    console.log('✅ Ultra 7.2 active client screens');
  }finally{
    await context.close();
  }
}

{
  const {context,page}=await createApp({orders:[completedOrder],remaining:0});
  try{
    assert.equal(await page.locator('.u7-next-cleaning').count(),0,'Без активной уборки блок ближайшей уборки скрыт');
    assert.equal(await page.locator('.u7-home-summary-v3').count(),0,'Без активного графика блок Мои уборки скрыт');
    assert.equal(await page.locator('.u7-week-v3').count(),0,'Пустой блок 7 дней не показывается');
    assert.equal(await page.locator('.u7-smart-card').count(),1,'Быстрый повтор остаётся полезным действием');
    await page.screenshot({path:'playwright-ultra7-v59-empty.png',fullPage:true});
    console.log('✅ Ultra 7.2 empty-state home');
  }finally{
    await context.close();
  }
}

await browser.close();
console.log('\n✅ HOUSE CLEANING release 59 handwritten screens passed');
