export function roundMoney(value) {
  const n = Number(value || 0);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function normalizeQty(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1000) / 1000;
}

export function normalizePrice(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundMoney(n);
}

export function calcLineTotal(quantity, price) {
  const qtyScaled = Math.round(normalizeQty(quantity) * 1000);
  const priceKopecks = Math.round(normalizePrice(price) * 100);
  return Math.round((qtyScaled * priceKopecks) / 1000) / 100;
}

export function calcQuote(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const normalizedItems = items
    .map((item) => {
      const quantity = normalizeQty(item?.quantity);
      const price = normalizePrice(item?.price);
      const total = calcLineTotal(quantity, price);
      return {
        name: String(item?.name || '').trim(),
        unit: String(item?.unit || 'усл.').trim() || 'усл.',
        quantity,
        price,
        total,
      };
    })
    .filter((item) => item.name && item.quantity >= 0 && item.price >= 0);

  const subtotal = roundMoney(normalizedItems.reduce((sum, item) => sum + item.total, 0));
  const discountPercentRaw = Number(String(input.discount_percent ?? 0).replace(',', '.'));
  const discountPercent = Number.isFinite(discountPercentRaw)
    ? Math.min(100, Math.max(0, Math.round(discountPercentRaw * 100) / 100))
    : 0;
  const discount = roundMoney(subtotal * discountPercent / 100);
  const total = roundMoney(Math.max(0, subtotal - discount));

  const prepaymentPercentRaw = Number(String(input.prepayment_percent ?? 0).replace(',', '.'));
  const prepaymentPercent = Number.isFinite(prepaymentPercentRaw)
    ? Math.min(100, Math.max(0, Math.round(prepaymentPercentRaw * 100) / 100))
    : 0;
  const prepayment = roundMoney(total * prepaymentPercent / 100);
  const balance = roundMoney(total - prepayment);

  return {
    items: normalizedItems,
    subtotal,
    discount_percent: discountPercent,
    discount,
    total,
    prepayment_percent: prepaymentPercent,
    prepayment,
    balance,
  };
}

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function declension(n, forms) {
  const value = Math.abs(n) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

function triadWords(value, feminine = false) {
  let n = Math.floor(value) % 1000;
  if (!n) return '';
  const words = [];
  const hundreds = Math.floor(n / 100);
  if (hundreds) words.push(HUNDREDS[hundreds]);
  n %= 100;
  if (n >= 10 && n <= 19) {
    words.push(TEENS[n - 10]);
    return words.join(' ');
  }
  const tens = Math.floor(n / 10);
  if (tens) words.push(TENS[tens]);
  const ones = n % 10;
  if (ones) words.push((feminine ? ONES_F : ONES_M)[ones]);
  return words.join(' ');
}

export function integerToWordsRu(value) {
  let n = Math.max(0, Math.floor(Number(value || 0)));
  if (n === 0) return 'ноль';
  const parts = [];

  const millions = Math.floor(n / 1000000);
  if (millions) {
    parts.push(triadWords(millions));
    parts.push(declension(millions, ['миллион', 'миллиона', 'миллионов']));
  }

  const thousands = Math.floor((n % 1000000) / 1000);
  if (thousands) {
    parts.push(triadWords(thousands, true));
    parts.push(declension(thousands, ['тысяча', 'тысячи', 'тысяч']));
  }

  const rest = n % 1000;
  if (rest) parts.push(triadWords(rest));
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function moneyToWordsRu(value) {
  const normalized = roundMoney(Math.max(0, Number(value || 0)));
  const rubles = Math.floor(normalized);
  const kopecks = Math.round((normalized - rubles) * 100);
  const words = integerToWordsRu(rubles);
  const rubleForm = declension(rubles, ['рубль', 'рубля', 'рублей']);
  const kopeckForm = declension(kopecks, ['копейка', 'копейки', 'копеек']);
  const first = words.charAt(0).toUpperCase() + words.slice(1);
  return `${first} ${rubleForm} ${String(kopecks).padStart(2, '0')} ${kopeckForm}.`;
}

export function makeQuoteNumber(year, sequence) {
  const safeYear = Number(year) || new Date().getFullYear();
  const safeSequence = Math.max(1, Math.floor(Number(sequence) || 1));
  return `HC-${safeYear}-${String(safeSequence).padStart(3, '0')}`;
}
