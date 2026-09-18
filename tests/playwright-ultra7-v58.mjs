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

const orders=[
  {
    id:1,order_number:'HC-U58-0001',display_number:1,status:'COMPLETED',
    service_id:2,service_name:'Поддерживающая уборка',property_type:'apartment',
    area:50,rooms:2,bathrooms:1,pets:false,addon_ids:[],city:'Санкт-Петербург',
    address:'Дыбенко, 5',apartment:'315',date:moscowDay(-7),time:'11:00',
    customer_name:'Ultra Client',phone:'+79990000000',contact_method:'telegram',
    created_at:new Date(Date.now()-8*86400000).toISOString(),updated_at:new Date(Date.now()-7*86400000).toISOString(),
  },
  {
    id:2,order_number:'HC-U58-0002',display_number:2,status:'CONFIRMED',
    service_id:1,service_name:'Генеральная уборка',property_type:'apartment',
    area:60,rooms:2,bathrooms:1,pets:false,addon_ids:[],city:'Санкт-Петербург',
    address:'Невский проспект, 10',apartment:'12',date:moscowDay(1),time:'12:00',
    customer_name:'Ultra Client',phone:'+79990000000',contact_method:'telegram',
    estimated_price:13800,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
  },
];

function telegramStub(){
  return `window.Telegram={WebApp:{initData:'query_id=ultra58',initDataUnsafe:{user:{id:780058,first_name:'Ultra'}},ready(){},expand(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},openTelegramLink(){},HapticFeedback:{selectionChanged(){},impactOccurred(){},notificationOccurred(){}}}};`;
}

async function createApp(){
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
    if(path==='/api/client-profile') return json({ok:true,profile:{telegram_id:780058,name:'Ultra Client',phone:'+79990000000',cleanings_remaining:4,cleanings_total:10}});
    if(path==='/api/demo-client-orders') return json({ok:true,orders});
    if(path==='/api/demo-client-order'){
      const number=url.searchParams.get('order');
      return json({ok:true,order:orders.find(item=>item.order_number===number)||null});
    }
    if(path==='/api/client-benefits') return json({ok:true,selected_percent:0,referral_percent:0});
    if(path==='/api/demo-review') return json({ok:true,review:{}});
    if(path==='/api/manager-contact') return json({ok:true,telegram_id:780058});
    if(path==='/api/client-notification-settings') return json({ok:true,settings:{confirmed:true,reminder:true,completed:true,review:true,marketing:true}});
    if(path==='/api/demo-availability'){
      const slots=Array.from({length:10},(_,i)=>({time:`${String(i+9).padStart(2,'0')}:00`,available:true}));
      return json({ok:true,date:url.searchParams.get('date'),capacityM2:300,usedM2:0,remainingM2:300,closed:false,slots,source:'server'});
    }
    return json({ok:true});
  });

  const page=await context.newPage();
  await page.goto(`${BASE_URL}/?demo=1`,{waitUntil:'domcontentloaded'});
  await page.locator('.u7-home-v2').waitFor({state:'visible'});
  return {context,page};
}

function rgb(value){
  const numbers=String(value).match(/[\d.]+/g)?.slice(0,3).map(Number)||[];
  return numbers.length===3?numbers:null;
}
function luminance([r,g,b]){
  const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};
  return .2126*f(r)+.7152*f(g)+.0722*f(b);
}
function contrast(a,b){
  const A=luminance(a),B=luminance(b);
  return (Math.max(A,B)+.05)/(Math.min(A,B)+.05);
}

const {context,page}=await createApp();
try{
  assert.equal(await page.getByText('Повторить уборку',{exact:true}).count(),1);
  assert.equal(await page.getByText('Мои данные',{exact:true}).count(),1);
  assert.match(await page.locator('.u7-home-summary').textContent(),/Осталось\s*4/);

  for(const theme of ['light','dark','blue']){
    await page.evaluate(t=>window.HCUltraTheme.set(t),theme);
    const values=await page.locator('.hc-home-order-card-v54').first().evaluate(card=>{
      const title=card.querySelector(':scope > strong');
      return {
        cardBg:getComputedStyle(card).backgroundColor,
        title:getComputedStyle(title).color,
        bodyBg:getComputedStyle(document.body).backgroundColor,
        bodyText:getComputedStyle(document.body).color,
      };
    });
    const cardBg=rgb(values.cardBg),title=rgb(values.title),bodyBg=rgb(values.bodyBg),bodyText=rgb(values.bodyText);
    console.log('THEME',theme,values,'contrast',cardBg&&title?contrast(cardBg,title):null,bodyBg&&bodyText?contrast(bodyBg,bodyText):null);
    assert.ok(cardBg&&title&&contrast(cardBg,title)>=4.2,`${theme}: текст карточки должен читаться`);
    assert.ok(bodyBg&&bodyText&&contrast(bodyBg,bodyText)>=4.2,`${theme}: основной текст должен читаться`);
  }

  await page.evaluate(()=>window.HCUltraTheme.set('light'));
  const recent=page.locator('[data-home-order]').first();
  await recent.scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>window.scrollY);
  await recent.click();
  await page.locator('.cc-detail-head').waitFor({state:'visible'});
  await page.locator('[data-back]').click();
  await page.locator('.u7-home-v2').waitFor({state:'visible'});
  await page.waitForTimeout(120);
  const after=await page.evaluate(()=>window.scrollY);
  assert.ok(Math.abs(after-before)<100,`Назад должен вернуть позицию: ${before} -> ${after}`);

  await page.locator('[data-repeat-order]').click();
  await page.locator('.hc-calendar-v2').waitFor({state:'visible'});
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),DRAFT_KEY);
  assert.equal(saved.step,6);
  assert.equal(saved.visitType,'repeat');
  assert.equal(saved.photoRequired,false);
  assert.equal(saved.address,'Дыбенко, 5');

  await page.screenshot({path:'playwright-ultra7-v58-client.png',fullPage:true});
  console.log('✅ Ultra 7.1: themes, back history and repeat order');
}finally{
  await context.close();
  await browser.close();
}
