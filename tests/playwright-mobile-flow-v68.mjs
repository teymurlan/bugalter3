import assert from 'node:assert/strict';
import { webkit, devices } from 'playwright';

const BASE_URL='http://127.0.0.1:4173';
const DRAFT_KEY='hc-booking-draft-v2';
const iphone=devices['iPhone 15 Pro'] || devices['iPhone 14 Pro'];
const browser=await webkit.launch();

function futureDay(offset=2){
  const d=new Date(Date.now()+offset*86400000);
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}

function draft(overrides={}){
  return {
    step:1,serviceId:1,propertyType:'apartment',area:50,rooms:2,bathrooms:1,pets:false,addonIds:[],
    serviceArea:'spb',city:'Санкт-Петербург',address:'Дыбенко, 5',apartment:'12',entrance:'',floor:'',addressComment:'',
    visitType:'repeat',visitTypeConfirmed:true,date:'',time:'',customerName:'Тестовый клиент',phone:'+79990000000',
    contactMethod:'telegram',comment:'',photoRequired:false,knownAddress:false,idempotencyKey:`v68-${Date.now()}-${Math.random()}`,
    ...overrides,
  };
}

const order={
  id:1,order_number:'HC-V68-0001',display_number:1,status:'CONFIRMED',service_id:2,service_name:'Поддерживающая уборка',
  property_type:'apartment',area:50,rooms:2,bathrooms:1,city:'Санкт-Петербург',address:'Дыбенко, 5',apartment:'12',
  date:futureDay(3),time:'12:00',customer_name:'Тестовый клиент',phone:'+79990000000',contact_method:'telegram',
  estimated_price:4750,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),addon_ids:[],photo_count:0,
};

function telegramStub(){
  return `window.Telegram={WebApp:{initData:'query_id=v68',initDataUnsafe:{user:{id:780068,first_name:'Mobile'}},ready(){},expand(){},disableVerticalSwipes(){},enableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},openTelegramLink(url){window.__managerUrl=url},HapticFeedback:{selectionChanged(){},impactOccurred(){},notificationOccurred(){}}}};`;
}

async function setup({initialDraft=null,admin=false,orders=[order]}={}){
  const context=await browser.newContext({...iphone,locale:'ru-RU',timezoneId:'Europe/Moscow'});
  await context.addInitScript(({key,value,orders})=>{
    localStorage.setItem('hc-clean-start-generation','v66-final-launch');
    if(value) localStorage.setItem(key,JSON.stringify(value)); else localStorage.removeItem(key);
    localStorage.setItem('hc-demo-orders-v3',JSON.stringify(orders));
  },{key:DRAFT_KEY,value:initialDraft,orders});
  await context.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:telegramStub()}));
  await context.route('**/api/**',async route=>{
    const req=route.request(); const url=new URL(req.url()); const path=url.pathname; const method=req.method();
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json; charset=utf-8',body:JSON.stringify(body)});
    if(path==='/api/demo-config') return json({adminConfigured:true,reminder24hReady:true,managerUsername:'cleaningspb1',botUsername:'housecleaningbot'});
    if(path==='/api/client-draft') return json(method==='GET'?{ok:true,draft:null}:{ok:true});
    if(path==='/api/client-profile') return json({ok:true,profile:{telegram_id:780068,name:'Mobile Test',phone:'+79990000000'}});
    if(path==='/api/demo-client-orders') return json({ok:true,orders});
    if(path==='/api/demo-client-order') return json({ok:true,order:orders.find(x=>x.order_number===url.searchParams.get('order'))||null});
    if(path==='/api/client-benefits') return json({ok:true,referral_percent:0});
    if(path==='/api/demo-review') return json({ok:true,review:null});
    if(path==='/api/manager-contact') return json({ok:true,telegram_id:0});
    if(path==='/api/demo-availability'){
      const slots=Array.from({length:10},(_,i)=>({time:`${String(i+9).padStart(2,'0')}:00`,available:true}));
      return json({ok:true,date:url.searchParams.get('date'),capacityM2:300,usedM2:0,remainingM2:300,closed:false,slots,source:'server'});
    }
    if(path==='/api/demo-admin-orders') return json({ok:true,orders});
    if(path==='/api/admin-staff') return json({ok:true,staff:[]});
    if(path==='/api/admin-ultra7') return json({ok:true,settings:{},clients:[],counts:{all:0,active:0,completed:0,subscription:0,marketing:0},broadcasts:[],notification_center:{configured:false}});
    return json({ok:true});
  });
  const page=await context.newPage();
  await page.goto(`${BASE_URL}/?demo=1${admin?'&admin=1':''}`,{waitUntil:'domcontentloaded'});
  return {context,page};
}

