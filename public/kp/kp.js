const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#0b0b0c'); tg.setBackgroundColor('#09090a'); } catch {}
}

const $ = (id) => document.getElementById(id);
const gate = $('gate');
const gateText = $('gateText');
const app = $('app');
const itemsEl = $('items');
const historyEl = $('history');
const toastEl = $('toast');
const previewModal = $('previewModal');
const previewCanvas = $('previewCanvas');

const state = {
  bootstrap: null,
  currentId: null,
  currentNumber: '',
  lastSaved: null,
  items: [],
};

const fields = {
  issue_date: $('issueDate'),
  valid_days: $('validDays'),
  client_name: $('clientName'),
  client_company: $('clientCompany'),
  address: $('address'),
  object_type: $('objectType'),
  area: $('area'),
  title: $('title'),
  discount_percent: $('discountPercent'),
  prepayment_percent: $('prepaymentPercent'),
  duration: $('duration'),
  vat_label: $('vatLabel'),
  payment_terms: $('paymentTerms'),
  notes: $('notes'),
};

function initData() {
  return tg?.initData || '';
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-Telegram-Init-Data', initData());
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`);
  return data;
}

function showToast(message, error = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('error', error);
  toastEl.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.add('hidden'), 3200);
}

function num(value) {
  const n = Number(String(value ?? '').replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: Number(value) % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(round2(value))} ₽`;
}

function dateRu(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value || '—');
}

function calcLocal() {
  const rows = state.items.map((item) => ({
    ...item,
    quantity: Math.max(0, Math.round(num(item.quantity) * 1000) / 1000),
    price: Math.max(0, round2(num(item.price))),
  })).map((item) => ({ ...item, total: round2(item.quantity * item.price) }));
  const subtotal = round2(rows.reduce((sum, item) => sum + item.total, 0));
  const discountPercent = Math.min(100, Math.max(0, num(fields.discount_percent.value)));
  const discount = round2(subtotal * discountPercent / 100);
  const total = round2(Math.max(0, subtotal - discount));
  const prepaymentPercent = Math.min(100, Math.max(0, num(fields.prepayment_percent.value)));
  const prepayment = round2(total * prepaymentPercent / 100);
  const balance = round2(total - prepayment);
  return { rows, subtotal, discountPercent, discount, total, prepaymentPercent, prepayment, balance };
}

function updateTotals() {
  const c = calcLocal();
  $('subtotal').textContent = money(c.subtotal);
  $('discountValue').textContent = c.discount > 0 ? `−${money(c.discount)}` : money(0);
  $('grandTotal').textContent = money(c.total);
  $('prepaymentValue').textContent = money(c.prepayment);
  $('balanceValue').textContent = money(c.balance);
  [...itemsEl.querySelectorAll('.item')].forEach((row, index) => {
    const total = row.querySelector('.item-total');
    if (total) total.textContent = money(c.rows[index]?.total || 0);
  });
}

function createItem(data = {}) {
  state.items.push({
    name: String(data.name || ''),
    unit: String(data.unit || 'м²'),
    quantity: data.quantity ?? '',
    price: data.price ?? '',
  });
  renderItems();
}

