import { state, COMPANY, calcQuote, money, formatDate, formatNumber } from './core.js';

const PW = 1240, PH = 1754, M = 76;
const GOLD = '#D99A14', GOLD2 = '#F5B91B', INK = '#202020', MUTED = '#6E6A63';

function newCanvas() {
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH); x.textBaseline = 'top';
  return { c, x };
}
function font(ctx, size, weight = 400, family = 'Arial') { ctx.font = `${weight} ${size}px ${family}`; }
function wrap(ctx, value, maxWidth) {
  const lines = [];
  for (const paragraph of String(value ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}
function text(ctx, value, x, y, maxWidth, size = 28, weight = 400, color = INK, lineHeight = Math.round(size * 1.28), align = 'left') {
  font(ctx, size, weight); ctx.fillStyle = color; ctx.textAlign = align;
  const lines = wrap(ctx, value, maxWidth); let yy = y;
  for (const line of lines) { ctx.fillText(line, x, yy); yy += lineHeight; }
  ctx.textAlign = 'left'; return yy;
}
function roundedImage(ctx, img, x, y, w, h, r = 16) {
  if (!img) return;
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); ctx.drawImage(img, x, y, w, h); ctx.restore();
}
function drawHeader(ctx, q, continued = false) {
  if (state.logo) roundedImage(ctx, state.logo, M, 54, 245, 128);
  else { ctx.fillStyle = '#222'; ctx.fillRect(M, 54, 245, 128); font(ctx, 34, 900); ctx.fillStyle = GOLD2; ctx.fillText('HC', M + 94, 95); }

  const rx = PW - M;
  font(ctx, 23, 700); ctx.fillStyle = INK; ctx.textAlign = 'right'; ctx.fillText(COMPANY.name, rx, 56);
  font(ctx, 18, 400); ctx.fillStyle = MUTED; ctx.fillText(`ИНН ${COMPANY.inn}`, rx, 91); ctx.fillText(`ОГРНИП ${COMPANY.ogrnip}`, rx, 117);
  text(ctx, COMPANY.address, rx, 143, 520, 18, 400, MUTED, 23, 'right'); ctx.textAlign = 'left';

  ctx.fillStyle = GOLD; ctx.fillRect(M, 205, PW - M * 2, 4);
  font(ctx, 18, 800); ctx.fillStyle = GOLD;
  ctx.fillText(continued ? 'ПРОДОЛЖЕНИЕ КОММЕРЧЕСКОГО ПРЕДЛОЖЕНИЯ' : 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', M, 234);
  font(ctx, 22, 900); ctx.fillStyle = INK; ctx.textAlign = 'right'; ctx.fillText(`№ ${q.quote_number}`, rx, 230); ctx.textAlign = 'left';
  return 280;
}
function drawTableHeader(ctx, y) {
  ctx.fillStyle = '#262626'; ctx.fillRect(M, y, PW - M * 2, 52);
  const cols = [M, M + 58, M + 650, M + 770, M + 890, M + 1030, PW - M];
  const labels = ['№', 'Наименование услуг', 'Ед.', 'Кол-во', 'Цена, ₽', 'Сумма, ₽'];
  font(ctx, 17, 800); ctx.fillStyle = '#fff';
  for (let i = 0; i < labels.length; i += 1) {
    const cx = (cols[i] + cols[i + 1]) / 2;
    ctx.textAlign = i === 1 ? 'left' : 'center'; ctx.fillText(labels[i], i === 1 ? cols[i] + 12 : cx, y + 16);
  }
  ctx.textAlign = 'left'; return { y: y + 52, cols };
}
function drawRow(ctx, item, index, y, cols) {
  font(ctx, 19, 500); const nameLines = wrap(ctx, item.name, cols[2] - cols[1] - 24);
  const rowHeight = Math.max(60, nameLines.length * 25 + 24);
  ctx.strokeStyle = '#CFC6B5'; ctx.lineWidth = 1; ctx.strokeRect(M, y, PW - M * 2, rowHeight);
  for (let i = 1; i < cols.length - 1; i += 1) { ctx.beginPath(); ctx.moveTo(cols[i], y); ctx.lineTo(cols[i], y + rowHeight); ctx.stroke(); }

  font(ctx, 18, 500); ctx.fillStyle = INK; ctx.textAlign = 'center';
  ctx.fillText(String(index + 1), (cols[0] + cols[1]) / 2, y + 18);
  ctx.textAlign = 'left'; let nameY = y + 15;
  for (const line of nameLines) { ctx.fillText(line, cols[1] + 12, nameY); nameY += 25; }
  ctx.textAlign = 'center'; ctx.fillText(item.unit || '—', (cols[2] + cols[3]) / 2, y + 18);
  ctx.fillText(item.mode === 'fixed' ? '—' : formatNumber(item.quantity), (cols[3] + cols[4]) / 2, y + 18);
  ctx.textAlign = 'right'; ctx.fillText(item.mode === 'fixed' ? '—' : formatNumber(item.unit_price), cols[5] - 12, y + 18);
  ctx.fillText(formatNumber(item.amount), cols[6] - 12, y + 18); ctx.textAlign = 'left';
  return rowHeight;
}
function drawFooter(page, index, count) {
  const ctx = page.getContext('2d');
  ctx.fillStyle = GOLD; ctx.fillRect(M, PH - 54, PW - M * 2, 2);
  font(ctx, 15, 700); ctx.fillStyle = MUTED;
  ctx.fillText('HOUSE CLEANING · САНКТ-ПЕТЕРБУРГ И ЛЕНИНГРАДСКАЯ ОБЛАСТЬ', M, PH - 40);
  ctx.textAlign = 'right'; ctx.fillText(`${index + 1} / ${count}`, PW - M, PH - 40); ctx.textAlign = 'left';
}

export function buildQuoteCanvases(raw) {
  const q = calcQuote(raw); const pages = [];
  let { c, x } = newCanvas(); pages.push(c); let y = drawHeader(x, q, false);
  font(x, 34, 900); x.fillStyle = INK; x.fillText('Уборка жилого помещения / объекта', M, y); y += 55;

  const meta = [['Клиент', q.client_name], ['Объект', q.object_type], ['Адрес', q.object_address], ['Дата КП', formatDate(q.offer_date)]];
  for (const [key, value] of meta) {
    font(x, 17, 800); x.fillStyle = GOLD; x.fillText(key.toUpperCase(), M, y);
    y = text(x, value, M + 170, y - 2, PW - M * 2 - 170, 20, 600, INK, 26); y += 9;
  }

  y += 10; let th = drawTableHeader(x, y); y = th.y; let cols = th.cols;
  q.items.forEach((item, index) => {
    font(x, 19, 500); const h = Math.max(60, wrap(x, item.name, cols[2] - cols[1] - 24).length * 25 + 24);
    if (y + h > PH - 360) {
      ({ c, x } = newCanvas()); pages.push(c); y = drawHeader(x, q, true); th = drawTableHeader(x, y); y = th.y; cols = th.cols;
    }
    y += drawRow(x, item, index, y, cols);
  });

  const needed = 390 + (q.notes ? 90 : 0);
  if (y + needed > PH - 90) { ({ c, x } = newCanvas()); pages.push(c); y = drawHeader(x, q, true); }

  y += 26; const boxW = 480; const bx = PW - M - boxW;
  font(x, 18, 600); x.fillStyle = MUTED; x.textAlign = 'right'; x.fillText('Стоимость работ', bx + boxW - 18, y + 16);
  font(x, 22, 800); x.fillStyle = INK; x.fillText(money(q.subtotal), bx + boxW - 18, y + 46);
  if (q.discount_amount) {
    font(x, 17, 600); x.fillStyle = MUTED; x.fillText(`Скидка ${formatNumber(q.discount_percent)}%`, bx + boxW - 18, y + 82);
    font(x, 19, 800); x.fillStyle = '#9B3C34'; x.fillText(`− ${money(q.discount_amount)}`, bx + boxW - 18, y + 108);
  }
  const gy = y + (q.discount_amount ? 145 : 92);
  x.fillStyle = '#262626'; x.fillRect(bx, gy, boxW, 92);
  font(x, 20, 800); x.fillStyle = '#F1D28A'; x.textAlign = 'left'; x.fillText('ИТОГО', bx + 22, gy + 20);
  font(x, 31, 900); x.fillStyle = '#fff'; x.textAlign = 'right'; x.fillText(money(q.total), bx + boxW - 22, gy + 17);
  font(x, 15, 600); x.fillStyle = '#D7D0C2'; x.fillText('без НДС', bx + boxW - 22, gy + 57); x.textAlign = 'left';

  y = gy + 125; font(x, 18, 800); x.fillStyle = INK; x.fillText('УСЛОВИЯ', M, y); y += 38;
  y = text(x, `Срок выполнения работ: ${q.work_deadline || 'по согласованию'}.`, M, y, PW - M * 2, 19, 500, INK, 26) + 8;
  y = text(x, `Условия оплаты: предоплата ${formatNumber(q.prepayment_percent)}% (${money(q.prepayment_amount)}), остаток ${money(q.balance_amount)}.`, M, y, PW - M * 2, 19, 500, INK, 26) + 8;
  y = text(x, `Срок действия коммерческого предложения: до ${formatDate(q.valid_until)}.`, M, y, PW - M * 2, 19, 500, INK, 26) + 8;
  if (q.notes) y = text(x, `Дополнительные условия: ${q.notes}`, M, y, PW - M * 2, 18, 500, MUTED, 25) + 10;

  y += 14; font(x, 18, 500); x.fillStyle = INK; x.fillText('С уважением,', M, y); y += 29;
  font(x, 20, 800); x.fillText(COMPANY.name, M, y); y += 30;
  font(x, 18, 500); x.fillStyle = MUTED; x.fillText(`Моб. ${COMPANY.phone} · ${COMPANY.email}`, M, y);

  pages.forEach((page, index) => drawFooter(page, index, pages.length));
  return pages;
}

function dataUrlBytes(url) {
  const b64 = url.split(',')[1]; const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function canvasesToPdf(canvases) {
  const images = canvases.map((c) => dataUrlBytes(c.toDataURL('image/jpeg', 0.92)));
  const enc = new TextEncoder(); const parts = []; const offsets = [0]; let length = 0;
  const push = (value) => { const bytes = typeof value === 'string' ? enc.encode(value) : value; parts.push(bytes); length += bytes.length; };
  push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]));
  const objCount = 2 + images.length * 3; const kids = [];
  const obj = (id, bodyParts) => { offsets[id] = length; push(`${id} 0 obj\n`); bodyParts.forEach(push); push('\nendobj\n'); };
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  for (let i = 0; i < images.length; i += 1) kids.push(`${3 + i * 3} 0 R`);
  obj(2, [`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${images.length} >>`]);
  images.forEach((img, i) => {
    const pageId = 3 + i * 3, contentId = pageId + 1, imageId = pageId + 2;
    const stream = 'q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n';
    obj(pageId, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`]);
    obj(contentId, [`<< /Length ${enc.encode(stream).length} >>\nstream\n`, stream, 'endstream']);
    obj(imageId, [`<< /Type /XObject /Subtype /Image /Width ${PW} /Height ${PH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`, img, '\nendstream']);
  });
  const xref = length;
  push(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objCount; i += 1) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length); let pos = 0;
  for (const part of parts) { out.set(part, pos); pos += part.length; }
  return new Blob([out], { type: 'application/pdf' });
}
