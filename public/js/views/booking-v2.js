import { api } from '../api.js';
import { state } from '../state.js';
import { compressImage, escapeHtml, formatDate, money, showToast } from '../utils.js';

const PROPERTY_TYPES = [
  ['apartment', 'Квартира'],
  ['house', 'Дом'],
  ['office', 'Офис'],
  ['commercial', 'Коммерческое'],
  ['other', 'Другое'],
];
const CONTACT_METHODS = [
  ['telegram', 'Telegram', 'Напишем вам в Telegram'],
  ['whatsapp', 'WhatsApp', 'Свяжемся по указанному номеру'],
  ['max', 'MAX', 'Свяжемся по указанному номеру'],
  ['call', 'Звонок', 'Позвоним на указанный номер'],
];
const DAILY_CAPACITY_M2 = 300;
let currentNavigate = null;

function progress(step) {
  const current = Math.max(1, Math.min(7, step));
  const names = ['Услуга', 'Объект', 'Дополнительно', 'Фото', 'Адрес', 'Дата', 'Контакты'];
  return `<div class="booking-top"><div><div class="progress-label">Шаг ${current} из 7 · ${names[current - 1] || 'Проверка'}</div><div class="progress-bars">${Array.from({ length: 7 }, (_, i) => `<i class="${i < current ? 'done' : ''}"></i>`).join('')}</div></div></div>`;
}

function shell(title, subtitle, body, actionHtml = '') {
  return `${progress(state.draft.step)}<div class="booking-title-block"><h1 class="page-title booking-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div>${body}${actionHtml}`;
}

function actions({ back = true, next = 'Продолжить', nextDisabled = false } = {}) {
  return `<div class="wizard-actions ${back ? '' : 'one'}">${back ? '<button class="secondary-btn wizard-back" data-back aria-label="Назад">← <span>Назад</span></button>' : ''}<button class="primary-btn wizard-next" data-next ${nextDisabled ? 'disabled' : ''}>${next}</button></div>`;
}

export function renderBooking(root, navigate) {
  currentNavigate = navigate;
  const draft = state.draft;
  const user = state.bootstrap?.user || {};
  if (!draft.customerName) draft.customerName = user.name || user.first_name || '';
  if (!draft.phone) draft.phone = user.phone || '';
  if (!draft.contactMethod) draft.contactMethod = 'telegram';

  if (draft.step === 0) return renderHome(root, navigate);
  if (draft.step === 1) return renderService(root, navigate);
  if (draft.step === 2) return renderObject(root, navigate);
  if (draft.step === 3) return renderAddons(root, navigate);
  if (draft.step === 4) return renderPhotos(root, navigate);
  if (draft.step === 5) return renderAddress(root, navigate);
  if (draft.step === 6) return renderSchedule(root, navigate);
  if (draft.step === 7) return renderContacts(root, navigate);
  if (draft.step === 8) return renderReview(root, navigate);
  draft.step = 0;
  state.saveDraft();
  renderBooking(root, navigate);
}

function renderHome(root, navigate) {
  root.innerHTML = `
    <section class="hero home-hero">
      <div class="brand"><div class="brand-mark">HC</div><div><div class="brand-title">HOUSE CLEANING</div><div class="brand-sub">Уборка квартир и домов</div></div></div>
      <div class="hero-copy"><span class="eyebrow">Запись онлайн</span><h1>Уборка без лишних звонков</h1><p>Выберите услугу, площадь и удобную дату. Остальное уточним сами.</p></div>
    </section>
    <div class="quick-benefits">
      <div><b>≈ 2 мин</b><span>на оформление</span></div><div><b>Фото</b><span>для точной оценки</span></div><div><b>300 м²</b><span>лимит на день</span></div>
    </div>
    <div class="card pad start-card"><h2>Начнём с пары вопросов</h2><p class="page-subtitle">Черновик сохраняется автоматически. Можно вернуться назад и исправить данные.</p><button class="primary-btn" data-start>Заказать уборку</button></div>`;
  root.querySelector('[data-start]').onclick = () => { state.draft.step = 1; state.saveDraft(); renderBooking(root, navigate); };
}

