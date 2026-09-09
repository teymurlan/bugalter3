import { calculateTotals, money, rublesToWords, buildImagePdf } from './pdf-engine.js?v=1';
import { renderQuotePages } from './quote-pdf.js?v=1';
import { templateCatalog, company, isoToday, displayDate, addDays, parseNumber, newQuoteState, validateQuote } from './quote-data.js?v=1';
import { createApi, localBootstrap } from './quote-api.js?v=1';

const tg = window.Telegram?.WebApp || null;
const initData = tg?.initData || '';
const isLocalDev = ['127.0.0.1', 'localhost'].includes(location.hostname) && new URLSearchParams(location.search).get('dev') === '1';
const api = createApi(initData);
const $ = (id) => document.getElementById(id);
const els = {
  gate: $('gate'), gateTitle: $('gateTitle'), gateText: $('gateText'), app: $('app'),
  quoteNumber: $('quoteNumber'), quoteDateLabel: $('quoteDateLabel'), clientName: $('clientName'), objectType: $('objectType'), objectAddress: $('objectAddress'),
  objectArea: $('objectArea'), quoteSubject: $('quoteSubject'), items: $('items'), discountPercent: $('discountPercent'), subtotal: $('subtotal'), discountAmount: $('discountAmount'),
  grandTotal: $('grandTotal'), totalWords: $('totalWords'), duration: $('duration'), prepaymentPercent: $('prepaymentPercent'), validDays: $('validDays'), paymentTerms: $('paymentTerms'), notes: $('notes'),
  prepaymentAmount: $('prepaymentAmount'), balanceAmount: $('balanceAmount'), validUntil: $('validUntil'), statusLine: $('statusLine'), historyList: $('historyList'), previewModal: $('previewModal'), previewPages: $('previewPages'), previewCaption: $('previewCaption'),
};

let state = newQuoteState();
let history = [];
let dirty = false;
let cachedPdf = null;
let cachedPages = [];
let logoImage = null;
let autosaveTimer = null;
let nextNumberPreview = null;

async function bootstrap() {
  try {
    tg?.ready(); tg?.expand(); tg?.setHeaderColor?.('#202020'); tg?.setBackgroundColor?.('#151515');
    const data = isLocalDev ? localBootstrap(templateCatalog, company) : await api('/api/kp/bootstrap');
    nextNumberPreview = data.next_number || null;
    state.number_preview = nextNumberPreview;
    history = data.history || [];
    restoreDraft();
    if (!state.items.length) addItem('post', false);
    renderAll();
    els.gate.classList.add('hidden');
    els.app.classList.remove('hidden');
    loadLogo();
  } catch (error) {
    els.gateTitle.textContent = 'Доступ закрыт';
    els.gateText.textContent = String(error.message || error);
    const spinner = els.gate.querySelector('.spinner');
    if (spinner) spinner.style.display = 'none';
  }
}

function restoreDraft() {
  if (!state.id) {
    try {
      const draft = JSON.parse(localStorage.getItem('hc-kp-draft-v1') || 'null');
      if (draft && draft.date && Array.isArray(draft.items)) state = { ...state, ...draft, id: null, number: null, number_preview: state.number_preview };
    } catch {}
  }
}
function scheduleDraftSave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem('hc-kp-draft-v1', JSON.stringify({ ...collectState(), id: null, number: null })); } catch {}
  }, 250);
}
function clearDraft() { try { localStorage.removeItem('hc-kp-draft-v1'); } catch {} }

function markDirty() {
  dirty = true; cachedPdf = null; cachedPages = []; scheduleDraftSave(); updateTotals();
  els.statusLine.textContent = 'Есть несохранённые изменения';
}

function addItem(templateKey = 'custom', mark = true) {
  const tpl = templateCatalog.find((x) => x.key === templateKey) || templateCatalog[0];
  state.items.push({ template_key: tpl.key, title: tpl.title, unit: tpl.unit, quantity: tpl.quantity, price: tpl.price, amount: 0 });
  renderItems();
  if (mark) markDirty(); else updateTotals();
}

