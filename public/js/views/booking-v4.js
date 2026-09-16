import { renderBooking as renderBookingV3 } from './booking-v3.js?v=50';
import { state } from '../state.js';
import { showToast } from '../utils.js';
import { sharedKnownAddress } from '../api-shared-v50.js?v=50';

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

function decisionKey() {
  const address = addressCore(state.draft?.address);
  if (!address) return '';
  return [cityCore(state.draft?.city), address, unitFrom(state.draft?.address, state.draft?.apartment)].join('|');
}

function addressLooksValid(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  const letters = raw.match(/[A-Za-zА-Яа-яЁё]/g) || [];
  const digits = raw.match(/\d/g) || [];
  const words = raw.split(/[\s,]+/).filter(Boolean);
  return raw.length >= 6 && raw.length <= 160 && letters.length >= 4 && digits.length >= 1 && words.length >= 2 && !/(.)\1{5,}/i.test(raw);
}

async function persistDraftNow() {
  state.saveDraft();
  const initData = window.Telegram?.WebApp?.initData || '';
  if (!initData) return;
  try {
    await fetch('/api/client-draft', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
      },
      body: JSON.stringify({ draft: state.draft }),
      cache: 'no-store',
    });
  } catch (error) {
    console.warn('Repeat-address draft sync skipped', error);
  }
}

function setDecision(known) {
  state.draft.knownAddress = Boolean(known);
  state.draft.photoRequired = !known;
  state.draft.photoAddressKey = decisionKey();
}

function patchAddressContinue(root, navigate) {
  const next = root.querySelector('[data-next]');
  if (!next) return;

  next.onclick = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const addressInput = root.querySelector('[data-field="address"]');
    const apartmentInput = root.querySelector('[data-field="apartment"]');
    const cleanAddress = String(addressInput?.value || state.draft.address || '').trim().replace(/\s+/g, ' ');
    const apartment = String(apartmentInput?.value || state.draft.apartment || '').trim();

    if (!addressLooksValid(cleanAddress)) {
      addressInput?.classList.add('input-error');
      addressInput?.focus();
      return showToast(state.draft?.serviceArea === 'lo'
        ? 'Укажите населённый пункт, улицу и номер дома'
        : 'Укажите улицу и номер дома', true);
    }

    state.draft.address = cleanAddress;
    state.draft.apartment = apartment;
    state.draft.city = state.draft?.serviceArea === 'lo' ? 'Ленинградская область' : 'Санкт-Петербург';

    next.disabled = true;
    next.textContent = 'Проверяем адрес...';
    try {
      const known = await sharedKnownAddress({
        city: state.draft.city,
        address: state.draft.address,
        apartment: state.draft.apartment,
      });
      setDecision(known);
      state.draft.step = 5;
      await persistDraftNow();
      renderBooking(root, navigate);
    } catch (error) {
      // Не разрешаем пропустить фото, если серверную историю проверить не удалось.
      setDecision(false);
      await persistDraftNow();
      state.draft.step = 5;
      state.saveDraft();
      renderBooking(root, navigate);
      showToast('Историю адреса проверить не удалось — добавьте фото объекта', true);
    }
  };
}

export function renderBooking(root, navigate) {
  renderBookingV3(root, navigate);
  if (Number(state.draft?.step || 0) === 4) patchAddressContinue(root, navigate);
}