// Narrow phone: unfinished order arrow removed, support works, and booking content is not trapped under fixed actions.
{
  const {context,page}=await setup({initialDraft:draft({step:1})});
  try{
    await page.locator('[data-resume-order]').waitFor({state:'visible'});
    assert.equal(await page.locator('.u7-home-draft-resume-v66 b').count(),0,'Стрелка Продолжить должна быть удалена');
    const manager=page.locator('.u7-home-help-v3 [data-manager]');
    await manager.waitFor({state:'visible'});
    assert.match(await manager.textContent(),/Написать менеджеру/);
    await manager.click();
    await page.waitForFunction(()=>Boolean(window.__managerUrl));
    assert.equal(await page.evaluate(()=>window.__managerUrl),'https://t.me/cleaningspb1');

    await page.locator('[data-resume-order]').click();
    await page.getByText('Выберите уборку',{exact:true}).waitFor({state:'visible'});
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    await page.waitForTimeout(80);
    const layout=await page.evaluate(()=>{
      const dock=document.querySelector('.wizard-actions');
      const content=dock?.previousElementSibling;
      return {dockTop:dock?.getBoundingClientRect().top||0,contentBottom:content?.getBoundingClientRect().bottom||0,scrollY:window.scrollY,scrollHeight:document.documentElement.scrollHeight,innerHeight};
    });
    assert.ok(layout.scrollHeight>layout.innerHeight,'Экран заказа должен прокручиваться');
    assert.ok(layout.contentBottom<=layout.dockTop-4,`Контент не должен прятаться за Продолжить: ${JSON.stringify(layout)}`);
    console.log('✅ mobile dock + manager + draft action');
  }finally{await context.close();}
}

// Date/time must render real dates and slots without the stale prelaunch error.
{
  const {context,page}=await setup({initialDraft:draft({step:6,date:'',time:''})});
  try{
    await page.locator('[data-resume-order]').waitFor({state:'visible'});
    await page.locator('[data-resume-order]').click();
    await page.getByText('Выберите дату и время',{exact:true}).waitFor({state:'visible'});
    await page.locator('[data-calendar-date]').first().waitFor({state:'visible'});
    assert.equal(await page.getByText(/предстартовую очистку/i).count(),0);
    await page.locator('[data-calendar-date]:not([disabled])').first().click();
    await page.locator('[data-time]:not([disabled])').first().waitFor({state:'visible'});
    await page.locator('[data-time]:not([disabled])').first().click();
    assert.equal(await page.locator('[data-next]').isDisabled(),false,'После выбора даты и времени Продолжить доступно');
    console.log('✅ schedule dates and slots');
  }finally{await context.close();}
}

// Admin panel must load instead of falling into the fatal screen.
{
  const {context,page}=await setup({admin:true});
  try{
    await page.locator('.hc-mobile-shell').waitFor({state:'visible'});
    await page.getByText('Сегодня',{exact:true}).first().waitFor({state:'visible'});
    assert.equal(await page.getByText('Не удалось открыть приложение').count(),0);
    console.log('✅ admin panel renders');
  }finally{await context.close();}
}

// New client function: share order action is available in order details.
{
  const {context,page}=await setup();
  try{
    await page.locator('#bottom-nav [data-route="orders"]').click();
    await page.locator('.u7-order-card-v3').first().waitFor({state:'visible'});
    await page.locator('.u7-order-card-v3').first().click();
    await page.locator('[data-share-order]').waitFor({state:'visible'});
    assert.match(await page.locator('[data-share-order]').textContent(),/Поделиться заявкой/);
    console.log('✅ share order action');
  }finally{await context.close();}
}

await browser.close();
console.log('\n✅ HOUSE CLEANING mobile flow v68 passed');