function renderItems() {
  itemsEl.innerHTML = '';
  if (!state.items.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'Добавьте услугу или выберите готовый вариант выше.';
    itemsEl.appendChild(empty);
    updateTotals();
    return;
  }

  state.items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="item-top">
        <label class="item-field name"><span>Наименование услуги</span><input data-k="name" value="${escapeAttr(item.name)}" placeholder="Наименование работ" /></label>
        <label class="item-field"><span>Ед.</span><input data-k="unit" value="${escapeAttr(item.unit)}" /></label>
        <label class="item-field"><span>Кол-во</span><input data-k="quantity" inputmode="decimal" value="${escapeAttr(item.quantity)}" placeholder="0" /></label>
        <label class="item-field"><span>Цена</span><input data-k="price" inputmode="decimal" value="${escapeAttr(item.price)}" placeholder="0" /></label>
        <button class="remove-item" type="button" title="Удалить">×</button>
      </div>
      <div class="item-total">0 ₽</div>`;

    row.querySelectorAll('input[data-k]').forEach((input) => {
      input.addEventListener('input', () => {
        state.items[index][input.dataset.k] = input.value;
        state.lastSaved = null;
        updateTotals();
      });
    });
    row.querySelector('.remove-item').addEventListener('click', () => {
      state.items.splice(index, 1);
      state.lastSaved = null;
      renderItems();
    });
    itemsEl.appendChild(row);
  });
  updateTotals();
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPresets() {
  const root = $('presetRow');
  root.innerHTML = '';
  for (const preset of state.bootstrap?.presets || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-chip';
    button.textContent = preset.name;
    button.addEventListener('click', () => createItem({ ...preset, quantity: preset.unit === 'усл.' ? 1 : '' }));
    root.appendChild(button);
  }
}

function buildPayload() {
  return {
    id: state.currentId,
    issue_date: fields.issue_date.value,
    valid_days: num(fields.valid_days.value) || 14,
    client_name: fields.client_name.value.trim(),
    client_company: fields.client_company.value.trim(),
    address: fields.address.value.trim(),
    object_type: fields.object_type.value,
    area: fields.area.value,
    title: fields.title.value.trim(),
    discount_percent: fields.discount_percent.value,
    prepayment_percent: fields.prepayment_percent.value,
    duration: fields.duration.value.trim(),
    vat_label: fields.vat_label.value.trim(),
    payment_terms: fields.payment_terms.value.trim(),
    notes: fields.notes.value.trim(),
    items: state.items.map((item) => ({
      name: String(item.name || '').trim(),
      unit: String(item.unit || '').trim(),
      quantity: item.quantity,
      price: item.price,
    })),
  };
}

function validateClientPayload(payload) {
  if (!payload.client_name) throw new Error('Укажите клиента');
  if (!payload.address) throw new Error('Укажите адрес объекта');
  if (!payload.items.some((item) => item.name && num(item.quantity) >= 0 && num(item.price) >= 0)) throw new Error('Добавьте хотя бы одну услугу');
  if (calcLocal().total <= 0) throw new Error('Итоговая стоимость должна быть больше нуля');
}

async function saveQuote(silent = false) {
  const payload = buildPayload();
  validateClientPayload(payload);
  const data = await api('/api/kp/save', { method: 'POST', body: JSON.stringify(payload) });
  state.currentId = data.quote.id;
  state.currentNumber = data.quote.quote_number;
  state.lastSaved = data.quote;
  $('quoteNumberBadge').textContent = state.currentNumber;
  if (!silent) showToast(`КП ${state.currentNumber} сохранено`);
  await loadHistory();
  return data.quote;
}

async function ensureSaved() {
  return saveQuote(true);
}

function fillForm(quote, { copy = false } = {}) {
  state.currentId = copy ? null : quote.id;
  state.currentNumber = copy ? (state.bootstrap?.defaults?.quote_number || 'Новое КП') : quote.quote_number;
  state.lastSaved = copy ? null : quote;
  $('quoteNumberBadge').textContent = state.currentNumber;

  fields.issue_date.value = copy ? (state.bootstrap?.defaults?.issue_date || quote.issue_date) : quote.issue_date;
  fields.valid_days.value = quote.valid_days || 14;
  fields.client_name.value = quote.client_name || '';
  fields.client_company.value = quote.client_company || '';
  fields.address.value = quote.address || '';
  fields.object_type.value = quote.object_type || 'Жилое помещение';
  fields.area.value = quote.area ?? '';
  fields.title.value = quote.title || 'Коммерческое предложение по уборке';
  fields.discount_percent.value = quote.discount_percent ?? 0;
  fields.prepayment_percent.value = quote.prepayment_percent ?? 50;
  fields.duration.value = quote.duration || '';
  fields.vat_label.value = quote.vat_label || 'Без НДС';
  fields.payment_terms.value = quote.payment_terms || '';
  fields.notes.value = quote.notes || '';
  state.items = (quote.items || []).map((item) => ({ ...item }));
  renderItems();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function resetForm() {
  const data = await api('/api/kp/bootstrap');
  state.bootstrap = data;
  state.currentId = null;
  state.currentNumber = data.defaults.quote_number;
  state.lastSaved = null;
  $('quoteNumberBadge').textContent = state.currentNumber;
  fields.issue_date.value = data.defaults.issue_date;
  fields.valid_days.value = data.defaults.valid_days;
  fields.client_name.value = '';
  fields.client_company.value = '';
  fields.address.value = '';
  fields.object_type.value = 'Жилое помещение';
  fields.area.value = '';
  fields.title.value = 'Коммерческое предложение по уборке';
  fields.discount_percent.value = 0;
  fields.prepayment_percent.value = data.defaults.prepayment_percent;
  fields.duration.value = '';
  fields.vat_label.value = data.defaults.vat_label;
  fields.payment_terms.value = data.defaults.payment_terms;
  fields.notes.value = '';
  state.items = [];
  renderPresets();
  renderItems();
}

async function loadHistory() {
  const data = await api('/api/kp/list');
  const quotes = data.quotes || [];
  historyEl.innerHTML = '';
  if (!quotes.length) {
    historyEl.innerHTML = '<div class="history-empty">Здесь появятся сохранённые коммерческие предложения.</div>';
    return;
  }
  for (const quote of quotes) {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="num">${escapeHtml(quote.quote_number)}</div>
      <h3>${escapeHtml(quote.client_name)}</h3>
      <p>${escapeHtml(quote.address || '')}</p>
      <p>${dateRu(quote.issue_date)} · ${escapeHtml(quote.object_type || '')}</p>
      <div class="amount">${money(quote.total)}</div>
      <div class="history-actions">
        <button data-a="open">Открыть</button>
        <button data-a="copy">Копия</button>
        <button data-a="delete" class="danger">Удалить</button>
      </div>`;
    card.querySelector('[data-a="open"]').addEventListener('click', () => fillForm(quote));
    card.querySelector('[data-a="copy"]').addEventListener('click', async () => {
      const fresh = await api('/api/kp/bootstrap');
      state.bootstrap = fresh;
      fillForm(quote, { copy: true });
      state.currentNumber = fresh.defaults.quote_number;
      $('quoteNumberBadge').textContent = state.currentNumber;
      showToast('Создана копия. Номер присвоится при сохранении.');
    });
    card.querySelector('[data-a="delete"]').addEventListener('click', async () => {
      if (!confirm(`Удалить ${quote.quote_number}?`)) return;
      await api('/api/kp/delete', { method: 'POST', body: JSON.stringify({ id: quote.id }) });
      if (state.currentId === quote.id) await resetForm();
      await loadHistory();
      showToast('КП удалено');
    });
    historyEl.appendChild(card);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

for (const input of Object.values(fields)) {
  input.addEventListener('input', () => {
    state.lastSaved = null;
    updateTotals();
  });
  input.addEventListener('change', () => { state.lastSaved = null; updateTotals(); });
}

$('addItemBtn').addEventListener('click', () => createItem({ unit: 'м²' }));
$('saveBtn').addEventListener('click', async () => {
  try { await saveQuote(false); } catch (error) { showToast(error.message, true); }
});
$('newQuoteBtn').addEventListener('click', async () => {
  try {
    if ((fields.client_name.value || state.items.length) && !confirm('Начать новое КП? Несохранённые изменения будут потеряны.')) return;
    await resetForm();
  } catch (error) { showToast(error.message, true); }
});
$('refreshHistoryBtn').addEventListener('click', () => loadHistory().catch((e) => showToast(e.message, true)));
$('previewBtn').addEventListener('click', () => previewCurrent().catch((e) => showToast(e.message, true)));
$('pdfBtn').addEventListener('click', () => downloadCurrentPdf().catch((e) => showToast(e.message, true)));
$('modalPdfBtn').addEventListener('click', () => downloadCurrentPdf().catch((e) => showToast(e.message, true)));
previewModal.querySelectorAll('[data-close-modal]').forEach((el) => el.addEventListener('click', () => previewModal.classList.add('hidden')));

async function previewCurrent() {
  const quote = await ensureSaved();
  const pages = await renderQuotePages(quote);
  const first = pages[0];
  previewCanvas.width = first.width;
  previewCanvas.height = first.height;
  previewCanvas.getContext('2d').drawImage(first, 0, 0);
  previewModal.classList.remove('hidden');
  if (pages.length > 1) showToast(`КП занимает ${pages.length} стр. В PDF попадут все страницы.`);
}

async function downloadCurrentPdf() {
  const quote = await ensureSaved();
  const pages = await renderQuotePages(quote);
  const blob = canvasesToPdf(pages);
  downloadBlob(blob, `${quote.quote_number}_${safeFileName(quote.client_name)}.pdf`);
  showToast(`PDF ${quote.quote_number} подготовлен`);
}

function safeFileName(value) {
  return String(value || 'client').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_').slice(0, 60);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function renderQuotePages(quote) {
  const W = 1240;
  const H = 1754;
  const M = 72;
  const pages = [];
  const logo = await loadImage(window.HOUSE_CLEANING_LOGO).catch(() => null);
  let canvas = newCanvas(W, H);
  let ctx = canvas.getContext('2d');
  drawPageBackground(ctx, W, H);
  let y = drawFirstHeader(ctx, quote, logo, M, W);
  y = drawClientBlock(ctx, quote, M, W, y);
  y += 22;
  y = drawTableHeader(ctx, M, W, y);

  const bottomReserve = 420;
  let itemIndex = 0;
  while (itemIndex < quote.items.length) {
    const item = quote.items[itemIndex];
    const rowHeight = measureItemRow(ctx, item, 500);
    if (y + rowHeight > H - M - bottomReserve && itemIndex > 0) {
      pages.push(canvas);
      canvas = newCanvas(W, H);
      ctx = canvas.getContext('2d');
      drawPageBackground(ctx, W, H);
      y = drawContinuationHeader(ctx, quote, M, W);
      y = drawTableHeader(ctx, M, W, y);
    }
    y = drawItemRow(ctx, item, itemIndex + 1, M, W, y, rowHeight);
    itemIndex += 1;
  }

  const finalHeight = estimateFinalBlockHeight(quote);
  if (y + finalHeight > H - M) {
    pages.push(canvas);
    canvas = newCanvas(W, H);
    ctx = canvas.getContext('2d');
    drawPageBackground(ctx, W, H);
    y = drawContinuationHeader(ctx, quote, M, W);
  } else {
    y += 14;
  }
  drawFinalBlock(ctx, quote, M, W, H, y);
  pages.push(canvas);
  return pages;
}

function newCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function drawPageBackground(ctx, W, H) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, W, 24);
  ctx.fillStyle = '#d4b45e';
  ctx.fillRect(0, 24, W, 5);
}