function serviceRate(service) {
  const rate = Number(service?.price_per_m2 || 0);
  return rate > 0 ? `от ${new Intl.NumberFormat('ru-RU').format(rate)} ₽/м²` : 'После оценки';
}

function renderService(root, navigate) {
  const services = (state.bootstrap?.services || []).filter((item) => item.kind === 'primary');
  root.innerHTML = shell('Выберите уборку', 'Стоимость указана за м². Точную сумму менеджер подтвердит после оценки объекта.', `
    <div class="option-grid service-grid service-grid-v2">
      ${services.map((service, index) => `<button type="button" class="option-card service-card service-card-v2 ${Number(state.draft.serviceId) === Number(service.id) ? 'selected' : ''}" data-service="${service.id}"><span class="option-index">0${index + 1}</span><span class="service-copy"><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || '')}</small></span><span class="hc-service-rate">${escapeHtml(serviceRate(service))}</span></button>`).join('')}
    </div>`, actions({ nextDisabled: !state.draft.serviceId }));
  root.querySelectorAll('[data-service]').forEach((button) => button.onclick = () => { state.draft.serviceId = Number(button.dataset.service); state.saveDraft(); renderService(root, navigate); });
  bindNav(root, 0, () => state.draft.serviceId && go(root, navigate, 2));
}

function renderObject(root, navigate) {
  const d = state.draft;
  root.innerHTML = shell('Расскажите об объекте', 'Укажите площадь вручную или измените её ползунком.', `
    <div class="card pad form-card">
      <div class="field-label">Тип объекта</div>
      <div class="property-grid">${PROPERTY_TYPES.map(([value, label]) => `<button type="button" class="property-chip ${d.propertyType === value ? 'selected' : ''}" data-property="${value}">${label}</button>`).join('')}</div>
      <div class="area-panel">
        <div class="area-head"><div><span>Площадь объекта</span><strong data-area-display>${Number(d.area || 0)} м²</strong></div><span class="area-hint">до 300 м² на одну дату</span></div>
        <div class="field floating"><input class="input area-input" type="number" min="10" max="5000" inputmode="decimal" enterkeyhint="done" value="${Number(d.area || 0)}" data-area-input data-label="Площадь объекта" placeholder=" "><label>Площадь, м²</label></div>
        <input class="area-range" type="range" min="10" max="300" step="5" value="${Math.min(300, Math.max(10, Number(d.area || 10)))}" data-area-range aria-label="Площадь ползунком">
        <div class="area-scale"><span>10</span><span>150</span><span>300 м²</span></div>
        <div class="area-actions"><button type="button" data-area-delta="-10">−10 м²</button><button type="button" data-area-delta="10">+10 м²</button></div>
        ${Number(d.area || 0) > 300 ? '<div class="info-note warning">Для объекта больше 300 м² дату согласуем отдельно с менеджером.</div>' : ''}
      </div>
      <div class="row counters-row">${counterHtml('Комнаты', 'rooms', d.rooms)}${counterHtml('Санузлы', 'bathrooms', d.bathrooms)}</div>
      <div class="switch-row"><div><strong>Есть животные</strong><div class="profile-meta">Заранее предупредим команду</div></div><button type="button" class="switch ${d.pets ? 'on' : ''}" data-pets aria-label="Есть животные"><i></i></button></div>
    </div>`, actions());

  root.querySelectorAll('[data-property]').forEach((button) => button.onclick = () => { d.propertyType = button.dataset.property; state.saveDraft(); renderObject(root, navigate); });
  const input = root.querySelector('[data-area-input]');
  const range = root.querySelector('[data-area-range]');
  const display = root.querySelector('[data-area-display]');
  const setArea = (value, rerender = false) => {
    const next = Math.max(0, Math.min(5000, Number(value || 0)));
    d.area = next;
    state.saveDraft();
    if (input) input.value = String(next);
    if (range) range.value = String(Math.min(300, Math.max(10, next || 10)));
    if (display) display.textContent = `${next} м²`;
    if (rerender) renderObject(root, navigate);
  };
  input.oninput = () => setArea(input.value);
  input.onchange = () => setArea(input.value);
  input.onblur = () => setArea(input.value);
  input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); setArea(input.value); input.blur(); } };
  range.oninput = () => setArea(range.value);
  root.querySelectorAll('[data-area-delta]').forEach((button) => button.onclick = () => setArea(Math.max(10, Number(d.area || 0) + Number(button.dataset.areaDelta)), true));
  root.querySelectorAll('[data-counter]').forEach((button) => button.onclick = () => { const field = button.dataset.counter; const max = field === 'rooms' ? 50 : 20; d[field] = Math.max(0, Math.min(max, Number(d[field]) + Number(button.dataset.delta))); state.saveDraft(); renderObject(root, navigate); });
  root.querySelector('[data-pets]').onclick = () => { d.pets = !d.pets; state.saveDraft(); renderObject(root, navigate); };
  bindNav(root, 1, () => { if (d.area < 10 || d.area > 5000) return showToast('Проверьте площадь объекта', true); go(root, navigate, 3); });
}

