import { renderBooking as renderBaseBooking } from './booking-v2.js?v=34';
import { state } from '../state.js';
import { showToast } from '../utils.js';

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function sameAddress(order, draft) {
  const city = normalize(order?.city) === normalize(draft?.city);
  const address = normalize(order?.address) === normalize(draft?.address);
  const apartment = normalize(order?.apartment) === normalize(draft?.apartment);
  return city && address && apartment;
}

async function checkKnownAddress() {
  try {
    const headers = { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
    const response = await fetch('/api/demo-client-orders', { headers });
    if (!response.ok) return false;
    const data = await response.json();
    return (Array.isArray(data?.orders) ? data.orders : []).some((order) => order?.status === 'COMPLETED' && sameAddress(order, state.draft));
  } catch {
    return false;
  }
}

function decoratePhotoStep(root, navigate) {
  const title = root.querySelector('.booking-title');
  if (title) title.textContent = 'Фотографии объекта';
  const subtitle = root.querySelector('.booking-title-block .page-subtitle');
  if (subtitle) subtitle.textContent = 'Для нового адреса фото обязательны. Если мы уже убирали этот адрес, их можно будет пропустить.';
  const count = root.querySelector('.photo-count');
  if (count) {
    const spans = count.querySelectorAll('span');
    if (spans[1]) spans[1].textContent = state.photos.length ? 'Фото сохранены в черновике' : 'Можно продолжить — обязательность проверим по адресу';
  }
  const next = root.querySelector('[data-next]');
  if (next) {
    next.disabled = false;
    next.onclick = () => {
      state.draft.step = 5;
      state.saveDraft();
      renderBooking(root, navigate);
    };
  }
}

function decorateAddressStep(root, navigate) {
  const next = root.querySelector('[data-next]');
  if (!next) return;
  const original = next.onclick;
  next.onclick = async (event) => {
    const clean = String(state.draft.address || '').trim();
    if (clean.length < 6 || !/\d/.test(clean)) {
      return original?.call(next, event);
    }
    next.disabled = true;
    const known = await checkKnownAddress();
    state.draft.knownAddress = known;
    state.draft.photoRequired = !known;
    state.saveDraft();
    next.disabled = false;
    original?.call(next, event);
  };
}

function simplifyReview(root, navigate) {
  const subtitle = root.querySelector('.review-head .page-subtitle');
  if (subtitle) subtitle.textContent = 'Проверьте главное перед отправкой. После оформления менеджер подтвердит детали.';

  root.querySelectorAll('.summary-row').forEach((row) => {
    const label = String(row.querySelector('span')?.textContent || '').trim();
    if (label === 'Комнаты / санузлы') row.remove();
    if (label === 'Фото для оценки') {
      const value = row.querySelector('strong');
      if (value) {
        value.textContent = state.photos.length
          ? `${state.photos.length} шт.`
          : state.draft.knownAddress
            ? 'Не требуются — адрес уже обслуживали'
            : 'Обязательны для нового адреса';
      }
    }
  });

  const priceCard = root.querySelector('.price-card');
  if (priceCard && !root.querySelector('.hc-final-review-note')) {
    const note = document.createElement('div');
    note.className = 'hc-final-review-note';
    note.textContent = 'Точная стоимость подтверждается менеджером после проверки заявки.';
    priceCard.insertAdjacentElement('afterend', note);
  }

  const next = root.querySelector('[data-next]');
  if (!next) return;
  next.disabled = false;
  const original = next.onclick;
  next.onclick = async (event) => {
    if (state.draft.photoRequired !== false && !state.photos.length) {
      showToast('Для нового адреса добавьте минимум одно фото объекта', true);
      state.draft.step = 4;
      state.saveDraft();
      renderBooking(root, navigate);
      return;
    }
    return original?.call(next, event);
  };
}

export function renderBooking(root, navigate) {
  renderBaseBooking(root, navigate);
  const step = Number(state.draft?.step || 0);
  if (step === 4) decoratePhotoStep(root, navigate);
  if (step === 5) decorateAddressStep(root, navigate);
  if (step === 8) simplifyReview(root, navigate);
}
