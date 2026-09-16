import { state } from './state.js';
import { showToast } from './utils.js';

const root = document.querySelector('#app');
const tg = window.Telegram?.WebApp;
let checkingKnownAddress = false;

installStyles();
installFixes();

function installStyles() {
  if (document.querySelector('#hc-v46-date-style')) return;
  const style = document.createElement('style');
  style.id = 'hc-v46-date-style';
  style.textContent = `
    .hc-calendar-v2 .hc-manual-date{
      display:flex!important;
      flex-direction:column!important;
      align-items:stretch!important;
      gap:14px!important;
      width:100%!important;
      min-width:0!important;
      max-width:100%!important;
      padding:18px!important;
      border:1px solid #2a3b45!important;
      border-radius:22px!important;
      background:linear-gradient(145deg,#0d151a,#091015)!important;
      box-sizing:border-box!important;
      overflow:hidden!important;
    }
    .hc-calendar-v2 .hc-manual-date>span{
      display:block!important;
      width:100%!important;
      min-width:0!important;
    }
    .hc-date-control-v46{
      position:relative!important;
      display:block!important;
      width:100%!important;
      min-width:0!important;
      max-width:100%!important;
      height:64px!important;
      border:1px solid #344852!important;
      border-radius:18px!important;
      background:#10191f!important;
      box-sizing:border-box!important;
      overflow:hidden!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.025)!important;
      contain:paint!important;
    }
    .hc-date-display-v46{
      position:absolute!important;
      inset:0!important;
      display:flex!important;
      align-items:center!important;
      justify-content:space-between!important;
      gap:14px!important;
      width:100%!important;
      height:100%!important;
      padding:0 18px!important;
      box-sizing:border-box!important;
      color:#f4f6f7!important;
      font-size:19px!important;
      font-weight:750!important;
      line-height:1!important;
      pointer-events:none!important;
    }
    .hc-date-display-v46 small{
      flex:0 0 auto!important;
      font-size:22px!important;
      line-height:1!important;
      opacity:.9!important;
    }
    .hc-calendar-v2 .hc-date-control-v46 input.hc-native-date-v46{
      position:absolute!important;
      inset:0!important;
      display:block!important;
      width:100%!important;
      min-width:0!important;
      max-width:100%!important;
      height:100%!important;
      margin:0!important;
      padding:0!important;
      border:0!important;
      border-radius:18px!important;
      opacity:0!important;
      appearance:auto!important;
      -webkit-appearance:auto!important;
      box-sizing:border-box!important;
      z-index:3!important;
      cursor:pointer!important;
    }
    .hc-date-control-v46:focus-within{
      border-color:#efbd4b!important;
      box-shadow:0 0 0 3px rgba(239,189,75,.13)!important;
    }
    .hc-known-address-v46{
      margin:14px 0 0!important;
      padding:14px 16px!important;
      border:1px solid rgba(75,210,130,.26)!important;
      border-radius:16px!important;
      background:rgba(75,210,130,.09)!important;
      color:#91eab5!important;
      font-size:14px!important;
      line-height:1.45!important;
    }
    .photo-step.hc-repeat-address-v46 .photo-drop{display:none!important}
    .photo-step.hc-repeat-address-v46 .photo-grid:empty{display:none!important}
    @media(max-width:390px){
      .hc-calendar-v2 .hc-manual-date{padding:15px!important;border-radius:20px!important}
      .hc-date-control-v46{height:60px!important;border-radius:17px!important}
      .hc-date-display-v46{padding:0 16px!important;font-size:18px!important}
    }
  `;
  document.head.appendChild(style);
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function canonicalCity(value) {
  const v = normalize(value);
  if (!v) return '';
  if (v === 'спб' || v.includes('санкт петербург')) return 'spb';
  if (v.includes('ленинград') && v.includes('област')) return 'lo';
  return v;
}

function canonicalUnit(address, apartment) {
  const direct = normalize(apartment);
  if (direct) return direct.replace(/^0+(?=\d)/, '');
  const match = String(address || '').match(/(?:квартира|кв\.?|офис)\s*([0-9а-яa-z-]+)/i);
  return normalize(match?.[1] || '').replace(/^0+(?=\d)/, '');
}

function canonicalAddress(value) {
  const tokens = normalize(String(value || '')
    .replace(/(?:квартира|кв\.?|офис)\s*[0-9а-яa-z-]+/ig, ' '))
    .split(' ')
    .filter(Boolean);
  const stop = new Set([
    'россия','рф','город','г','санкт','петербург','спб','ленинградская','область',
    'улица','ул','проспект','просп','пр','переулок','пер','набережная','наб','шоссе',
    'дом','д'
  ]);
  return tokens.filter((token) => !stop.has(token)).join(' ');
}

function sameAddress(order, draft) {
  const orderAddress = canonicalAddress(order?.address);
  const draftAddress = canonicalAddress(draft?.address);
  if (!orderAddress || !draftAddress || orderAddress !== draftAddress) return false;

  const orderUnit = canonicalUnit(order?.address, order?.apartment);
  const draftUnit = canonicalUnit(draft?.address, draft?.apartment);
  if (orderUnit !== draftUnit) return false;

  const orderCity = canonicalCity(order?.city);
  const draftCity = canonicalCity(draft?.city);
  return !orderCity || !draftCity || orderCity === draftCity;
}

async function isRepeatAddress() {
  const draft = state.draft || {};
  if (!String(draft.address || '').trim()) return false;
  try {
    const response = await fetch('/api/demo-client-orders', {
      headers: { 'X-Telegram-Init-Data': tg?.initData || '' },
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    return orders.some((order) => Boolean(order?.order_number) && sameAddress(order, draft));
  } catch {
    return false;
  }
}

async function applyRepeatAddressState({ notify = false } = {}) {
  if (state.photos?.length) return false;
  const known = await isRepeatAddress();
  state.draft.knownAddress = known;
  state.draft.photoRequired = !known;
  state.saveDraft();
  if (known && notify) showToast('Этот адрес уже есть в истории — фото повторно не нужны');
  return known;
}

function formatDateRu(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 'Выберите дату';
  const months = ['янв.','февр.','мар.','апр.','мая','июн.','июл.','авг.','сент.','окт.','нояб.','дек.'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]} г.`;
}

function polishDatePicker() {
  if (Number(state.draft?.step || 0) !== 6) return;
  const input = root?.querySelector('.hc-calendar-v2 [data-date]');
  if (!input || input.closest('.hc-date-control-v46')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'hc-date-control-v46';
  const display = document.createElement('div');
  display.className = 'hc-date-display-v46';
  display.innerHTML = `<span>${formatDateRu(input.value || state.draft?.date)}</span><small aria-hidden="true">▣</small>`;

  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(display);
  wrapper.appendChild(input);
  input.classList.add('hc-native-date-v46');
  input.setAttribute('aria-label', 'Выбрать другую дату');

  const sync = () => {
    const text = wrapper.querySelector('.hc-date-display-v46 span');
    if (text) text.textContent = formatDateRu(input.value || state.draft?.date);
  };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
}

async function polishPhotoStep() {
  if (Number(state.draft?.step || 0) !== 4) return;
  const step = root?.querySelector('.photo-step');
  if (!step || checkingKnownAddress || state.photos?.length) return;
  if (!String(state.draft?.address || '').trim()) return;

  checkingKnownAddress = true;
  try {
    const known = await applyRepeatAddressState();
    if (!known || Number(state.draft?.step || 0) !== 4) return;
    step.classList.add('hc-repeat-address-v46');
    const count = step.querySelector('.photo-count');
    if (count) {
      const spans = count.querySelectorAll('span');
      if (spans[0]) spans[0].textContent = 'Фото не требуются';
      if (spans[1]) spans[1].textContent = 'Адрес и квартира уже есть в истории заказов';
    }
    if (!step.querySelector('.hc-known-address-v46')) {
      step.insertAdjacentHTML('beforeend', '<div class="hc-known-address-v46">Повторный заказ на тот же адрес и квартиру. Загружать фотографии объекта ещё раз не нужно.</div>');
    }
    const next = root.querySelector('[data-next]');
    if (next) next.disabled = false;
  } finally {
    checkingKnownAddress = false;
  }
}

function guardFinalReview() {
  if (Number(state.draft?.step || 0) !== 8) return;
  const next = root?.querySelector('[data-next]');
  if (!next || next.dataset.hcV46RepeatGuard) return;
  next.dataset.hcV46RepeatGuard = '1';
  const original = next.onclick;
  next.onclick = async (event) => {
    if (!state.photos?.length) {
      await applyRepeatAddressState({ notify: true });
    }
    return original?.call(next, event);
  };
}

function installFixes() {
  if (!root) return;
  let scheduled = false;
  const decorate = () => {
    polishDatePicker();
    polishPhotoStep();
    guardFinalReview();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  };
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  schedule();
}
