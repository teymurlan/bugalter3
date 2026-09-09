import assert from 'node:assert/strict';
import { calcLineTotal, calcQuote, makeQuoteNumber, moneyToWordsRu } from '../src/kp-math.js';

assert.equal(calcLineTotal('110,6', '480'), 53088);
assert.equal(calcLineTotal(92.9, 480), 44592);
assert.equal(calcLineTotal(7, 1300), 9100);
assert.equal(calcLineTotal(4, 1300), 5200);
assert.equal(calcLineTotal(203.5, 160), 32560);

const quote = calcQuote({
  items: [
    { name: 'Уборка после ремонта 1 этап', unit: 'м²', quantity: 110.6, price: 480 },
    { name: 'Уборка после ремонта 2 этап', unit: 'м²', quantity: 92.9, price: 480 },
    { name: 'Зеркала', unit: 'усл.', quantity: 1, price: 6000 },
    { name: 'Окна 1 этап', unit: 'шт', quantity: 7, price: 1300 },
    { name: 'Окна 2 этап', unit: 'шт', quantity: 4, price: 1300 },
    { name: 'Финишная уборка', unit: 'м²', quantity: 203.5, price: 160 },
  ],
  discount_percent: 0,
  prepayment_percent: 50,
});

assert.equal(quote.subtotal, 150540);
assert.equal(quote.total, 150540);
assert.equal(quote.prepayment, 75270);
assert.equal(quote.balance, 75270);
assert.equal(moneyToWordsRu(150540), 'Сто пятьдесят тысяч пятьсот сорок рублей 00 копеек.');
assert.equal(makeQuoteNumber(2026, 1), 'HC-2026-001');
assert.equal(makeQuoteNumber(2026, 27), 'HC-2026-027');

const discounted = calcQuote({
  items: [{ name: 'Работы', unit: 'усл.', quantity: 1, price: 100000 }],
  discount_percent: 5,
  prepayment_percent: 50,
});
assert.equal(discounted.discount, 5000);
assert.equal(discounted.total, 95000);
assert.equal(discounted.prepayment, 47500);
assert.equal(discounted.balance, 47500);

console.log('KP math tests passed');