function renderAll() {
  els.quoteNumber.textContent = state.number || nextNumberPreview || state.number_preview || 'Назначится автоматически';
  els.quoteDateLabel.textContent = displayDate(state.date);
  els.clientName.value = state.client_name || '';
  els.objectType.value = state.object_type || 'Квартира';
  els.objectAddress.value = state.object_address || '';
  els.objectArea.value = state.object_area || '';
  els.quoteSubject.value = state.subject || 'Уборка жилого помещения';
  els.discountPercent.value = state.discount_percent ?? 0;
  els.duration.value = state.duration || '';
  els.prepaymentPercent.value = state.prepayment_percent ?? 50;
  els.validDays.value = state.valid_days ?? 14;
  els.paymentTerms.value = state.payment_terms || '';
  els.notes.value = state.notes || '';
  renderItems(); updateTotals(); renderHistory();
}

function renderItems() {
  els.items.innerHTML = '';
  state.items.forEach((item, index) => {
    const node = $('itemTemplate').content.firstElementChild.cloneNode(true);
    const sel = node.querySelector('.item-template');
    templateCatalog.forEach((tpl) => {
      const opt = document.createElement('option'); opt.value = tpl.key; opt.textContent = tpl.name; sel.appendChild(opt);
    });
    sel.value = item.template_key || 'custom';
    const title = node.querySelector('.item-title'); const unit = node.querySelector('.item-unit'); const qty = node.querySelector('.item-qty'); const price = node.querySelector('.item-price'); const amount = node.querySelector('.item-amount');
    title.value = item.title || ''; unit.value = item.unit || 'м²'; qty.value = String(item.quantity ?? 1).replace('.', ','); price.value = String(item.price ?? 0).replace('.', ','); amount.value = money(Number(item.amount || (Number(item.quantity || 0) * Number(item.price || 0))));
    sel.addEventListener('change', () => {
      const tpl = templateCatalog.find((x) => x.key === sel.value) || templateCatalog[0];
      state.items[index] = { ...state.items[index], template_key: tpl.key, title: tpl.title, unit: tpl.unit, quantity: tpl.quantity, price: tpl.price };
      renderItems(); markDirty();
    });
    title.addEventListener('input', () => { state.items[index].title = title.value; markDirty(); });
    unit.addEventListener('change', () => { state.items[index].unit = unit.value; markDirty(); });
    qty.addEventListener('input', () => { state.items[index].quantity = parseNumber(qty.value); amount.value = money(state.items[index].quantity * state.items[index].price); markDirty(); });
    price.addEventListener('input', () => { state.items[index].price = parseNumber(price.value); amount.value = money(state.items[index].quantity * state.items[index].price); markDirty(); });
    node.querySelector('.remove-item').addEventListener('click', () => {
      state.items.splice(index, 1); if (!state.items.length) addItem('custom', false); renderItems(); markDirty();
    });
    els.items.appendChild(node);
  });
}

function collectState() {
  return {
    ...state,
    client_name: els.clientName.value.trim(), object_type: els.objectType.value, object_address: els.objectAddress.value.trim(), object_area: parseNumber(els.objectArea.value), subject: els.quoteSubject.value.trim(),
    discount_percent: parseNumber(els.discountPercent.value), duration: els.duration.value.trim(), prepayment_percent: parseNumber(els.prepaymentPercent.value), valid_days: Math.max(1, Math.round(parseNumber(els.validDays.value) || 14)), payment_terms: els.paymentTerms.value.trim(), notes: els.notes.value.trim(),
    items: state.items.map((item) => ({ ...item, title: String(item.title || '').trim(), unit: String(item.unit || 'м²'), quantity: Number(item.quantity || 0), price: Number(item.price || 0) })),
  };
}

function currentCalculated() {
  const current = collectState();
  const totals = calculateTotals(current.items, current.discount_percent, current.prepayment_percent);
  return { ...current, ...totals, valid_until: addDays(current.date, current.valid_days) };
}

