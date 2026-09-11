import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const flow = readFileSync('public/kp/kp-flow-v2.js', 'utf8');
const flowGuard = readFileSync('public/kp/kp-flow-guard-v2.js', 'utf8');
const css = readFileSync('public/kp/kp-flow-v2.css', 'utf8');
const renderer = readFileSync('public/kp/kp-ux-v12.js', 'utf8');
const worker = readFileSync('src/demo-worker-v19-kp-flow.js', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');

for (const label of ['Данные', 'Услуги', 'Условия', 'Проверка']) {
  assert.ok(flow.includes(label), `flow must contain step ${label}`);
}
assert.ok(flow.includes('data-progress-step="4"'), 'flow must have the fourth progress step');
assert.ok(!flow.includes('data-progress-step="5"'), 'flow must not introduce a fifth step');
assert.ok(flow.includes("document.getElementById('addItemBtn')?.classList.add('kp-flow-legacy-hidden')"), 'legacy add-service button must be hidden');
assert.ok(flow.includes('Из списка') && flow.includes('Своя услуга'), 'service modes must exist');
assert.ok(flow.includes('Добавить в КП'), 'single primary add action must be named Add to KP');
for (const unit of ['м²', 'шт.', 'усл. ед.', 'Другое']) {
  assert.ok(flow.includes(unit), `quick unit ${unit} must exist`);
}
assert.ok(flow.includes('guessUnit'), 'automatic unit suggestion must exist');
assert.ok(flow.includes('unitTouched'), 'manual unit choice must have priority over automatic suggestion');
assert.ok(flow.includes('Редактировать существующую') && flow.includes('Добавить отдельной строкой'), 'duplicate control must stay explicit');
assert.ok(flow.includes("fields.prepayment_percent.value = '0'"), 'repeat payment click must be able to reset to zero');
assert.ok(renderer.includes('Number(quote.prepayment_percent || 0) > 0'), 'PDF payment row must be conditional');
assert.ok(renderer.includes("? [['Условия оплаты:'"), 'payment row must render only when payment exists');
assert.ok(flowGuard.includes('KP_PDF_CANCELLED'), 'cancelled native PDF share must be detected');
assert.ok(flowGuard.includes('state.currentId && state.lastSaved?.id === state.currentId'), 'cancelled PDF share must preserve the current quote state');
assert.ok(worker.includes("const USED_PREFIX = 'kp:outgoing-used:v3:'"), 'permanent used-number ledger must exist');
assert.ok(worker.includes("const RESET_MARKER = 'kp:outgoing-reset-to-15:first5-v1'"), 'number guard must preserve the existing one-time start-at-15 marker');
assert.ok(worker.includes("url.pathname === '/kp/delete'"), 'delete flow must reserve the old outgoing number');
assert.ok(worker.includes('sequence <= highWater'), 'historically deleted numbers below the high-water mark must be blocked');
assert.ok(worker.includes('raiseCounterTo'), 'counter must only move forward');
assert.ok(worker.includes('sequence === currentSequence'), 'editing an existing KP must retain its own number');
assert.ok(worker.includes("./demo-worker-v18-client.js"), 'numbering worker must preserve current bot/referral worker as its base');
assert.ok(wrangler.includes('src/demo-worker-v19-kp-flow.js'), 'wrangler must point to the hardened KP worker');
assert.ok(!css.includes('visualViewport'), 'flow CSS must not depend on visualViewport');
assert.ok(!/\b(?:html|body)\s*\{[^}]*overflow\s*:\s*hidden/i.test(css), 'flow must not lock page scrolling');
assert.ok(!/document\.body\.style\.overflow|document\.documentElement\.style\.overflow/.test(flow), 'flow JS must not lock page scrolling');

console.log('KP flow contract checks passed');