function drawFirstHeader(ctx, quote, logo, M, W) {
  if (logo) {
    const targetW = 335;
    const targetH = targetW * logo.height / logo.width;
    ctx.drawImage(logo, M, 60, targetW, targetH);
  } else {
    ctx.fillStyle = '#111'; ctx.font = '700 42px Georgia'; ctx.fillText('HOUSE CLEANING', M, 125);
  }
  const rightX = 735;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#111';
  ctx.font = '700 23px Arial';
  ctx.fillText(quote.company?.name || 'HOUSE CLEANING', W - M, 78);
  ctx.font = '18px Arial';
  ctx.fillStyle = '#555';
  ctx.fillText(`ИНН ${quote.company?.inn || '—'}`, W - M, 112);
  ctx.fillText(`ОГРНИП ${quote.company?.ogrnip || '—'}`, W - M, 142);
  ctx.fillText(quote.company?.phone || '', W - M, 172);
  ctx.fillText(quote.company?.email || '', W - M, 202);
  ctx.textAlign = 'left';

  const y = 300;
  ctx.fillStyle = '#111';
  ctx.font = '700 38px Georgia';
  ctx.fillText('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', M, y);
  ctx.fillStyle = '#b08a31';
  ctx.font = '700 21px Arial';
  ctx.fillText(quote.quote_number, M, y + 38);
  ctx.fillStyle = '#555';
  ctx.font = '18px Arial';
  ctx.fillText(`от ${dateRu(quote.issue_date)}`, M + 190, y + 38);
  ctx.textAlign = 'right';
  ctx.fillText(`Действует до ${dateRu(quote.valid_until)}`, W - M, y + 38);
  ctx.textAlign = 'left';
  return y + 78;
}

