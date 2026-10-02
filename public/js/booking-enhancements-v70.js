import { state } from './state.js';
import { compressImage, showToast } from './utils.js';

const params = new URLSearchParams(location.search);
const CLIENT_MODE = params.get('admin') !== '1' && params.get('staff') !== '1';
const availabilityByDate = new Map();
const nativeFetch = window.fetch.bind(window);
let decorateQueued = false;

function asUrl(input) {
  try {
    if (typeof input === 'string' || input instanceof URL) return new URL(String(input), location.origin);
    if (input instanceof Request) return new URL(input.url, location.origin);
  } catch {}
  return null;
}

/* Cache the same server availability payload the booking screen consumes. This
   lets every date card show both used and remaining m² without a second API call. */
if (CLIENT_MODE && !window.__HC_AVAILABILITY_FETCH_V70) {
  window.__HC_AVAILABILITY_FETCH_V70 = true;
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    try {
      const url = asUrl(input);
      if (response.ok && url?.origin === location.origin && ['/api/demo-availability', '/api/availability'].includes(url.pathname)) {
        response.clone().json().then((data) => {
          const date = String(data?.date || url.searchParams.get('date') || '');
          if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            availabilityByDate.set(date, data || {});
            queueDecorate();
          }
        }).catch(() => {});
      }
    } catch {}
    return response;
  };
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function decorateCalendar() {
  document.querySelectorAll('.calendar-strip[data-calendar]').forEach((strip) => {
    strip.dataset.hcHorizontalV70 = '1';
    strip.setAttribute('aria-label', 'Ближайшие свободные даты. Листайте вправо и влево.');

    strip.querySelectorAll('[data-calendar-date]').forEach((button) => {
      const date = String(button.dataset.calendarDate || '');
      const data = availabilityByDate.get(date);
      if (!data) return;
      const capacity = Math.max(0, finite(data.capacityM2, 300));
      const used = Math.max(0, finite(data.usedM2, 0));
      const remaining = Math.max(0, finite(data.remainingM2, Math.max(0, capacity - used)));
      let info = button.querySelector('em');
      if (!info) {
        info = document.createElement('em');
        button.appendChild(info);
      }
      info.className = 'hc-capacity-v70';
      info.innerHTML = `<span class="used">Занято ${Math.round(used)} м²</span><span class="left">Осталось ${Math.round(remaining)} м²</span>`;
      const day = button.querySelector('b')?.textContent?.trim() || '';
      const month = button.querySelector('small')?.textContent?.trim() || '';
      button.setAttribute('aria-label', `${day} ${month}. Занято ${Math.round(used)} м², осталось ${Math.round(remaining)} м²`);
    });
  });
}

function decorateVisitType() {
  const first = document.querySelector('[data-visit-type="first"] .hc-visit-copy');
  const repeat = document.querySelector('[data-visit-type="repeat"] .hc-visit-copy');
  if (first) {
    first.querySelector('strong') && (first.querySelector('strong').textContent = 'Первая уборка');
    first.querySelector('small') && (first.querySelector('small').textContent = 'Убираемся по этому адресу впервые.');
    first.querySelector('em') && (first.querySelector('em').textContent = 'Фото объекта обязательно');
  }
  if (repeat) {
    repeat.querySelector('strong') && (repeat.querySelector('strong').textContent = 'Повторная уборка');
    repeat.querySelector('small') && (repeat.querySelector('small').textContent = 'Мы уже убирались по этому адресу.');
    repeat.querySelector('em') && (repeat.querySelector('em').textContent = 'Фото можно не добавлять');
  }
  const title = document.querySelector('.hc-visit-type-grid')?.closest('#app')?.querySelector('.booking-title');
  if (title) title.textContent = 'Это первая или повторная уборка?';
}