function counterHtml(label, field, value) {
  return `<div class="counter-block"><div class="field-label">${label}</div><div class="counter"><button type="button" data-counter="${field}" data-delta="-1">−</button><span>${value}</span><button type="button" data-counter="${field}" data-delta="1">+</button></div></div>`;
}

function renderAddons(root, navigate) {
  const addons = (state.bootstrap?.services || []).filter((item) => item.kind === 'addon');
  root.innerHTML = shell('Дополнительные услуги', 'Необязательно. Отметьте галочками всё, что нужно добавить.', `
    <div class="option-grid addon-grid addon-grid-v2">${addons.map((service) => {
      const selected = state.draft.addonIds.includes(service.id);
      return `<button type="button" class="option-card addon-card addon-card-v2 ${selected ? 'selected' : ''}" data-addon="${service.id}"><span class="addon-check" aria-hidden="true">${selected ? '✓' : ''}</span><span class="addon-copy"><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || '')}${service.fixed_price ? ` · ${money(service.fixed_price)}` : ''}</small></span></button>`;
    }).join('') || '<div class="empty card">Дополнительные услуги пока не настроены</div>'}</div>`, actions());
  root.querySelectorAll('[data-addon]').forEach((button) => button.onclick = () => { const id = Number(button.dataset.addon); state.draft.addonIds = state.draft.addonIds.includes(id) ? state.draft.addonIds.filter((item) => item !== id) : [...state.draft.addonIds, id]; state.saveDraft(); renderAddons(root, navigate); });
  bindNav(root, 2, () => go(root, navigate, 4));
}

function renderPhotos(root, navigate) {
  root.innerHTML = shell('Покажите объект', 'Фото нужны только для предварительной оценки объёма уборки.', `
    <div class="photo-step"><label class="photo-drop" for="photo-input"><div class="photo-plus">＋</div><div><strong>Добавить фотографии</strong><small>Камера или галерея · от 1 до 10 фото</small></div></label><input id="photo-input" type="file" accept="image/*" multiple class="hidden"><div class="photo-grid">${state.photos.map((item, index) => `<div class="photo-thumb"><img src="${item.url}" alt="Фото объекта ${index + 1}"><button type="button" data-remove-photo="${index}">×</button></div>`).join('')}</div><div class="photo-count"><span>${state.photos.length} из 10</span><span>${state.photos.length ? 'Фото сохранены в черновике' : 'Добавьте минимум одно фото'}</span></div></div>`, actions({ nextDisabled: state.photos.length < 1 }));
  const input = root.querySelector('#photo-input');
  input.onchange = async () => {
    const files = [...input.files].slice(0, Math.max(0, 10 - state.photos.length));
    if (!files.length) return;
    input.disabled = true;
    try { for (const file of files) { const compressed = await compressImage(file); state.photos.push({ file: compressed, url: URL.createObjectURL(compressed) }); } await state.persistPhotos(); renderPhotos(root, navigate); }
    catch (error) { showToast(error.message || 'Не удалось обработать фото', true); input.disabled = false; }
  };
  root.querySelectorAll('[data-remove-photo]').forEach((button) => button.onclick = () => { const index = Number(button.dataset.removePhoto); URL.revokeObjectURL(state.photos[index].url); state.photos.splice(index, 1); state.persistPhotos(); renderPhotos(root, navigate); });
  bindNav(root, 3, () => state.photos.length ? go(root, navigate, 5) : showToast('Добавьте минимум одно фото', true));
}