function drawContinuationHeader(ctx, quote, M, W) {
  ctx.fillStyle = '#111';
  ctx.font = '700 25px Georgia';
  ctx.fillText('HOUSE CLEANING', M, 78);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#a07c2e';
  ctx.font = '700 18px Arial';
  ctx.fillText(`${quote.quote_number} · продолжение`, W - M, 78);
  ctx.textAlign = 'left';
  return 115;
}

function drawClientBlock(ctx, quote, M, W, y) {
  ctx.fillStyle = '#f5f3ed';
  roundedRect(ctx, M, y, W - M * 2, 176, 18, true, false);
  const left = M + 24;
  const mid = 620;
  ctx.fillStyle = '#8c6b25';
  ctx.font = '700 15px Arial';
  ctx.fillText('КЛИЕНТ', left, y + 32);
  ctx.fillText('ОБЪЕКТ', mid, y + 32);
  ctx.fillStyle = '#111';
  ctx.font = '700 24px Arial';
  ctx.fillText(quote.client_company || quote.client_name, left, y + 66);
  if (quote.client_company) {
    ctx.font = '18px Arial';
    ctx.fillStyle = '#555';
    ctx.fillText(quote.client_name, left, y + 95);
  }
  ctx.fillStyle = '#111';
  ctx.font = '700 22px Arial';
  ctx.fillText(quote.object_type || 'Объект', mid, y + 66);
  ctx.font = '18px Arial';
  ctx.fillStyle = '#555';
  if (quote.area) ctx.fillText(`Площадь: ${quote.area} м²`, mid, y + 95);
  const addrLines = wrapText(ctx, quote.address, W - M * 2 - 48, '18px Arial');
  ctx.fillStyle = '#333';
  ctx.font = '18px Arial';
  addrLines.slice(0, 2).forEach((line, i) => ctx.fillText(line, left, y + 132 + i * 24));
  return y + 176;
}

