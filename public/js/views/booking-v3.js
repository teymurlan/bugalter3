import { renderBooking as renderBaseBooking } from './booking-v2.js?v=40';
import { state } from '../state.js';
import { showToast } from '../utils.js';

const MIN_BOOKING_LEAD_MS = 6 * 60 * 60 * 1000;
let scheduleObserver = null;
let observedRoot = null;

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function unitFrom(address, apartment) {
  const direct = normalize(apartment);
  if (direct) return direct;
  const match = String(address || '').match(/(?:квартира|кв\.?|офис)\s*([0-9а-яa-z-]+)/i);
  return normalize(match?.[1] || '');
}

function addressCore(value) {
  return normalize(String(value || '').replace(/(?:квартира|кв\.?|офис)\s*[0-9а-яa-z-]+/ig, ' '))
    .replace(/\b(улица|ул|проспект|просп|пр кт|переулок|пер|набережная|наб|шоссе)\b/g, ' ')
    .replace(/\b(дом|д)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameAddress(order, draft) {
  const city = normalize(order?.city) === normalize(draft?.city);
  const address = addressCore(order?.address) === addressCore(draft?.address);
  const apartment = unitFrom(order?.address, order?.apartment) === unitFrom(draft?.address, draft?.apartment);
  return city && address && apartment;
}

async function checkKnownAddress() {
  try {
    const headers = { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '' };
    const response = await fetch('/api/demo-client-orders', { headers, cache: 'no-store' });
    if (!response.ok) return false;
    const data = await response.json();
    return (Array.isArray(data?.orders) ? data.orders : []).some((order) => order?.status === 'COMPLETED' && sameAddress(order, state.draft));
  } catch {
    return false;
  }
}

function bookingTimestamp(date, time) {
  const day = String(date || '').trim();
  const clock = String(time || '').trim().slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(clock)) return NaN;
  return Date.parse(`${day}T${clock}:00+03:00`);
}

function bookingTimeAllowed(date, time) {
  const stamp = bookingTimestamp(date, time);
  return Number.isFinite(stamp) && stamp >= Date.now() + MIN_BOOKING_LEAD_MS;
}

function moscowIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function syncSchedule(root) {
  const card = root.querySelector('.hc-calendar-v2');
  if (!card || Number(state.draft?.step || 0) !== 6) return;

  const input = card.querySelector('[data-date]');
  if (input) input.min = moscowIsoDate();

  const head = card.querySelector('.hc-time-head');
  if (head && !card.querySelector('.hc-booking-lead-hint')) {
    const hint = document.createElement('small');
    hint.className = 'hc-booking-lead-hint';
    hint.textContent = 'Доступно время минимум через 6 часов от текущего момента.';
    head.insertAdjacentElement('afterend', hint);
  }

  const date = String(state.draft?.date || input?.value || '');
  let visible = 0;
  card.querySelectorAll('[data-time]').forEach((button) => {
    const allowed = bookingTimeAllowed(date, button.dataset.time);
    button.hidden = !allowed;
    if (!allowed) button.disabled = true;
    if (allowed && !button.classList.contains('unavailable')) visible += 1;
  });

  if (state.draft?.time && !bookingTimeAllowed(date, state.draft.time)) {
    state.draft.time = '';
    state.saveDraft();
  }

  const slots = card.querySelector('[data-slots]');
  const grid = slots?.querySelector('.slot-grid');
  let empty = slots?.querySelector('.hc-leadtime-empty');
  if (grid && visible === 0) {
    grid.hidden = true;
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'hc-leadtime-empty';
      empty.textContent = 'На эту дату подходящего времени уже нет. Выберите следующий день.';
      slots.appendChild(empty);
    }
  } else {
    if (grid) grid.hidden = false;
    empty?.remove();
  }

  const next = root.querySelector('[data-next]');
  if (next && !next.dataset.hcLeadGuard) {
    next.dataset.hcLeadGuard = '1';
    const original = next.onclick;
    next.onclick = (event) => {
      if (!state.draft?.date || !state.draft?.time || !bookingTimeAllowed(state.draft.date, state.draft.time)) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        state.draft.time = '';
        state.saveDraft();
        showToast('Выберите время минимум через 6 часов от текущего момента.', true);
        syncSchedule(root);
        return;
      }
      return original?.call(next, event);
    };
  }
}

function decorateSchedule(root) {
  syncSchedule(root);
  if (observedRoot === root && scheduleObserver) return;
  scheduleObserver?.disconnect?.();
  observedRoot = root;
  scheduleObserver = new MutationObserver(() => syncSchedule(root));
  scheduleObserver.observe(root, { childList: true, subtree: true });
}

function decoratePhotoStep(root, navigate) {
  const title = root.querySelector('.booking-title');
  if (title) title.textContent = 'Фотографии объекта';
  const subtitle = root.querySelector('.booking-title-block .page-subtitle');
  if (subtitle) subtitle.textContent = 'Для нового адреса фото обязательны. Если мы уже убирали именно этот адрес и квартиру/офис, фото можно пропустить.';
  const count = root.querySelector('.photo-count');
  if (count) {
    const spans = count.querySelectorAll('span');
    if (spans[1]) spans[1].textContent = state.photos.length ? 'Фото сохранены в черновике' : 'Можно продолжить — проверим адрес на следующем шаге';
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
  if (step === 6) decorateSchedule(root);
  if (step === 8) simplifyReview(root, navigate);
}