function addressLooksValid(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (raw.length < 6 || raw.length > 160) return false;
  const letters = raw.match(/[A-Za-zА-Яа-яЁё]/g) || [];
  const digits = raw.match(/\d/g) || [];
  const words = raw.split(/[\s,]+/).filter(Boolean);
  if (letters.length < 4 || digits.length < 1 || words.length < 2) return false;
  if (/(.)\1{5,}/i.test(raw)) return false;
  return true;
}

function renderAddress(root, navigate) {
  const d = state.draft;
  if (d.serviceArea !== 'lo') d.serviceArea = 'spb';
  d.city = d.serviceArea === 'lo' ? 'Ленинградская область' : 'Санкт-Петербург';
  const isLo = d.serviceArea === 'lo';
  const addressLabel = isLo ? 'Населённый пункт, улица и дом' : 'Улица и дом';
  const example = isLo ? 'Мурино, Воронцовский бульвар, 5' : 'Невский проспект, 10';

  root.innerHTML = shell('Куда приехать?', 'Выберите регион и укажите точный адрес с номером дома.', `
    <div class="card pad form-card address-card-v2">
      <div class="hc-location-group"><div class="field-label">Город / область</div><div class="hc-location-choice"><button type="button" class="hc-location-option ${!isLo ? 'selected' : ''}" data-location="spb">Санкт-Петербург</button><button type="button" class="hc-location-option ${isLo ? 'selected' : ''}" data-location="lo">Ленинградская область</button></div><small>Работаем только в Санкт-Петербурге и Ленинградской области.</small></div>
      ${field(addressLabel, 'address', d.address, example)}
      <div class="row">${field('Квартира / офис', 'apartment', d.apartment, '25')}${field('Подъезд', 'entrance', d.entrance, '2')}</div>
      ${field('Этаж', 'floor', d.floor, '7')}
      ${textareaField('Комментарий к адресу', 'addressComment', d.addressComment, 'Вход со двора, домофон 125')}
    </div>`, actions());

  root.querySelectorAll('[data-location]').forEach((button) => button.onclick = () => {
    d.serviceArea = button.dataset.location === 'lo' ? 'lo' : 'spb';
    d.city = d.serviceArea === 'lo' ? 'Ленинградская область' : 'Санкт-Петербург';
    state.saveDraft();
    renderAddress(root, navigate);
  });
  bindFields(root);
  bindNav(root, 4, () => {
    const addressInput = root.querySelector('[data-field="address"]');
    const clean = String(d.address || '').trim().replace(/\s+/g, ' ');
    if (!addressLooksValid(clean)) {
      addressInput?.classList.add('input-error');
      addressInput?.focus();
      return showToast(isLo ? 'Укажите населённый пункт, улицу и номер дома' : 'Укажите улицу и номер дома', true);
    }
    d.address = clean;
    state.saveDraft();
    go(root, navigate, 6);
  });
}

function field(label, name, value, placeholder = '', type = 'text') {
  return `<div class="field floating"><input class="input" type="${type}" data-field="${name}" data-label="${escapeHtml(label)}" value="${escapeHtml(value)}" placeholder=" " autocomplete="off"><label>${escapeHtml(label)}</label>${placeholder ? `<small class="field-hint">Например: ${escapeHtml(placeholder)}</small>` : ''}</div>`;
}
function textareaField(label, name, value, placeholder = '') {
  return `<div class="field floating"><textarea class="textarea" data-field="${name}" data-label="${escapeHtml(label)}" placeholder=" " autocomplete="off">${escapeHtml(value)}</textarea><label>${escapeHtml(label)}</label>${placeholder ? `<small class="field-hint">Например: ${escapeHtml(placeholder)}</small>` : ''}</div>`;
}
function bindFields(root) {
  root.querySelectorAll('[data-field]').forEach((input) => input.oninput = () => { input.classList.remove('input-error'); state.draft[input.dataset.field] = input.value; state.saveDraft(); });
}