const COLS = { n: 54, name: 510, unit: 92, qty: 112, price: 152, total: 176 };
function colXs(M) {
  const x0 = M;
  return {
    n: x0,
    name: x0 + COLS.n,
    unit: x0 + COLS.n + COLS.name,
    qty: x0 + COLS.n + COLS.name + COLS.unit,
    price: x0 + COLS.n + COLS.name + COLS.unit + COLS.qty,
    total: x0 + COLS.n + COLS.name + COLS.unit + COLS.qty + COLS.price,
  };
}

function drawTableHeader(ctx, M, W, y) {
  const h = 54;
  ctx.fillStyle = '#111214';
  ctx.fillRect(M, y, W - M * 2, h);
  const x = colXs(M);
  ctx.fillStyle = '#d9bb6b';
  ctx.font = '700 14px Arial';
  ctx.fillText('№', x.n + 18, y + 34);
  ctx.fillText('НАИМЕНОВАНИЕ УСЛУГ', x.name + 14, y + 34);
  ctx.fillText('ЕД.', x.unit + 14, y + 34);
  ctx.fillText('КОЛ-ВО', x.qty + 12, y + 34);
  ctx.fillText('ЦЕНА', x.price + 14, y + 34);
  ctx.fillText('ИТОГО', x.total + 14, y + 34);
  return y + h;
}

