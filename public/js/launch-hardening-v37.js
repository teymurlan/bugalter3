import { state } from './state.js';
import { showToast } from './utils.js';

const MIN_LEAD_MS = 6 * 60 * 60 * 1000;
const root = document.querySelector('#app');
let queued = false;

function bookingTimestamp(date, time) {
  const day = String(date || '').trim();
  const clock = String(time || '').trim().slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(clock)) return NaN;
  return Date.parse(`${day}T${clock}:00+03:00`);
}

function isAllowed(date, time) {
  const stamp = bookingTimestamp(date, time);
  return Number.isFinite(stamp) && stamp >= Date.now() + MIN_LEAD_MS;
}

function localMoscowDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function syncSchedule() {
  const card = root?.querySelector('.hc-calendar-v2');
  if (!card) return;

  const dateInput = card.querySelector('[data-date]');
  if (dateInput) dateInput.min = localMoscowDate();

  const head = card.querySelector('.hc-time-head');
  if (head && !card.querySelector('.hc-booking-lead-hint')) {
    const hint = document.createElement('small');
    hint.className = 'hc-booking-lead-hint';
    hint.textContent = 'Запись доступна минимум за 6 часов до начала уборки.';
    head.insertAdjacentElement('afterend', hint);
  }

  const date = String(state.draft?.date || dateInput?.value || '');
  let validSlots = 0;
  card.querySelectorAll('[data-time]').forEach((button) => {
    const allowed = isAllowed(date, button.dataset.time);
    button.hidden = !allowed;
    button.disabled = button.disabled || !allowed;
    if (allowed && !button.classList.contains('unavailable')) validSlots += 1;
  });

  const selectedInvalid = state.draft?.time && !isAllowed(date, state.draft.time);
  if (selectedInvalid) {
    state.draft.time = '';
    state.saveDraft();
  }

  const slots = card.querySelector('[data-slots]');
  const grid = slots?.querySelector('.slot-grid');
  let empty = slots?.querySelector('.hc-leadtime-empty');
  if (grid && validSlots === 0) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'hc-leadtime-empty';
      empty.textContent = 'На выбранную дату подходящего времени уже нет. Выберите следующий день.';
      slots.appendChild(empty);
    }
    grid.hidden = true;
  } else {
    if (grid) grid.hidden = false;
    empty?.remove();
  }

  const next = root.querySelector('[data-next]');
  if (next && card.contains(next) === false) {
    const valid = Boolean(state.draft?.date && state.draft?.time && isAllowed(state.draft.date, state.draft.time));
    if (!valid) next.disabled = true;
  }
}

function syncReview() {
  const review = root?.querySelector('.review-head');
  if (!review) return;
  const price = root.querySelector('.price-card');
  if (price) price.setAttribute('data-review-price-visible', '1');
}

function sync() {
  syncSchedule();
  syncReview();
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    sync();
  });
}

if (root) {
  new MutationObserver(queue).observe(root, { childList: true, subtree: true });
  queue();
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const slot = target.closest('[data-time]');
  if (slot && root?.querySelector('.hc-calendar-v2') && !isAllowed(state.draft?.date, slot.dataset.time)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast('Это время уже недоступно. Выберите время минимум через 6 часов.', true);
    queue();
    return;
  }

  const next = target.closest('[data-next]');
  if (next && root?.querySelector('.hc-calendar-v2')) {
    if (!state.draft?.date || !state.draft?.time || !isAllowed(state.draft.date, state.draft.time)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.draft.time = '';
      state.saveDraft();
      showToast('Выберите время минимум через 6 часов от текущего момента.', true);
      queue();
      return;
    }
  }

  if (next && root?.querySelector('.review-head') && !next.disabled) {
    const dock = next.closest('.wizard-actions');
    dock?.classList.add('is-submitting');
  }
}, true);

window.addEventListener('focus', queue);
document.addEventListener('visibilitychange', () => { if (!document.hidden) queue(); });
