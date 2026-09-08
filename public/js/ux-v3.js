import { api } from './api.js';
import { state } from './state.js';

const DAILY_CAPACITY_M2 = 300;
let focusTimer = null;

function localIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDate(value) {
  const parts = String(value || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function keyboardDoneButton() {
  let button = document.querySelector('#keyboard-done');
  if (button) return button;
  button = document.createElement('button');
  button.id = 'keyboard-done';
  button.type = 'button';
  button.innerHTML = '<span>✓</span> Готово';
  button.className = 'keyboard-done hidden';
  button.onclick = () => document.activeElement?.blur?.();
  document.body.appendChild(button);
  return button;
}

function openKeyboardMode(target) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
  if (target.type === 'file' || target.type === 'range' || target.type === 'date') return;
  document.body.classList.add('keyboard-open');
  keyboardDoneButton().classList.remove('hidden');
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    const field = target.closest('.field') || target;
    field.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, 180);
}

function closeKeyboardMode() {
  clearTimeout(focusTimer);
  setTimeout(() => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
    document.body.classList.remove('keyboard-open');
    keyboardDoneButton().classList.add('hidden');
  }, 140);
}

document.addEventListener('focusin', (event) => openKeyboardMode(event.target));
document.addEventListener('focusout', closeKeyboardMode);

function enhanceHome() {
  const hero = document.querySelector('.home-hero');
  if (!hero || hero.dataset.v3Home === '1') return;
  hero.dataset.v3Home = '1';

  const benefits = document.querySelector('.quick-benefits');
  if (benefits) {
    benefits.innerHTML = '<div><b>2 минуты</b><span>понятное оформление</span></div><div><b>Фото объекта</b><span>точнее оценим работу</span></div><div><b>Свободные даты</b><span>видны сразу в календаре</span></div>';
  }
}

function desiredCalendarDates(selectedValue, count = 11) {
  const selected = parseLocalDate(selectedValue);
  if (!selected) return [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const half = Math.floor(count / 2);
  const start = new Date(selected);
  start.setDate(selected.getDate() - half);
  if (start < today) start.setTime(today.getTime());
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return date;
  });
}

function calendarDay(date, data, selectedValue) {
  const requested = Number(state.draft.area || 0);
  const remaining = Number.isFinite(Number(data.remainingM2)) ? Number(data.remainingM2) : DAILY_CAPACITY_M2;
  const used = Number.isFinite(Number(data.usedM2)) ? Number(data.usedM2) : 0;
  const dateValue = localIso(date);
  const full = data.closed || remaining <= 0;
  const insufficient = !full && requested > remaining;
  const stateClass = full ? 'full' : used > 0 ? 'partial' : 'free';
  const label = full ? 'Занято' : insufficient ? `Ост. ${remaining} м²` : used > 0 ? `Своб. ${remaining} м²` : 'Свободно';
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date).replace('.', '');
  const month = new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(date).replace('.', '');
  return `<button type="button" class="calendar-day ${stateClass} ${selectedValue === dateValue ? 'selected' : ''} ${insufficient ? 'insufficient' : ''}" data-calendar-date="${dateValue}" ${full || insufficient ? 'disabled' : ''}><span>${weekday}</span><b>${date.getDate()}</b><small>${month}</small><em>${label}</em></button>`;
}

async function enhanceCalendar() {
  const strip = document.querySelector('[data-calendar]');
  const input = document.querySelector('[data-date]');
  const selectedValue = state.draft.date || input?.value || '';
  if (!strip || !selectedValue) return;

  const dates = desiredCalendarDates(selectedValue);
  if (!dates.length) return;
  const desiredStart = localIso(dates[0]);
  const first = strip.querySelector('[data-calendar-date]')?.dataset.calendarDate || '';
  if (first === desiredStart && strip.dataset.v3Selected === selectedValue) return;
  if (strip.dataset.v3Loading === selectedValue) return;

  strip.dataset.v3Loading = selectedValue;
  let label = strip.parentElement?.querySelector('.calendar-near-label');
  if (!label) {
    label = document.createElement('div');
    label.className = 'calendar-near-label';
    strip.before(label);
  }
  label.textContent = 'Даты рядом с выбранной';

  try {
    const results = await Promise.all(dates.map((date) => api.availability(localIso(date))));
    if (!document.body.contains(strip) || (state.draft.date || input?.value || '') !== selectedValue) return;
    strip.innerHTML = results.map((data, index) => calendarDay(dates[index], data, selectedValue)).join('');
    strip.dataset.v3Selected = selectedValue;

    strip.querySelectorAll('[data-calendar-date]').forEach((button) => {
      button.onclick = () => {
        if (button.disabled) return;
        state.draft.date = button.dataset.calendarDate;
        state.draft.time = '';
        state.saveDraft();
        const dateInput = document.querySelector('[data-date]');
        if (dateInput) {
          dateInput.value = button.dataset.calendarDate;
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };
    });

    strip.querySelector('.calendar-day.selected')?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  } catch (error) {
    console.warn('Nearby calendar enhancement failed', error);
  } finally {
    delete strip.dataset.v3Loading;
  }
}

let enhanceTimer = null;
function scheduleEnhance() {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(() => {
    enhanceHome();
    enhanceCalendar();
  }, 30);
}

const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.documentElement, { childList: true, subtree: true });
scheduleEnhance();