function measureItemRow(ctx, item) {
  const lines = wrapText(ctx, item.name, COLS.name - 28, '18px Arial');
  return Math.max(56, 26 + lines.length * 23);
}

function drawItemRow(ctx, item, index, M, W, y, h) {
  const x = colXs(M);
  ctx.strokeStyle = '#dadada';
  ctx.lineWidth = 1;
  ctx.strokeRect(M, y, W - M * 2, h);
  [x.name, x.unit, x.qty, x.price, x.total].forEach((xx) => {
    ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); ctx.stroke();
  });
  ctx.fillStyle = '#222';
  ctx.font = '18px Arial';
  ctx.fillText(String(index), x.n + 18, y + 34);
  const lines = wrapText(ctx, item.name, COLS.name - 28, '18px Arial');
  lines.forEach((line, i) => ctx.fillText(line, x.name + 14, y + 29 + i * 23));
  ctx.fillText(item.unit || '—', x.unit + 14, y + 34);
  ctx.textAlign = 'right';
  ctx.fillText(formatNumber(item.quantity), x.qty + COLS.qty - 14, y + 34);
  ctx.fillText(money(item.price).replace(' ₽', ''), x.price + COLS.price - 14, y + 34);
  ctx.font = '700 18px Arial';
  ctx.fillText(money(item.total).replace(' ₽', ''), x.total + COLS.total - 14, y + 34);
  ctx.textAlign = 'left';
  return y + h;
}

function estimateFinalBlockHeight(quote) {
  return 350 + (quote.notes ? 70 : 0) + (quote.duration ? 30 : 0);
}

function drawFinalBlock(ctx, quote, M, W, H, y) {
  const boxW = 500;
  const x = W - M - boxW;
  ctx.fillStyle = '#f7f3e8';
  roundedRect(ctx, x, y, boxW, quote.discount > 0 ? 190 : 155, 18, true, false);
  ctx.fillStyle = '#4d4638';
  ctx.font = '18px Arial';
  let yy = y + 34;
  ctx.fillText('Подытог', x + 22, yy);
  ctx.textAlign = 'right'; ctx.fillText(money(quote.subtotal), x + boxW - 22, yy); ctx.textAlign = 'left';
  if (quote.discount > 0) {
    yy += 34;
    ctx.fillText(`Скидка ${formatNumber(quote.discount_percent)}%`, x + 22, yy);
    ctx.textAlign = 'right'; ctx.fillText(`−${money(quote.discount)}`, x + boxW - 22, yy); ctx.textAlign = 'left';
  }
  yy += 44;
  ctx.fillStyle = '#111';
  ctx.font = '700 22px Arial';
  ctx.fillText('ОБЩАЯ СТОИМОСТЬ', x + 22, yy);
  ctx.fillStyle = '#9b7625';
  ctx.font = '700 30px Arial';
  ctx.textAlign = 'right'; ctx.fillText(money(quote.total), x + boxW - 22, yy + 2); ctx.textAlign = 'left';
  yy += 42;
  ctx.fillStyle = '#555';
  ctx.font = '16px Arial';
  ctx.fillText(quote.vat_label || 'Без НДС', x + 22, yy);

  let leftY = y + 26;
  const leftW = x - M - 28;
  ctx.fillStyle = '#111';
  ctx.font = '700 18px Arial';
  ctx.fillText('Сумма прописью', M, leftY);
  ctx.fillStyle = '#555';
  ctx.font = '17px Arial';
  const wordLines = wrapText(ctx, quote.total_words || '', leftW, '17px Arial');
  wordLines.forEach((line, i) => ctx.fillText(line, M, leftY + 28 + i * 22));
  leftY += 28 + wordLines.length * 22 + 18;

  const terms = [];
  if (quote.duration) terms.push(['Срок выполнения', quote.duration]);
  if (quote.payment_terms) terms.push(['Условия оплаты', quote.payment_terms]);
  terms.push(['Предоплата', `${formatNumber(quote.prepayment_percent)}% — ${money(quote.prepayment)}`]);
  terms.push(['Остаток', money(quote.balance)]);
  terms.push(['Срок действия КП', `до ${dateRu(quote.valid_until)}`]);
  for (const [label, value] of terms) {
    ctx.fillStyle = '#8f6e2b'; ctx.font = '700 14px Arial'; ctx.fillText(label.toUpperCase(), M, leftY);
    ctx.fillStyle = '#222'; ctx.font = '17px Arial';
    const lines = wrapText(ctx, value, leftW, '17px Arial');
    lines.forEach((line, i) => ctx.fillText(line, M, leftY + 25 + i * 21));
    leftY += 31 + lines.length * 21;
  }
  if (quote.notes) {
    ctx.fillStyle = '#8f6e2b'; ctx.font = '700 14px Arial'; ctx.fillText('ПРИМЕЧАНИЕ', M, leftY + 4);
    ctx.fillStyle = '#444'; ctx.font = '16px Arial';
    const lines = wrapText(ctx, quote.notes, W - M * 2, '16px Arial');
    lines.slice(0, 4).forEach((line, i) => ctx.fillText(line, M, leftY + 29 + i * 20));
  }

  ctx.strokeStyle = '#d0d0d0';
  ctx.beginPath(); ctx.moveTo(M, H - 150); ctx.lineTo(W - M, H - 150); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.font = '700 18px Arial';
  ctx.fillText(quote.company?.brand || 'HOUSE CLEANING', M, H - 112);
  ctx.fillStyle = '#666'; ctx.font = '15px Arial';
  ctx.fillText(quote.company?.region || '', M, H - 84);
  ctx.textAlign = 'right';
  ctx.fillText(quote.company?.phone || '', W - M, H - 112);
  ctx.fillText(quote.company?.email || '', W - M, H - 84);
  ctx.textAlign = 'left';
}