function updateTotals() {
  const q = currentCalculated();
  q.items.forEach((item, index) => { state.items[index].amount = item.amount; const input = els.items.children[index]?.querySelector('.item-amount'); if (input) input.value = money(item.amount); });
  els.subtotal.textContent = money(q.subtotal);
  els.discountAmount.textContent = q.discount_amount ? `− ${money(q.discount_amount)}` : '0 ₽';
  els.grandTotal.textContent = money(q.total);
  els.totalWords.textContent = rublesToWords(q.total);
  els.prepaymentAmount.textContent = money(q.prepayment_amount);
  els.balanceAmount.textContent = money(q.balance_amount);
  els.validUntil.textContent = displayDate(q.valid_until);
}

async function saveQuote({ silent = false } = {}) {
  let q = currentCalculated(); validateQuote(q);
  if (isLocalDev) {
    state = { ...q, id: state.id || 'local-test', number: state.number || nextNumberPreview || state.number_preview || 'HC-2026-001' };
    dirty = false; clearDraft(); renderAll(); if (!silent) toast('КП сохранено (локальный тест)'); return state;
  }
  const data = await api('/api/kp/quote', { method: 'POST', body: JSON.stringify({ quote: q }) });
  nextNumberPreview = data.next_number || nextNumberPreview;
  state = { ...data.quote, number_preview: nextNumberPreview || data.quote.number };
  history = data.history || history;
  dirty = false; clearDraft(); renderAll();
  els.statusLine.textContent = `Сохранено: ${state.number}`;
  if (!silent) toast('КП сохранено');
  return state;
}

async function ensureSaved() {
  if (!state.id || dirty) return saveQuote({ silent: true });
  return currentCalculated();
}

function resetNew() {
  state = newQuoteState(); state.number_preview = nextNumberPreview; clearDraft(); dirty = false; cachedPdf = null; cachedPages = [];
  addItem('post', false); renderAll(); els.statusLine.textContent = 'Новое КП';
}

function renderHistory() {
  els.historyList.innerHTML = '';
  if (!history.length) { els.historyList.innerHTML = '<div class="empty">Сохранённых КП пока нет</div>'; return; }
  history.forEach((quote) => {
    const card = document.createElement('article'); card.className = 'history-card';
    card.innerHTML = `<div class="history-main"><div><div class="history-number"></div><div class="history-client"></div><div class="history-meta"></div></div><div class="history-total"></div></div><div class="history-actions"><button class="ghost open">Открыть</button><button class="ghost copy">Копия</button><button class="gold pdf">PDF</button></div>`;
    card.querySelector('.history-number').textContent = quote.number || 'КП';
    card.querySelector('.history-client').textContent = quote.client_name || 'Без клиента';
    card.querySelector('.history-meta').textContent = `${displayDate(quote.date)} · ${quote.object_type || 'Объект'}`;
    card.querySelector('.history-total').textContent = money(quote.total);
    card.querySelector('.open').addEventListener('click', () => openHistoryQuote(quote));
    card.querySelector('.copy').addEventListener('click', () => copyHistoryQuote(quote));
    card.querySelector('.pdf').addEventListener('click', async () => { openHistoryQuote(quote); await downloadPdf(); });
    els.historyList.appendChild(card);
  });
}
function openHistoryQuote(quote) {
  state = JSON.parse(JSON.stringify(quote)); state.number_preview = nextNumberPreview; dirty = false; cachedPdf = null; cachedPages = []; renderAll(); switchTab('editor'); els.statusLine.textContent = `Открыто ${quote.number}`;
}
function copyHistoryQuote(quote) {
  state = { ...JSON.parse(JSON.stringify(quote)), id: null, number: null, number_preview: nextNumberPreview, date: isoToday() };
  dirty = true; cachedPdf = null; cachedPages = []; renderAll(); switchTab('editor'); els.statusLine.textContent = 'Создана копия. Новый номер назначится при сохранении.';
}
async function refreshHistory() {
  if (isLocalDev) return renderHistory();
  const data = await api('/api/kp/quotes'); history = data.quotes || []; nextNumberPreview = data.next_number || nextNumberPreview; state.number_preview = nextNumberPreview; renderHistory();
}

