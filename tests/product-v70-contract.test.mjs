import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(path,'utf8');

test('release 70 worker and assets are active',()=>{
  const wrangler=read('wrangler.jsonc');
  const html=read('public/index.html');
  assert.match(wrangler,/"main"\s*:\s*"src\/production-v70-product\.js"/);
  // Release 66 remains the stable clean-launch generation marker; v70 is
  // independently cache-busted by its own asset query versions.
  assert.match(html,/house-cleaning-release" content="66"/);
  assert.match(html,/product-v70\.css\?v=70/);
  assert.match(html,/booking-enhancements-v70\.js\?v=70/);
  assert.match(html,/app-release-v3\.js\?v=70/);
  assert.match(html,/repeat-order-v70\.js\?v=70/);
});

test('Telegram Open button is configured through Bot API',()=>{
  const worker=read('src/production-v70-product.js');
  assert.match(worker,/setChatMenuButton/);
  assert.match(worker,/text:\s*'Открыть'/);
  assert.match(worker,/https:\/\/bot\.housecleaningspb\.ru/);
  assert.match(worker,/X-Telegram-Bot-Api-Secret-Token/);
});

test('Android dates use horizontal scrolling and expose capacity',()=>{
  const css=read('public/product-v70.css');
  const js=read('public/js/booking-enhancements-v70.js');
  assert.match(css,/calendar-strip\[data-calendar\]/);
  assert.match(css,/overflow-x:auto!important/);
  assert.match(css,/touch-action:pan-x pan-y!important/);
  assert.match(js,/Занято \$\{Math\.round\(used\)\} м²/);
  assert.match(js,/Осталось \$\{Math\.round\(remaining\)\} м²/);
  assert.match(js,/Первая уборка/);
  assert.match(js,/Повторная уборка/);
});

test('photo feedback and one-tap repeat order are wired',()=>{
  const booking=read('public/js/booking-enhancements-v70.js');
  const repeat=read('public/js/repeat-order-v70.js');
  assert.match(booking,/Подготавливаем фото/);
  assert.match(booking,/state\.persistPhotos\(\)/);
  assert.match(repeat,/Повторить заказ/);
  assert.match(repeat,/visitType:\s*'repeat'/);
  assert.match(repeat,/photoRequired:\s*false/);
  assert.match(repeat,/step:\s*6/);
});

test('subscription creative is promotional and has no fake progress counters',()=>{
  const svg=read('public/assets/subscription-promo-v60.svg');
  assert.match(svg,/АБОНЕМЕНТ/);
  assert.match(svg,/5 или 10 уборок/);
  assert.doesNotMatch(svg,/8\s*\/\s*10/);
  assert.doesNotMatch(svg,/ОСТАЛОСЬ/);
  assert.doesNotMatch(svg,/ВЫПОЛНЕНО/);
});