function formatNumber(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(Number(value || 0));
}

function wrapText(ctx, text, maxWidth, font) {
  const previous = ctx.font;
  ctx.font = font;
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) { ctx.font = previous; return ['']; }
  const lines = [];
  let line = words.shift();
  for (const word of words) {
    const test = `${line} ${word}`;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  ctx.font = previous;
  return lines;
}

function roundedRect(ctx, x, y, w, h, r, fill, stroke) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function canvasesToPdf(canvases) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;
  const pushBytes = (bytes) => { chunks.push(bytes); length += bytes.length; };
  const pushText = (text) => pushBytes(encoder.encode(text));
  const addObject = (number, parts) => {
    offsets[number] = length;
    pushText(`${number} 0 obj\n`);
    for (const part of parts) typeof part === 'string' ? pushText(part) : pushBytes(part);
    pushText('\nendobj\n');
  };

  pushBytes(new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0x0a,0x25,0xff,0xff,0xff,0xff,0x0a]));
  addObject(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  const kids = canvases.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  addObject(2, [`<< /Type /Pages /Kids [${kids}] /Count ${canvases.length} >>`]);

  canvases.forEach((canvas, i) => {
    const pageObj = 3 + i * 3;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;
    const imageName = `Im${i}`;
    addObject(pageObj, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`]);
    const stream = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ\n`;
    addObject(contentObj, [`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`]);
    const jpeg = dataUrlBytes(canvas.toDataURL('image/jpeg', 0.92));
    addObject(imageObj, [
      `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream',
    ]);
  });

  const xrefOffset = length;
  const objectCount = 2 + canvases.length * 3;
  pushText(`xref\n0 ${objectCount + 1}\n`);
  pushText('0000000000 65535 f \n');
  for (let i = 1; i <= objectCount; i += 1) {
    pushText(`${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`);
  }
  pushText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(chunks, { type: 'application/pdf' });
}

function dataUrlBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function boot() {
  try {
    if (!initData()) throw new Error('Откройте генератор КП через кнопку администратора в Telegram-боте.');
    const data = await api('/api/kp/bootstrap');
    state.bootstrap = data;
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    await resetForm();
    await loadHistory();
  } catch (error) {
    gateText.textContent = error.message || 'Нет доступа';
  }
}

boot();
