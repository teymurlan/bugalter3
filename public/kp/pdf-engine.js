export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function calculateTotals(items, discountPercent = 0, prepaymentPercent = 50) {
  const normalized = (Array.isArray(items) ? items : []).map((item) => {
    const quantity = Math.max(0, Number(item.quantity || 0));
    const price = Math.max(0, Number(item.price || 0));
    const amountKopecks = Math.round(quantity * price * 100);
    return { ...item, quantity, price, amount: amountKopecks / 100 };
  });
  const subtotalKopecks = normalized.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
  const safeDiscount = Math.min(100, Math.max(0, Number(discountPercent || 0)));
  const discountKopecks = Math.round(subtotalKopecks * safeDiscount / 100);
  const totalKopecks = Math.max(0, subtotalKopecks - discountKopecks);
  const safePrepayment = Math.min(100, Math.max(0, Number(prepaymentPercent || 0)));
  const prepaymentKopecks = Math.round(totalKopecks * safePrepayment / 100);
  return {
    items: normalized,
    subtotal: subtotalKopecks / 100,
    discount_percent: safeDiscount,
    discount_amount: discountKopecks / 100,
    total: totalKopecks / 100,
    prepayment_percent: safePrepayment,
    prepayment_amount: prepaymentKopecks / 100,
    balance_amount: (totalKopecks - prepaymentKopecks) / 100,
  };
}

export function money(value) {
  return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(roundMoney(value))} ₽`;
}

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function plural(n, forms) {
  const n100 = Math.abs(n) % 100;
  const n10 = n100 % 10;
  if (n100 >= 11 && n100 <= 19) return forms[2];
  if (n10 === 1) return forms[0];
  if (n10 >= 2 && n10 <= 4) return forms[1];
  return forms[2];
}

function tripletWords(value, female = false) {
  let n = Math.floor(value) % 1000;
  const out = [];
  const h = Math.floor(n / 100);
  if (h) out.push(HUNDREDS[h]);
  n %= 100;
  if (n >= 10 && n <= 19) {
    out.push(TEENS[n - 10]);
    return out;
  }
  const t = Math.floor(n / 10);
  if (t) out.push(TENS[t]);
  const o = n % 10;
  if (o) out.push((female ? ONES_F : ONES_M)[o]);
  return out;
}

export function rublesToWords(value) {
  const numeric = Math.max(0, roundMoney(value));
  const rubles = Math.floor(numeric);
  const kopecks = Math.round((numeric - rubles) * 100) % 100;
  if (rubles > 999999999) return `${money(numeric)}`;
  const words = [];
  const millions = Math.floor(rubles / 1000000) % 1000;
  const thousands = Math.floor(rubles / 1000) % 1000;
  const units = rubles % 1000;
  if (millions) {
    words.push(...tripletWords(millions, false));
    words.push(plural(millions, ['миллион', 'миллиона', 'миллионов']));
  }
  if (thousands) {
    words.push(...tripletWords(thousands, true));
    words.push(plural(thousands, ['тысяча', 'тысячи', 'тысяч']));
  }
  if (units) words.push(...tripletWords(units, false));
  if (!rubles) words.push('ноль');
  words.push(plural(rubles, ['рубль', 'рубля', 'рублей']));
  const phrase = words.join(' ');
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} ${String(kopecks).padStart(2, '0')} коп.`;
}

function textBytes(text) {
  return new TextEncoder().encode(text);
}

function base64ToBytes(dataUrl) {
  const base64 = String(dataUrl).split(',').pop() || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function buildImagePdf(jpegDataUrls, imageWidth, imageHeight) {
  const pages = (Array.isArray(jpegDataUrls) ? jpegDataUrls : []).map(base64ToBytes);
  if (!pages.length) throw new Error('Нет страниц для PDF');
  const pageWidth = 595.276;
  const pageHeight = 841.89;
  const objectCount = 2 + pages.length * 3;
  const objects = new Array(objectCount + 1);
  const pageRefs = [];
  let objectId = 3;

  for (let i = 0; i < pages.length; i += 1) {
    const pageId = objectId++;
    const imageId = objectId++;
    const contentId = objectId++;
    pageRefs.push(`${pageId} 0 R`);
    const imageName = `Im${i + 1}`;
    objects[pageId] = textBytes(`<< /Type /Page /Parent 2 0 R /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R >>`);
    const imgHeader = textBytes(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pages[i].length} >>\nstream\n`);
    const imgFooter = textBytes('\nendstream');
    const imageObj = new Uint8Array(imgHeader.length + pages[i].length + imgFooter.length);
    imageObj.set(imgHeader, 0);
    imageObj.set(pages[i], imgHeader.length);
    imageObj.set(imgFooter, imgHeader.length + pages[i].length);
    objects[imageId] = imageObj;
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ`;
    objects[contentId] = textBytes(`<< /Length ${textBytes(content).length} >>\nstream\n${content}\nendstream`);
  }

  objects[1] = textBytes('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = textBytes(`<< /Type /Pages /Count ${pages.length} /Kids [${pageRefs.join(' ')}] >>`);

  const chunks = [];
  let offset = 0;
  const push = (chunk) => { chunks.push(chunk); offset += chunk.length; };
  push(new Uint8Array([0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x34,0x0A,0x25,0xE2,0xE3,0xCF,0xD3,0x0A]));
  const offsets = new Array(objectCount + 1).fill(0);
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = offset;
    push(textBytes(`${id} 0 obj\n`));
    push(objects[id]);
    push(textBytes('\nendobj\n'));
  }
  const xrefOffset = offset;
  push(textBytes(`xref\n0 ${objectCount + 1}\n`));
  push(textBytes('0000000000 65535 f \n'));
  for (let id = 1; id <= objectCount; id += 1) {
    push(textBytes(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`));
  }
  push(textBytes(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return new Blob(chunks, { type: 'application/pdf' });
}