function localIso(date) {
  const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function calendarDates(days = 10) {
  const start = new Date(); start.setHours(12, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => { const date = new Date(start); date.setDate(start.getDate() + i); return date; });
}

function renderSchedule(root, navigate) {
  const d = state.draft;
  const minDate = localIso(new Date());
  root.innerHTML = shell('Выберите дату и время', 'Сначала выберите удобный день, затем свободное время.', `
    ${Number(d.area) > DAILY_CAPACITY_M2 ? '<div class="info-note warning schedule-warning">Для объекта больше 300 м² дату нужно согласовать с менеджером.</div>' : ''}
    <div class="calendar-card card pad hc-calendar-v2">
      <div class="hc-calendar-head"><div><strong>Ближайшие даты</strong><small>Доступность учитывает площадь вашей уборки</small></div><div class="hc-mini-legend"><span class="free">Свободно</span><span class="partial">Мало мест</span></div></div>
      <div class="calendar-strip" data-calendar><div class="calendar-loading">Загружаем даты...</div></div>
      <label class="hc-manual-date"><span><strong>Нужна другая дата?</strong><small>Выберите её в календаре</small></span><input type="date" min="${minDate}" value="${escapeHtml(d.date)}" data-date data-label="Другая дата" aria-label="Другая дата"></label>
      <div data-capacity></div>
      <div class="time-section"><div class="hc-time-head"><strong>Свободное время</strong><span>${d.date ? escapeHtml(formatDate(d.date)) : 'Выберите дату'}</span></div><div data-slots>${d.date ? '<div class="calendar-loading">Проверяем время...</div>' : '<div class="empty-inline">Сначала выберите дату</div>'}</div></div>
    </div>`, actions({ nextDisabled: !d.date || !d.time || Number(d.area) > DAILY_CAPACITY_M2 }));

  const dateInput = root.querySelector('[data-date]');
  dateInput.onchange = () => { d.date = dateInput.value; d.time = ''; state.saveDraft(); renderSchedule(root, navigate); };
  loadCalendar(root, navigate);
  if (d.date) loadSlots(root, navigate, d.date);
  bindNav(root, 5, () => {
    if (Number(d.area) > DAILY_CAPACITY_M2) return showToast('Для площади больше 300 м² требуется согласование', true);
    if (!d.date || !d.time) return showToast('Выберите дату и время', true);
    go(root, navigate, 7);
  });
}

async function loadCalendar(root, navigate) {
  const dates = calendarDates(10);
  const container = root.querySelector('[data-calendar]');
  if (!container) return;
  try {
    const results = await Promise.all(dates.map((date) => api.availability(localIso(date))));
    if (!root.querySelector('[data-calendar]')) return;
    container.innerHTML = results.map((data, index) => calendarDay(dates[index], data)).join('');
    container.querySelectorAll('[data-calendar-date]').forEach((button) => button.onclick = () => {
      if (button.disabled) return;
      state.draft.date = button.dataset.calendarDate;
      state.draft.time = '';
      state.saveDraft();
      renderSchedule(root, navigate);
    });
    const selected = container.querySelector('.calendar-day.selected');
    selected?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  } catch (error) { container.innerHTML = `<div class="empty-inline">${escapeHtml(error.message || 'Не удалось загрузить календарь')}</div>`; }
}

function calendarDay(date, data) {
  const requested = Number(state.draft.area || 0);
  const remaining = Number.isFinite(Number(data.remainingM2)) ? Number(data.remainingM2) : DAILY_CAPACITY_M2;
  const used = Number.isFinite(Number(data.usedM2)) ? Number(data.usedM2) : 0;
  const dateValue = localIso(date);
  const full = data.closed || remaining <= 0;
  const insufficient = !full && requested > remaining;
  const stateClass = full ? 'full' : used > 0 ? 'partial' : 'free';
  const label = full ? 'Занято' : insufficient ? `Осталось ${remaining} м²` : used > 0 ? `Свободно ${remaining} м²` : 'Свободно';
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date).replace('.', '');
  const month = new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(date).replace('.', '');
  return `<button type="button" class="calendar-day ${stateClass} ${state.draft.date === dateValue ? 'selected' : ''} ${insufficient ? 'insufficient' : ''}" data-calendar-date="${dateValue}" ${full || insufficient ? 'disabled' : ''}><span>${weekday}</span><b>${date.getDate()}</b><small>${month}</small><em>${escapeHtml(label)}</em></button>`;
}