function ensureProgress(photoStep) {
  let progress = photoStep.querySelector('.hc-photo-upload-v70');
  if (!progress) {
    progress = document.createElement('div');
    progress.className = 'hc-photo-upload-v70';
    progress.setAttribute('role', 'status');
    progress.setAttribute('aria-live', 'polite');
    progress.innerHTML = '<span class="spinner" aria-hidden="true"></span><div><strong data-photo-progress-title>Подготавливаем фотографии…</strong><small data-photo-progress-sub>Пожалуйста, не закрывайте окно</small></div>';
    const drop = photoStep.querySelector('.photo-drop');
    (drop || photoStep.firstElementChild)?.insertAdjacentElement('afterend', progress);
  }
  return progress;
}

function setPhotoProgress(progress, title, sub, done = false) {
  if (!progress) return;
  progress.classList.add('show');
  progress.classList.toggle('done', Boolean(done));
  const strong = progress.querySelector('[data-photo-progress-title]');
  const small = progress.querySelector('[data-photo-progress-sub]');
  if (strong) strong.textContent = title;
  if (small) small.textContent = sub;
}

function rerenderBooking() {
  const nav = window.HCNavigation;
  if (nav?.navigate) return nav.navigate('booking', {}, { replace:true });
  try { window.dispatchEvent(new CustomEvent('hc:booking-rendered', { detail:{ step:Number(state.draft?.step || 0) } })); } catch {}
}

function patchPhotoInput() {
  const input = document.querySelector('#photo-input');
  const photoStep = input?.closest('.photo-step');
  if (!input || !photoStep || input.dataset.hcUploadV70 === '1') return;
  input.dataset.hcUploadV70 = '1';
  const drop = photoStep.querySelector('.photo-drop');
  const progress = ensureProgress(photoStep);

  input.onchange = async () => {
    const room = Math.max(0, 10 - state.photos.length);
    const files = [...(input.files || [])].slice(0, room);
    if (!files.length) return;
    input.disabled = true;
    drop?.classList.add('hc-photo-busy-v70');
    const next = document.querySelector('.wizard-actions [data-next]');
    const previousDisabled = Boolean(next?.disabled);
    if (next) next.disabled = true;

    try {
      setPhotoProgress(progress, `Подготавливаем фото 1 из ${files.length}`, 'На Android это может занять несколько секунд');
      for (let index = 0; index < files.length; index += 1) {
        setPhotoProgress(progress, `Подготавливаем фото ${index + 1} из ${files.length}`, 'Сжимаем изображение для быстрой отправки');
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const compressed = await compressImage(files[index]);
        state.photos.push({ file:compressed, url:URL.createObjectURL(compressed) });
        setPhotoProgress(progress, `Готово ${index + 1} из ${files.length}`, 'Сохраняем фото в черновике');
      }
      await state.persistPhotos();
      setPhotoProgress(progress, 'Фотографии готовы', `${files.length === 1 ? '1 фотография подготовлена' : `${files.length} фото подготовлено`} — можно продолжать`, true);
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
      setTimeout(() => rerenderBooking(), 260);
    } catch (error) {
      input.disabled = false;
      drop?.classList.remove('hc-photo-busy-v70');
      if (next) next.disabled = previousDisabled;
      progress.classList.remove('show', 'done');
      showToast(error?.message || 'Не удалось обработать фотографию. Попробуйте другое фото', true);
    }
  };
}

function decorateNow() {
  decorateQueued = false;
  if (!CLIENT_MODE) return;
  decorateCalendar();
  decorateVisitType();
  patchPhotoInput();
}

function queueDecorate() {
  if (decorateQueued) return;
  decorateQueued = true;
  requestAnimationFrame(decorateNow);
}

if (CLIENT_MODE) {
  new MutationObserver(queueDecorate).observe(document.documentElement, { childList:true, subtree:true });
  window.addEventListener('hc:booking-rendered', queueDecorate);
  document.addEventListener('DOMContentLoaded', queueDecorate, { once:true });
  queueDecorate();
}
