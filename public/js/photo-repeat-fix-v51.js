import { state } from './state.js';

const root = document.querySelector('#app');
let queued = false;

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cityCore(value) {
  const city = normalize(value);
  if (!city) return '';
  if (city === 'спб' || city.includes('санкт петербург')) return 'spb';
  if (city.includes('ленинград') && city.includes('област')) return 'lo';
  return city;
}

function unitFrom(address, apartment) {
  const direct = normalize(apartment);
  if (direct) return direct.replace(/^0+(?=\d)/, '');
  const match = String(address || '').match(/(?:квартира|кв\.?\s*\/?\s*офис|кв\.?|офис)\s*[:№#-]?\s*([0-9а-яa-z-]+)/i);
  return normalize(match?.[1] || '').replace(/^0+(?=\d)/, '');
}

function addressCore(value) {
  const withoutUnit = String(value || '').replace(/(?:квартира|кв\.?\s*\/?\s*офис|кв\.?|офис)\s*[:№#-]?\s*[0-9а-яa-z-]+/ig, ' ');
  const tokens = normalize(withoutUnit).split(' ').filter(Boolean);
  const stop = new Set([
    'россия','рф','город','г','санкт','петербург','спб','ленинградская','область',
    'улица','ул','проспект','просп','пр','переулок','пер','набережная','наб','шоссе',
    'дом','д'
  ]);
  return tokens.filter((token) => !stop.has(token)).join(' ');
}

function currentDecisionKey() {
  const address = addressCore(state.draft?.address);
  if (!address) return '';
  return [cityCore(state.draft?.city), address, unitFrom(state.draft?.address, state.draft?.apartment)].join('|');
}

function repeatAddressConfirmed() {
  if (state.draft?.knownAddress !== true || state.draft?.photoRequired !== false) return false;
  const key = currentDecisionKey();
  if (!key) return false;
  const saved = String(state.draft?.photoAddressKey || '');
  if (saved && saved !== key) return false;
  if (!saved) {
    state.draft.photoAddressKey = key;
    state.saveDraft();
  }
  return true;
}

function applyRepeatAddressUi() {
  if (!root || Number(state.draft?.step || 0) !== 5) return;
  const step = root.querySelector('.photo-step');
  if (!step || !repeatAddressConfirmed()) return;

  const title = root.querySelector('.booking-title');
  if (title) title.textContent = 'Фотографии объекта';
  const subtitle = root.querySelector('.booking-title-block .page-subtitle');
  if (subtitle) subtitle.textContent = 'Для нового адреса фото обязательны. Для повторного заказа на тот же адрес и квартиру фото повторно не нужны.';

  step.classList.add('hc-repeat-address');
  const drop = step.querySelector('.photo-drop');
  if (drop) drop.hidden = true;

  const count = step.querySelector('.photo-count');
  if (count) count.innerHTML = '<span>Фото не требуются</span><span>Адрес и квартира уже есть в истории заказов</span>';

  root.querySelectorAll('.hc-known-address-note,.hc-known-address-v46').forEach((node) => node.remove());
  if (!step.querySelector('.hc-known-address-note')) {
    step.insertAdjacentHTML('beforeend', '<div class="hc-known-address-note">Мы уже обслуживали этот адрес и квартиру. Можно продолжить без повторной загрузки фотографий.</div>');
  }

  const next = root.querySelector('[data-next]');
  if (next) next.disabled = false;
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    applyRepeatAddressUi();
  });
}

if (root) {
  new MutationObserver(queue).observe(root, { childList: true, subtree: true });
  queue();
}

window.addEventListener('focus', queue);
document.addEventListener('visibilitychange', () => { if (!document.hidden) queue(); });
