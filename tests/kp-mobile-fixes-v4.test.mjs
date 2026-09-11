import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('public/kp/kp-mobile-fixes-v4.js', 'utf8');
const css = readFileSync('public/kp/kp-mobile-fixes-v4.css', 'utf8');
const loader = readFileSync('public/kp/kp-ux-v13.js', 'utf8');
const html = readFileSync('public/kp/index.html', 'utf8');
const worker = readFileSync('src/demo-worker-v20-mobile-fixes.js', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');

assert.ok(js.includes("scrollIntoView({ block: 'center'"), 'service field must be brought above the iOS keyboard accessory');
assert.ok(js.includes('setTimeout(bringIntoView, 420)'), 'service field must be repositioned after keyboard settles');
assert.ok(js.includes("await api('/api/kp/bootstrap')"), 'next outgoing number must refresh after form reset');
assert.ok(js.includes('resetFormWithFreshOutgoingNumber'), 'form reset must fetch the fresh sequence number');
assert.ok(!js.includes('visualViewport'), 'keyboard fix must not use visualViewport');
assert.ok(!js.includes('style.overflow'), 'keyboard fix must not lock page scrolling');
assert.ok(css.includes('#kpFlowPresetOptions .kp-flow-preset-option>span{font-size:15.5px!important'), 'service names must be larger');
assert.ok(css.includes('.kp-flow-step-head h2{font-size:22px!important'), 'flow headings must be slightly larger');
assert.ok(css.includes('font-weight:700!important'), 'readability layer must increase text weight');
assert.ok(loader.includes('/kp/kp-mobile-fixes-v4.js?v=1'), 'mobile fix JS must load last');
assert.ok(loader.includes('/kp/kp-mobile-fixes-v4.css?v=1'), 'mobile fix CSS must load last');
assert.ok(html.includes('/kp/kp-ux-v13.js?v=21'), 'index must bust Telegram cache');
assert.ok(worker.includes('await txn.put(OUTGOING_COUNTER_KEY, OUTGOING_START - 1)'), 'outgoing sequence must restart so next number is 15');
assert.ok(worker.includes("HARD_RESET_MARKER = 'kp:outgoing-hard-reset-to-15:mobile-v4'"), 'outgoing reset must be one-time');
assert.ok(worker.includes("url.pathname === '/kp/peek-number'"), 'bootstrap number lookup must apply the one-time reset');
assert.ok(worker.includes('requested === counter + 1'), 'displayed next number must be treated as automatic, not a manual duplicate');
assert.ok(wrangler.includes('src/demo-worker-v20-mobile-fixes.js'), 'wrangler must deploy the mobile fixes worker');

console.log('KP mobile fixes v4 checks passed');
