import {
  $, DEV, TEMPLATES, state, api, calcQuote, money, escapeHtml, parseNum, uid, loadLogo, tg,
} from './core.js';
import { buildQuoteCanvases, canvasesToPdf } from './pdf.js';

export async function initUI() {
  try {
    try { tg?.ready(); tg?.expand(); tg?.setHeaderColor?.('#171717'); tg?.setBackgroundColor?.('#111111'); } catch {}
    await loadLogo();
    await api('/api/kp/bootstrap');
    $('securityPill').textContent = DEV ? 'Локальная проверка' : 'Доступ подтверждён';
    $('securityPill').classList.add('ok');
    $('accessScreen').hidden = true; $('workspace').hidden = false;
    bind();

    const existing = await api('/api/kp/quotes');
    state.history = existing.quotes || [];
    const draft = state.history.find((q) => q.status === 'draft');
    if (draft) { state.quote = draft; renderQuote(); }
    else await createQuote();
  } catch (error) {
    $('securityPill').textContent = 'Нет доступа'; $('securityPill').classList.add('error');
    $('accessScreen').innerHTML = `<div><div class="eyebrow">ДОСТУП ЗАКРЫТ</div><h2>Модуль только для администратора</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function bind() {
  document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.querySelectorAll('[data-template]').forEach((btn) => btn.addEventListener('click', () => addItem(TEMPLATES[btn.dataset.template])));
  $('addCustomBtn').addEventListener('click', () => addItem({ name: '', unit: 'м²', quantity: 1, unit_price: 0, mode: 'calc', fixed_amount: 0 }));
  ['clientName', 'objectType', 'objectAddress', 'offerDate', 'validUntil', 'prepayment', 'workDeadline', 'discount', 'notes']
    .forEach((id) => $(id).addEventListener('input', syncFromForm));
  $('saveBtn').addEventListener('click', () => saveQuote(true));
  $('previewBtn').addEventListener('click', previewPdf);
  $('downloadBtn').addEventListener('click', downloadPdf);
  $('downloadFromPreview').addEventListener('click', downloadPdf);
  $('newQuoteBtn').addEventListener('click', createQuote);
  document.querySelectorAll('[data-close-preview]').forEach((el) => el.addEventListener('click', closePreview));
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('editorTab').hidden = tab !== 'editor'; $('historyTab').hidden = tab !== 'history';
  if (tab === 'history') loadHistory();
}

async function createQuote() {
  const data = await api('/api/kp/new', { method: 'POST', body: '{}' });
  state.quote = data.quote; renderQuote(); switchTab('editor');
}

function renderQuote() {
  const q = calcQuote(state.quote); state.quote = q;
  $('quoteNumber').textContent = `КП № ${q.quote_number}`;
  $('quoteStatus').textContent = q.status === 'final' ? 'Готово' : 'Черновик';
  $('clientName').value = q.client_name || '';
  $('objectType').value = q.object_type || 'Квартира';
  $('objectAddress').value = q.object_address || '';
  $('offerDate').value = q.offer_date || '';
  $('validUntil').value = q.valid_until || '';
  $('prepayment').value = q.prepayment_percent ?? 50;
  $('workDeadline').value = q.work_deadline || '';
  $('discount').value = q.discount_percent ?? 0;
  $('notes').value = q.notes || '';
  renderItems(); renderTotals();
}

function syncFromForm() { syncFromFormNoSave(); renderTotals(); scheduleSave(); }
function syncFromFormNoSave() {
  if (!state.quote) return;
  state.quote = calcQuote({
    ...state.quote,
    client_name: $('clientName').value.trim(),
    object_type: $('objectType').value,
    object_address: $('objectAddress').value.trim(),
    offer_date: $('offerDate').value,
    valid_until: $('validUntil').value,
    prepayment_percent: parseNum($('prepayment').value),
    work_deadline: $('workDeadline').value.trim(),
    discount_percent: parseNum($('discount').value),
    notes: $('notes').value.trim(),
  });
}

function addItem(template) {
  state.quote.items.push({ id: uid(), ...structuredClone(template) });
  state.quote = calcQuote(state.quote); renderItems(); renderTotals(); scheduleSave();
}
function removeItem(id) {
  state.quote.items = state.quote.items.filter((item) => item.id !== id);
  state.quote = calcQuote(state.quote); renderItems(); renderTotals(); scheduleSave();
}

function renderItems() {
  const root = $('items'); root.innerHTML = '';
  if (!state.quote.items.length) { root.innerHTML = '<div class="history-empty">Добавьте первую услугу — расчёт появится автоматически.</div>'; return; }
  state.quote.items.forEach((item, index) => {
    const el = document.createElement('div'); el.className = 'quote-item';
    el.innerHTML = `
      <div class="item-top"><div class="item-name">Позиция ${index + 1}</div><button class="remove-item" type="button">×</button></div>
      <div class="item-grid">
        <label class="field full"><span>Наименование услуги</span><input data-k="name" maxlength="500" value="${escapeHtml(item.name)}" placeholder="Например: Уборка после ремонта — 1 этап" /></label>
        <label class="field"><span>Ед. изм.</span><input data-k="unit" maxlength="30" value="${escapeHtml(item.unit || '')}" /></label>
        <label class="field"><span>Количество</span><input data-k="quantity" inputmode="decimal" value="${item.quantity}" ${item.mode === 'fixed' ? 'disabled' : ''} /></label>
        <label class="field"><span>${item.mode === 'fixed' ? 'Фикс. стоимость' : 'Цена за ед., ₽'}</span><input data-k="${item.mode === 'fixed' ? 'fixed_amount' : 'unit_price'}" inputmode="decimal" value="${item.mode === 'fixed' ? item.fixed_amount : item.unit_price}" /></label>
      </div>
      <div class="item-mode"><button type="button" data-mode="calc" class="${item.mode === 'calc' ? 'active' : ''}">Кол-во × цена</button><button type="button" data-mode="fixed" class="${item.mode === 'fixed' ? 'active' : ''}">Фиксированная цена</button></div>
      <div class="item-amount"><span>Сумма позиции</span><strong>${money(item.amount)}</strong></div>`;

    el.querySelector('.remove-item').addEventListener('click', () => removeItem(item.id));
    el.querySelectorAll('input[data-k]').forEach((input) => input.addEventListener('input', () => {
      const current = state.quote.items.find((x) => x.id === item.id); if (!current) return;
      const key = input.dataset.k;
      current[key] = ['quantity', 'unit_price', 'fixed_amount'].includes(key) ? parseNum(input.value) : input.value;
      state.quote = calcQuote(state.quote); renderTotals();
      el.querySelector('.item-amount strong').textContent = money(state.quote.items.find((x) => x.id === item.id)?.amount || 0);
      scheduleSave();
    }));
    el.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
      const current = state.quote.items.find((x) => x.id === item.id); if (!current) return;
      current.mode = button.dataset.mode; state.quote = calcQuote(state.quote); renderItems(); renderTotals(); scheduleSave();
    }));
    root.appendChild(el);
  });
}

function renderTotals() {
  state.quote = calcQuote(state.quote);
  $('subtotal').textContent = money(state.quote.subtotal);
  $('discountAmount').textContent = state.quote.discount_amount ? `− ${money(state.quote.discount_amount)}` : '0 ₽';
  $('total').textContent = money(state.quote.total);
  $('prepaymentAmount').textContent = money(state.quote.prepayment_amount);
  $('balanceAmount').textContent = money(state.quote.balance_amount);
}

function scheduleSave() { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(() => saveQuote(false).catch(() => {}), 900); }
async function saveQuote(showMessage = false, final = false) {
  syncFromFormNoSave();
  const payload = { ...state.quote, status: final ? 'final' : state.quote.status };
  const data = await api('/api/kp/quote', { method: 'PUT', body: JSON.stringify(payload) });
  state.quote = data.quote; renderTotals();
  if (showMessage) toast('КП сохранено');
  return state.quote;
}

async function loadHistory() {
  const data = await api('/api/kp/quotes'); state.history = data.quotes || [];
  const root = $('historyList'); root.innerHTML = '';
  if (!state.history.length) { root.innerHTML = '<div class="card history-empty">Пока нет сохранённых КП.</div>'; return; }
  state.history.forEach((q) => {
    const el = document.createElement('div'); el.className = 'card history-card';
    el.innerHTML = `<div class="history-title"><div><div class="history-number">${escapeHtml(q.quote_number)}</div><div class="history-meta">${escapeHtml(q.client_name || 'Без клиента')} · ${escapeHtml(q.offer_date || '')}</div></div><div class="history-total">${money(q.total || 0)}</div></div><div class="history-meta">${escapeHtml(q.object_type || '')}${q.object_address ? ` · ${escapeHtml(q.object_address)}` : ''}</div><div class="history-actions"><button class="btn ghost" data-open>Открыть</button><button class="btn secondary" data-copy>Сделать копию</button></div>`;
    el.querySelector('[data-open]').addEventListener('click', () => openQuote(q.id));
    el.querySelector('[data-copy]').addEventListener('click', () => duplicateQuote(q.id));
    root.appendChild(el);
  });
}
async function openQuote(id) { const data = await api(`/api/kp/quote?id=${encodeURIComponent(id)}`); state.quote = data.quote; renderQuote(); switchTab('editor'); }
async function duplicateQuote(id) { const data = await api('/api/kp/duplicate', { method: 'POST', body: JSON.stringify({ id }) }); state.quote = data.quote; renderQuote(); switchTab('editor'); toast('Создана копия с новым номером'); }

function toast(message) { const el = $('toast'); el.textContent = message; el.hidden = false; clearTimeout(el._timer); el._timer = setTimeout(() => { el.hidden = true; }, 1800); }
function validateForPdf() {
  if (!state.quote.client_name) throw new Error('Укажите клиента');
  if (!state.quote.object_address) throw new Error('Укажите адрес объекта');
  if (!state.quote.items.length) throw new Error('Добавьте хотя бы одну услугу');
  if (state.quote.items.some((item) => !String(item.name || '').trim())) throw new Error('Заполните названия всех услуг');
}

async function previewPdf() {
  try {
    syncFromFormNoSave(); validateForPdf(); await saveQuote(false, true);
    const pages = buildQuoteCanvases(state.quote); const root = $('previewPages'); root.innerHTML = '';
    pages.forEach((canvas) => root.appendChild(canvas)); $('previewModal').hidden = false;
  } catch (error) { toast(error.message || 'Не удалось сделать предпросмотр'); }
}
function closePreview() { $('previewModal').hidden = true; }
async function downloadPdf() {
  try {
    syncFromFormNoSave(); validateForPdf(); await saveQuote(false, true);
    const blob = canvasesToPdf(buildQuoteCanvases(state.quote));
    const filename = `${state.quote.quote_number.replace(/[^A-Za-zА-Яа-я0-9._-]+/g, '_')}.pdf`;
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.rel = 'noopener'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000); toast('PDF сформирован');
  } catch (error) { toast(error.message || 'Не удалось сформировать PDF'); }
}