async function loadSlots(root, navigate, date) {
  try {
    const data = await api.availability(date);
    const container = root.querySelector('[data-slots]');
    const capacity = root.querySelector('[data-capacity]');
    if (!container) return;
    const remaining = Number.isFinite(Number(data.remainingM2)) ? Number(data.remainingM2) : DAILY_CAPACITY_M2;
    const used = Number.isFinite(Number(data.usedM2)) ? Number(data.usedM2) : 0;
    if (capacity) capacity.innerHTML = `<div class="capacity-box capacity-box-v2"><div><span>Доступно на эту дату</span><strong>${remaining} м²</strong></div><small>Занято ${used} из ${DAILY_CAPACITY_M2} м²</small></div>`;
    if (data.closed || remaining < Number(state.draft.area || 0)) { container.innerHTML = '<div class="empty-inline danger-text">Для вашей площади эта дата уже недоступна. Выберите другую.</div>'; return; }
    container.innerHTML = `<div class="slot-grid slot-grid-v2">${data.slots.map((slot) => `<button type="button" class="slot ${!slot.available ? 'unavailable' : ''} ${state.draft.time === slot.time ? 'selected' : ''}" data-time="${slot.time}" ${!slot.available ? 'disabled' : ''}>${slot.time}</button>`).join('')}</div>`;
    container.querySelectorAll('[data-time]').forEach((button) => button.onclick = () => { state.draft.time = button.dataset.time; state.saveDraft(); renderSchedule(root, navigate); });
  } catch (error) { const container = root.querySelector('[data-slots]'); if (container) container.innerHTML = `<div class="empty-inline">${escapeHtml(error.message || 'Не удалось загрузить время')}</div>`; }
}

function contactMethodLabel(value) {
  return CONTACT_METHODS.find(([key]) => key === value)?.[1] || 'Telegram';
}

function renderContacts(root, navigate) {
  const d = state.draft;
  root.innerHTML = shell('Контакты и подтверждение', 'Оставьте контакты и выберите, как менеджеру удобнее подтвердить с вами заявку.', `
    <div class="card pad form-card contact-card-v2">
      ${field('Ваше имя', 'customerName', d.customerName, 'Анна')}
      ${field('Телефон', 'phone', d.phone, '+7 999 000-00-00', 'tel')}
      <div class="contact-method-block"><div class="field-label">Как с вами связаться для подтверждения?</div><p>Выберите один удобный способ.</p><div class="contact-method-grid">${CONTACT_METHODS.map(([value, label, hint]) => `<button type="button" class="contact-method ${d.contactMethod === value ? 'selected' : ''}" data-contact-method="${value}"><span class="contact-method-check">${d.contactMethod === value ? '✓' : ''}</span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(hint)}</small></button>`).join('')}</div></div>
      ${textareaField('Комментарий к заказу', 'comment', d.comment, 'Что ещё нам нужно знать?')}
    </div>`, actions({ next: 'Проверить заявку' }));
  bindFields(root);
  root.querySelectorAll('[data-contact-method]').forEach((button) => button.onclick = () => { d.contactMethod = button.dataset.contactMethod; state.saveDraft(); renderContacts(root, navigate); });
  bindNav(root, 6, () => {
    if (!d.customerName.trim()) return showToast('Укажите имя', true);
    if (String(d.phone).replace(/\D/g, '').length < 10) return showToast('Укажите корректный телефон', true);
    if (!CONTACT_METHODS.some(([key]) => key === d.contactMethod)) return showToast('Выберите способ связи', true);
    go(root, navigate, 8);
  });
}

