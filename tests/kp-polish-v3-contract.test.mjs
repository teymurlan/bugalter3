import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('public/kp/kp-polish-v3.js', 'utf8');
const css = readFileSync('public/kp/kp-polish-v3.css', 'utf8');
const loader = readFileSync('public/kp/kp-ux-v13.js', 'utf8');
const html = readFileSync('public/kp/index.html', 'utf8');

assert.ok(js.includes("button.textContent = 'Предпросмотр'"), 'review step must expose preview');
assert.ok(js.includes('await previewCurrent()'), 'preview must call non-publishing preview flow');
assert.ok(js.includes("modalPdf.textContent = 'Создать / Скачать КП'"), 'preview modal must keep final create/download action');
assert.ok(js.includes("document.body.classList.add('kp-view-editor')"), 'editor/history views must be separated');
assert.ok(js.includes("button.dataset.nav === 'history'"), 'history navigation must open a separate view');
assert.ok(js.includes('Найти услугу'), 'service search must exist');
assert.ok(js.includes('Коммерческое помещение'), 'commercial category must exist');
assert.ok(js.includes('Уборка офиса') && js.includes('Мойка витрин') && js.includes('Очистка кафеля'), 'expanded catalog must contain new services');
assert.ok(js.includes('CATEGORY_ALIASES'), 'search aliases must exist');
assert.ok(js.includes("element.style.fontSize = '16px'"), 'dynamic inputs must be protected from iOS focus zoom');
assert.ok(css.includes('font-size:16px!important'), 'form controls must stay at 16px on iPhone');
assert.ok(css.includes('body.kp-view-editor .history-panel{display:none!important}'), 'history must not remain below the editor');
assert.ok(!css.includes('visualViewport'), 'polish must not depend on visualViewport');
assert.ok(!/\b(?:html|body)\s*\{[^}]*overflow\s*:\s*hidden/i.test(css), 'polish must not lock vertical page scrolling');
assert.ok(!/document\.body\.style\.overflow|document\.documentElement\.style\.overflow/.test(js), 'polish JS must not lock scrolling');
assert.ok(loader.includes('/kp/kp-polish-v3.js?v=3'), 'loader must load polish JS last');
assert.ok(loader.includes('/kp/kp-polish-v3.css?v=3'), 'loader must load polish CSS');
assert.ok(html.includes('/kp/kp-ux-v13.js?v=19'), 'index must bust Telegram cache for new loader');

console.log('KP polish v3 contract checks passed');
