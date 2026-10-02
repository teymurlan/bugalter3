import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport:{ width:390, height:760 },
  isMobile:true,
  hasTouch:true,
  deviceScaleFactor:2.75,
  userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  locale:'ru-RU',
  timezoneId:'Europe/Moscow',
});

const draft = {
  step:6, serviceId:1, propertyType:'apartment', area:80, rooms:2, bathrooms:1, pets:false,
  addonIds:[], serviceArea:'spb', city:'Санкт-Петербург', address:'Невский проспект 10', apartment:'12',
  entrance:'', floor:'', addressComment:'', visitType:'repeat', visitTypeConfirmed:true, photoRequired:false,
  knownAddress:true, date:'', time:'', customerName:'Android Client', phone:'+79990000000', contactMethod:'telegram',
  comment:'', idempotencyKey:'v70-android-booking-test'
};

await context.addInitScript((draftValue) => {
  localStorage.setItem('hc-clean-start-generation','v66-final-launch');
  localStorage.setItem('hc:first-run-onboarding:v1','done');
  localStorage.setItem('hc-booking-draft-v2',JSON.stringify(draftValue));
  localStorage.setItem('hc-demo-orders-v3','[]');
}, draft);

await context.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
  status:200,
  contentType:'application/javascript; charset=utf-8',
  body:`window.Telegram={WebApp:{platform:'android',initData:'query_id=v70-android',initDataUnsafe:{user:{id:700070,first_name:'Android'}},ready(){},expand(){},disableVerticalSwipes(){},enableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},openTelegramLink(){},HapticFeedback:{selectionChanged(){},impactOccurred(){},notificationOccurred(){}}}};`,
}));

await context.route('**/api/**', async route => {
  const request=route.request();
  const url=new URL(request.url());
  const path=url.pathname;
  const method=request.method();
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json; charset=utf-8',body:JSON.stringify(body)});
  if(path==='/api/demo-config') return json({adminConfigured:true,reminder24hReady:true});
  if(path==='/api/client-draft') return json(method==='GET'?{ok:true,draft:null}:{ok:true});
  if(path==='/api/client-profile') return json({ok:true,profile:{telegram_id:700070,name:'Android Client'}});
  if(path==='/api/demo-client-orders') return json({ok:true,orders:[]});
  if(path==='/api/client-benefits') return json({ok:true,selected_percent:0});
  if(path==='/api/demo-review') return json({ok:true,review:null});
  if(path==='/api/demo-known-address') return json({ok:true,known:true});
  if(path==='/api/demo-availability') {
    const date=url.searchParams.get('date');
    const dayNumber=Number(String(date||'').slice(-2))||0;
    const used=(dayNumber%4)*35;
    const remaining=Math.max(0,300-used);
    return json({
      ok:true,date,capacityM2:300,usedM2:used,remainingM2:remaining,closed:remaining<=0,source:'server',
      slots:Array.from({length:10},(_,i)=>({time:`${String(i+9).padStart(2,'0')}:00`,available:remaining>0}))
    });
  }
  return json({ok:true});
});

const page=await context.newPage();
await page.goto(`${BASE_URL}/?demo=1&release=70`,{waitUntil:'domcontentloaded'});
await page.locator('[data-resume-order]').waitFor({state:'visible'});
await page.locator('[data-resume-order]').click();
await page.locator('.calendar-strip[data-calendar]').waitFor({state:'visible'});
await page.waitForTimeout(500);

const before=await page.locator('.calendar-strip[data-calendar]').evaluate(node=>({
  left:node.scrollLeft,
  width:node.clientWidth,
  scrollWidth:node.scrollWidth,
  touch:getComputedStyle(node).touchAction,
  overflow:getComputedStyle(node).overflowX,
  cards:node.querySelectorAll('[data-calendar-date]').length,
  text:node.querySelector('[data-calendar-date]')?.textContent||'',
}));

assert.ok(before.cards>=8,`Ожидалось несколько дат, получено ${before.cards}`);
assert.ok(before.scrollWidth>before.width+200,`Лента дат должна быть шире экрана: ${before.scrollWidth}/${before.width}`);
assert.match(before.overflow,/auto|scroll/);
assert.match(before.touch,/pan-x|auto/);
assert.match(before.text,/Занято\s+\d+\s*м²/);
assert.match(before.text,/Осталось\s+\d+\s*м²/);

const box=await page.locator('.calendar-strip[data-calendar]').boundingBox();
assert.ok(box,'Не удалось получить координаты ленты дат');
const y=Math.round(box.y+Math.min(box.height/2,65));
const fromX=Math.round(box.x+box.width-28);
const toX=Math.round(box.x+32);
const cdp=await context.newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:fromX,y}]});
for(let x=fromX-35;x>=toX;x-=35){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});
  await page.waitForTimeout(22);
}
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await page.waitForTimeout(300);

const after=await page.locator('.calendar-strip[data-calendar]').evaluate(node=>node.scrollLeft);
assert.ok(after>35,`Android горизонтальный свайп должен менять scrollLeft, получено ${after}`);

await page.screenshot({path:'playwright-booking-v70.png',fullPage:false});
console.log(`✅ Release 70 Android date rail works, scrollLeft=${after}; capacity labels visible`);
await context.close();
await browser.close();