function renderReview(root, navigate) {
  const d = state.draft;
  const services = state.bootstrap?.services || [];
  const primary = services.find((item) => item.id === Number(d.serviceId));
  const addons = services.filter((item) => d.addonIds.includes(item.id));
  const estimate = Math.round((primary?.price_per_m2 || 0) * d.area + addons.reduce((sum, item) => sum + (item.fixed_price || 0), 0));
  const propertyLabel = PROPERTY_TYPES.find(([value]) => value === d.propertyType)?.[1] || 'Объект';
  root.innerHTML = `<div class="review-head"><span class="eyebrow">Финальный шаг</span><h1 class="page-title booking-title">Проверьте заявку</h1><p class="page-subtitle">Проверьте данные перед оформлением.</p></div><div class="card pad review-card">${summary('Уборка', primary?.name || '—')}${summary('Объект', `${propertyLabel}, ${d.area} м²`)}${summary('Адрес', `${d.city}, ${d.address}${d.apartment ? `, ${d.apartment}` : ''}`)}${summary('Дата', formatDate(d.date))}${summary('Время', d.time)}${summary('Комнаты / санузлы', `${d.rooms} / ${d.bathrooms}`)}${summary('Доп. услуги', addons.length ? addons.map((item) => item.name).join(', ') : 'Нет')}${summary('Фото для оценки', `${state.photos.length} шт.`)}${summary('Контакт', `${d.customerName}, ${d.phone}`)}${summary('Подтвердить через', contactMethodLabel(d.contactMethod))}</div><div class="card pad price-card"><span class="profile-meta">Предварительная стоимость</span><div class="price">${estimate > 0 ? money(estimate) : 'Уточнит менеджер'}</div></div>${actions({ next: 'Оформить заявку', nextDisabled: state.photos.length < 1 })}`;
  bindNav(root, 7, async () => {
    if (!state.photos.length) return showToast('Добавьте фотографии объекта', true);
    const button = root.querySelector('[data-next]'); button.disabled = true; button.textContent = 'Оформляем...';
    try {
      const result = await api.createOrder({ ...d, contact_method: d.contactMethod }, state.photos.map((item) => item.file));
      const order = result.order;
      await state.resetDraft();
      renderSuccess(root, navigate, order);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Оформить заявку';
      showToast(error.message || 'Не удалось оформить заявку', true);
    }
  });
}

function summary(label, value) { return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`; }

function renderSuccess(root, navigate, order) {
  const method = contactMethodLabel(order?.contact_method || order?.contactMethod || 'telegram');
  root.innerHTML = `<div class="success success-v2"><div class="success-icon">✓</div><span class="eyebrow">Готово</span><h1 class="page-title booking-title">Заявка оформлена</h1><p class="page-subtitle">Скоро менеджер свяжется с вами для подтверждения.</p><div class="card pad success-order">${summary('Номер заявки', order.order_number || `#${order.id}`)}${summary('Способ связи', method)}</div><button class="primary-btn" data-open>Открыть заявку</button><button class="secondary-btn" style="margin-top:10px" data-home>На главную</button></div>`;
  root.querySelector('[data-open]').onclick = () => navigate('orders', { orderId: order.id });
  root.querySelector('[data-home]').onclick = () => navigate('home');
}

function bindNav(root, backStep, nextHandler) {
  const back = root.querySelector('[data-back]');
  if (back) back.onclick = () => go(root, currentNavigate, backStep);
  const next = root.querySelector('[data-next]');
  if (next) next.onclick = nextHandler;
}

function go(root, navigate, step) {
  state.draft.step = step;
  state.saveDraft();
  if (step === 0 && typeof currentNavigate === 'function') return currentNavigate('home');
  renderBooking(root, navigate || currentNavigate || (() => {}));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}