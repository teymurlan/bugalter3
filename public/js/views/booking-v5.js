import { renderBooking as renderBaseBooking } from './booking-v2.js?v=52';
import { state } from '../state.js';
import { showToast } from '../utils.js';

let activeRoot = null;
let activeNavigate = null;

const STEP_NAMES = {
  1: 'Услуга',
  2: 'Объект',
  3: 'Дополнительно',
  4: 'Адрес',
  5: 'Заказ',
  6: 'Фото',
  7: 'Дата',
  8: 'Контакты',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function addressLooksValid(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (raw.length < 6 || raw.length > 160) return false;
  const letters = raw.match(/[A-Za-zА-Яа-яЁё]/g) || [];
  const digits = raw.match(/\d/g) || [];
  const words = raw.split(/[\s,]+/).filter(Boolean);
  return letters.length >= 4 && digits.length >= 1 && words.length >= 2 && !/(.)\1{5,}/i.test(raw);
}

function saveVisitChoice(type) {
  const first = type === 'first';
  state.draft.visitType = first ? 'first' : 'repeat';
  state.draft.visitTypeConfirmed = false;
  state.draft.photoRequired = first;
  state.draft.knownAddress = false;
  state.draft.photoAddressKey = '';
  state.saveDraft();
}

function resetVisitChoice() {
  state.draft.visitType = '';
  state.draft.visitTypeConfirmed = false;
  state.draft.photoRequired = null;
  state.draft.knownAddress = false;
  state.draft.photoAddressKey = '';
  state.saveDraft();
}

function renderProgress(current, name) {
  return `<div class="booking-top"><div><div class="progress-label">Шаг ${current} из 8 · ${escapeHtml(name)}</div><div class="progress-bars">${Array.from({ length: 8 }, (_, index) => `<i class="${index < current ? 'done' : ''}"></i>`).join('')}</div></div></div>`;
}

function renderVisitType(root, navigate) {
  activeRoot = root;
  activeNavigate = navigate;
  const selected = state.draft.visitType;
  root.innerHTML = `
    ${renderProgress(5, 'Заказ')}
    <div class="booking-title-block">
      <h1 class="page-title booking-title">Вы уже заказывали уборку по этому адресу?</h1>
      <p class="page-subtitle">Выберите один вариант. Для повторного заказа фотографии не запрашиваем.</p>
    </div>
    <div class="hc-visit-type-grid" role="radiogroup" aria-label="Первый или повторный заказ">
      <button type="button" class="hc-visit-type-card ${selected === 'first' ? 'selected' : ''}" data-visit-type="first" role="radio" aria-checked="${selected === 'first'}">
        <span class="hc-visit-radio" aria-hidden="true"></span>
        <span class="hc-visit-copy"><strong>Первый заказ</strong><small>Заказываю уборку по этому адресу впервые.</small><em>Фото объекта обязательно</em></span>
      </button>
      <button type="button" class="hc-visit-type-card ${selected === 'repeat' ? 'selected' : ''}" data-visit-type="repeat" role="radio" aria-checked="${selected === 'repeat'}">
        <span class="hc-visit-radio" aria-hidden="true"></span>
        <span class="hc-visit-copy"><strong>Повторный заказ</strong><small>Раньше уже заказывал(а) уборку по этому адресу.</small><em>Сразу к дате и времени</em></span>
      </button>
    </div>
    <div class="hc-visit-hint">При повторном заказе после подтверждения сразу откроется выбор даты и времени.</div>
    <div class="wizard-actions">
      <button class="secondary-btn wizard-back" data-back type="button">← <span>Назад</span></button>
      <button class="primary-btn wizard-next" data-next type="button" ${selected ? '' : 'disabled'}>Продолжить</button>
    </div>`;

  root.querySelectorAll('[data-visit-type]').forEach((button) => {
    button.onclick = () => {
      saveVisitChoice(button.dataset.visitType);
      renderVisitType(root, navigate);
    };
  });

  root.querySelector('[data-back]').onclick = () => {
    state.draft.step = 4;
    state.saveDraft();
    renderBooking(root, navigate);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  root.querySelector('[data-next]').onclick = () => {
    if (!['first', 'repeat'].includes(state.draft.visitType)) {
      return showToast('Выберите: первый или повторный заказ', true);
    }
    const repeat = state.draft.visitType === 'repeat';
    state.draft.visitTypeConfirmed = true;
    state.draft.photoRequired = !repeat;
    state.draft.step = repeat ? 6 : 5;
    state.saveDraft();
    renderBooking(root, navigate);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
}

function patchProgress(root, current, name) {
  const top = root.querySelector('.booking-top');
  if (!top) return;
  const label = top.querySelector('.progress-label');
  const bars = top.querySelector('.progress-bars');
  if (label) label.textContent = `Шаг ${current} из 8 · ${name}`;
  if (bars && bars.children.length !== 8) {
    bars.innerHTML = Array.from({ length: 8 }, (_, index) => `<i class="${index < current ? 'done' : ''}"></i>`).join('');
  } else if (bars) {
    [...bars.children].forEach((bar, index) => bar.classList.toggle('done', index < current));
  }
}

function patchAddressStep(root, navigate) {
  patchProgress(root, 4, STEP_NAMES[4]);
  const next = root.querySelector('[data-next]');
  if (!next || next.dataset.hcVisitPatched === '1') return;
  next.dataset.hcVisitPatched = '1';

  root.querySelectorAll('[data-field="address"],[data-field="apartment"]').forEach((input) => {
    if (input.dataset.hcVisitPatched === '1') return;
    input.dataset.hcVisitPatched = '1';
    input.addEventListener('input', () => {
      if (state.draft.visitType || state.draft.visitTypeConfirmed || state.draft.photoRequired !== null) resetVisitChoice();
    });
  });

  root.querySelectorAll('[data-location]').forEach((button) => {
    if (button.dataset.hcVisitPatched === '1') return;
    button.dataset.hcVisitPatched = '1';
    button.addEventListener('click', () => resetVisitChoice());
  });

  next.onclick = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const addressInput = root.querySelector('[data-field="address"]');
    const clean = String(addressInput?.value || state.draft.address || '').trim().replace(/\s+/g, ' ');
    if (!addressLooksValid(clean)) {
      addressInput?.classList.add('input-error');
      addressInput?.focus();
      return showToast(state.draft?.serviceArea === 'lo'
        ? 'Укажите населённый пункт, улицу и номер дома'
        : 'Укажите улицу и номер дома', true);
    }
    state.draft.address = clean;
    resetVisitChoice();
    state.draft.step = 5;
    state.saveDraft();
    renderVisitType(root, navigate);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
}

function patchPhotoStep(root, navigate) {
  if (state.draft.visitType === 'repeat' && state.draft.visitTypeConfirmed) {
    state.draft.photoRequired = false;
    state.draft.step = 6;
    state.saveDraft();
    renderBooking(root, navigate);
    return;
  }

  if (!state.draft.visitTypeConfirmed || state.draft.visitType !== 'first') {
    if (!root.querySelector('.hc-visit-type-grid')) renderVisitType(root, navigate);
    else patchProgress(root, 5, STEP_NAMES[5]);
    return;
  }

  const step = root.querySelector('.photo-step');
  if (!step) return;
  patchProgress(root, 6, STEP_NAMES[6]);
  const title = root.querySelector('.booking-title');
  const subtitle = root.querySelector('.booking-title-block .page-subtitle');
  const status = root.querySelector('.photo-count span:last-child');

  if (title) title.textContent = 'Фотографии объекта';
  if (subtitle) subtitle.textContent = 'Для первого заказа добавьте минимум одну фотографию объекта для предварительной оценки.';
  if (status && !state.photos.length) status.textContent = 'Добавьте минимум одно фото';

  const back = root.querySelector('[data-back]');
  if (back && back.dataset.hcVisitPatched !== '1') {
    back.dataset.hcVisitPatched = '1';
    back.onclick = () => {
      state.draft.visitTypeConfirmed = false;
      state.saveDraft();
      renderVisitType(root, navigate);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
  }

  const next = root.querySelector('[data-next]');
  if (next) {
    next.disabled = state.photos.length < 1;
    if (next.dataset.hcVisitPatched !== '1') {
      next.dataset.hcVisitPatched = '1';
      next.onclick = () => {
        if (!state.photos.length) return showToast('Для первого заказа добавьте минимум одно фото', true);
        state.draft.photoRequired = true;
        state.draft.step = 6;
        state.saveDraft();
        renderBooking(root, navigate);
        window.scrollTo({ top: 0, behavior: 'instant' });
      };
    }
  }
}

function patchScheduleStep(root, navigate) {
  patchProgress(root, 7, STEP_NAMES[7]);
  if (state.draft.visitType !== 'repeat' || !state.draft.visitTypeConfirmed) return;
  const back = root.querySelector('[data-back]');
  if (!back || back.dataset.hcRepeatBackPatched === '1') return;
  back.dataset.hcRepeatBackPatched = '1';
  back.onclick = () => {
    state.draft.visitTypeConfirmed = false;
    state.draft.step = 5;
    state.saveDraft();
    renderVisitType(root, navigate);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
}

function patchCurrent(root, navigate) {
  if (!root || !document.contains(root)) return;
  const step = Number(state.draft?.step || 0);
  if (step >= 1 && step <= 4) patchProgress(root, step, STEP_NAMES[step]);
  if (step === 4) patchAddressStep(root, navigate);
  if (step === 5) patchPhotoStep(root, navigate);
  if (step === 6) patchScheduleStep(root, navigate);
  if (step === 7) patchProgress(root, 8, STEP_NAMES[8]);
}

function syncGlobalBack(root) {
  const original = root.querySelector('.wizard-actions [data-back]');
  const existing = root.querySelector('[data-global-booking-back]');
  if (!original) {
    existing?.remove();
    return;
  }
  original.classList.add('hc-original-back-hidden');
  if (existing) {
    existing.onclick = () => original.click();
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.globalBookingBack = '1';
  button.className = 'cc-back hc-booking-back hc-fixed-back';
  button.textContent = '← Назад';
  button.onclick = () => original.click();
  const top = root.querySelector('.booking-top');
  if (top) top.insertAdjacentElement('afterend', button);
  else root.prepend(button);
}

export function renderBooking(root, navigate) {
  activeRoot = root;
  activeNavigate = navigate;

  if (Number(state.draft?.step || 0) === 5 && !state.draft.visitTypeConfirmed) {
    renderVisitType(root, navigate);
    syncGlobalBack(root);
    return;
  }

  if (Number(state.draft?.step || 0) === 5 && state.draft.visitType === 'repeat' && state.draft.visitTypeConfirmed) {
    state.draft.photoRequired = false;
    state.draft.step = 6;
    state.saveDraft();
  }

  if (Number(state.draft?.step || 0) === 5) state.draft.photoRequired = true;

  renderBaseBooking(root, navigate);
  patchCurrent(root, navigate);
  syncGlobalBack(root);
}