function toast(text) {
  els.statusLine.textContent = text;
  try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
}
function fail(error) {
  const text = String(error?.message || error || 'Ошибка'); els.statusLine.textContent = text; try { tg?.HapticFeedback?.notificationOccurred?.('error'); } catch {}; alert(text);
}

async function loadLogo() {
  if (logoImage) return logoImage;
  logoImage = new Image(); logoImage.decoding = 'async'; logoImage.src = '/kp/logo.jpg';
  await new Promise((resolve, reject) => { logoImage.onload = resolve; logoImage.onerror = reject; });
  return logoImage;
}

async function buildPdfForCurrent() {
  const saved = await ensureSaved(); const quote = { ...saved, ...currentCalculated(), id: saved.id, number: saved.number || state.number };
  if (cachedPdf && !dirty) return { blob: cachedPdf, pages: cachedPages, quote };
  const canvases = await renderQuotePages(quote, await loadLogo(), company); const urls = canvases.map((c) => c.toDataURL('image/jpeg', 0.94)); const blob = buildImagePdf(urls, 1240, 1754); cachedPdf = blob; cachedPages = urls; return { blob, pages: urls, quote };
}

async function previewPdf() {
  try { const { pages, quote } = await buildPdfForCurrent(); els.previewPages.innerHTML = ''; pages.forEach((src) => { const img = new Image(); img.src = src; img.alt = `Страница ${els.previewPages.children.length + 1}`; els.previewPages.appendChild(img); }); els.previewCaption.textContent = `${quote.number} · ${pages.length} стр.`; els.previewModal.classList.remove('hidden'); }
  catch (error) { fail(error); }
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.rel='noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function downloadPdf() {
  try { const { blob, quote } = await buildPdfForCurrent(); triggerDownload(blob, `КП_${String(quote.number || 'House_Cleaning').replace(/[^A-Za-zА-Яа-я0-9_-]/g,'_')}.pdf`); toast('PDF сформирован'); }
  catch (error) { fail(error); }
}
async function sendPdfToTelegram() {
  try {
    if (isLocalDev) { toast('Локальный режим: отправка в Telegram отключена'); return; }
    const { blob, quote } = await buildPdfForCurrent(); const form = new FormData(); form.append('pdf', blob, `КП_${quote.number}.pdf`); form.append('number', quote.number || 'КП'); form.append('client', quote.client_name || '');
    await api('/api/kp/send-pdf', { method: 'POST', body: form }); toast('PDF отправлен вам в Telegram');
  } catch (error) { fail(error); }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name)); $('editorTab').classList.toggle('hidden', name !== 'editor'); $('historyTab').classList.toggle('hidden', name !== 'history'); if (name === 'history') refreshHistory().catch(fail);
}

document.querySelectorAll('.tab').forEach((btn)=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));
$('addItemBtn').addEventListener('click',()=>addItem('custom'));
$('newQuoteBtn').addEventListener('click',()=>{ if (!dirty || confirm('Начать новое КП? Несохранённые изменения будут очищены.')) resetNew(); });
['clientName','objectType','objectAddress','objectArea','quoteSubject','discountPercent','duration','prepaymentPercent','validDays','paymentTerms','notes'].forEach((id)=>$(id).addEventListener(id==='objectType'?'change':'input',markDirty));
$('saveBtn').addEventListener('click',()=>saveQuote().catch(fail)); $('previewBtn').addEventListener('click',previewPdf); $('downloadBtn').addEventListener('click',downloadPdf); $('sendTelegramBtn').addEventListener('click',sendPdfToTelegram); $('modalDownloadBtn').addEventListener('click',downloadPdf); $('closePreviewBtn').addEventListener('click',()=>els.previewModal.classList.add('hidden')); $('refreshHistoryBtn').addEventListener('click',()=>refreshHistory().catch(fail));
els.previewModal.addEventListener('click',(event)=>{if(event.target===els.previewModal)els.previewModal.classList.add('hidden')});
window.addEventListener('beforeunload',()=>{if(dirty)scheduleDraftSave()});
bootstrap();
