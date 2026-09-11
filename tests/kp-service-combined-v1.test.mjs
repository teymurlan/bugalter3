import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('public/kp/kp-service-combined-v1.js', 'utf8');
const css = readFileSync('public/kp/kp-service-combined-v1.css', 'utf8');
const loader = readFileSync('public/kp/kp-ux-v13.js', 'utf8');
const html = readFileSync('public/kp/index.html', 'utf8');

assert.ok(js.includes('Найти и выбрать услугу'), 'search and selection must be one control');
assert.ok(js.includes("picker.setAttribute('aria-hidden', 'true')"), 'legacy separate picker must be visually retired');
assert.ok(js.includes("search.value = String(preset.name || '')"), 'selected service must be shown in the combined field');
assert.ok(css.includes('#kpFlowPresetPicker{display:none!important}'), 'separate picker must be hidden');
assert.ok(css.includes('min-height:58px!important'), 'service result rows must be larger and easier to read');
assert.ok(css.includes('font-size:14px!important'), 'service names must use a larger readable font');
assert.ok(loader.includes('/kp/kp-service-combined-v1.js?v=1'), 'combined picker JS must load last');
assert.ok(loader.includes('/kp/kp-service-combined-v1.css?v=1'), 'combined picker CSS must load');
assert.ok(html.includes('/kp/kp-ux-v13.js?v=20'), 'index must bust Telegram cache');

console.log('KP combined service picker checks passed');
