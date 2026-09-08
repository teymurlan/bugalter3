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
const DAILY_CAPACITY_M2 = 300;

function progress(step) {
  const current = Math.max(1, Math.min(7, step));
  const names = ['Услуга', 'Объект', 'Дополнительно', 'Фото', 'Адрес', 'Дата', 'Контакты'];
  return `<div class="booking-top"><div><div class="progress-label">Шаг ${current} из 7 · ${names[current - 1] || 'Проверка'}</div><div class="progress-bars">${Array.from({ length: 7 }, (_, i) => `<i class="${i < current ? 'done' : ''}"></i>`).join('')}</div></div></div>`;
}

function shell(title, subtitle, body, actionHtml = '') {
  return `${progress(state.draft.step)}<div class="booking-title-block"><h1 class="page-title booking-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div>${body}${actionHtml}`;
}

function actions({ back = true, next = 'Продолжить', nextDisabled = false } = {}) {
  return `<div class="wizard-actions ${back ? '' : 'one'}">${back ? '<button class="secondary-btn" data-back>Назад</button>' : ''}<button class="primary-btn" data-next ${nextDisabled ? 'disabled' : ''}>${next}</button></div>`;
}

export function renderBooking(root, navigate) {
  const draft = state.draft;
  const user = state.bootstrap?.user || {};
  if (!draft.customerName) draft.customerName = user.name || user.first_name || '';
  if (!draft.phone) draft.phone = user.phone || '';

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

function renderService(root, navigate) {
  const services = (state.bootstrap?.services || []).filter((item) => item.kind === 'primary');
  root.innerHTML = shell('Выберите уборку', 'Нажмите на подходящий вариант — выбранная карточка подсветится.', `
    <div class="option-grid service-grid">
      ${services.map((service, index) => `<button type="button" class="option-card service-card ${Number(state.draft.serviceId) === Number(service.id) ? 'selected' : ''}" data-service="${service.id}"><span class="option-index">0${index + 1}</span><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || '')}</small></button>`).join('')}
    </div>`, actions({ nextDisabled: !state.draft.serviceId }));
  root.querySelectorAll('[data-service]').forEach((button) => button.onclick = () => { state.draft.serviceId = Number(button.dataset.service); state.saveDraft(); renderService(root, navigate); });
  bindNav(root, 0, () => state.draft.serviceId && go(root, navigate, 2));
}

function renderObject(root, navigate) {
  const d = state.draft;
  root.innerHTML = shell('Расскажите об объекте', 'Площадь можно ввести вручную или изменить ползунком.', `
    <div class="card pad form-card">
      <div class="field-label">Тип объекта</div>
      <div class="property-grid">${PROPERTY_TYPES.map(([value, label]) => `<button type="button" class="property-chip ${d.propertyType === value ? 'selected' : ''}" data-property="${value}">${label}</button>`).join('')}</div>
      <div class="area-panel">
        <div class="area-head"><div><span>Площадь объекта</span><strong data-area-display>${Number(d.area || 0)} м²</strong></div><span class="area-hint">ползунок до 300 м²</span></div>
        <div class="field floating"><input class="input area-input" type="number" min="10" max="5000" inputmode="decimal" value="${Number(d.area || 0)}" data-area-input data-label="Площадь объекта"><label>Площадь, м²</label></div>
        <input class="area-range" type="range" min="10" max="300" step="5" value="${Math.min(300, Math.max(10, Number(d.area || 10)))}" data-area-range aria-label="Площадь ползунком">
        <div class="area-scale"><span>10</span><span>150</span><span>300 м²</span></div>
        <div class="area-actions"><button type="button" data-area-delta="-10">−10 м²</button><button type="button" data-area-delta="10">+10 м²</button></div>
        ${Number(d.area || 0) > 300 ? '<div class="info-note warning">Объект больше дневного лимита 300 м². Дату для такого объекта позже согласуем отдельно.</div>' : ''}
      </div>
      <div class="row counters-row">${counterHtml('Комнаты', 'rooms', d.rooms)}${counterHtml('Санузлы', 'bathrooms', d.bathrooms)}</div>
      <div class="switch-row"><div><strong>Есть животные</strong><div class="profile-meta">Заранее предупредим клинера</div></div><button type="button" class="switch ${d.pets ? 'on' : ''}" data-pets aria-label="Есть животные"><i></i></button></div>
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
  input.onchange = () => renderObject(root, navigate);
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
  root.innerHTML = shell('Добавить что-нибудь ещё?', 'Дополнительные услуги необязательны. Можно выбрать несколько.', `
    <div class="option-grid addon-grid">${addons.map((service) => `<button type="button" class="option-card addon-card ${state.draft.addonIds.includes(service.id) ? 'selected' : ''}" data-addon="${service.id}"><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || '')}${service.fixed_price ? ` · ${money(service.fixed_price)}` : ''}</small></button>`).join('') || '<div class="empty card">Дополнительные услуги пока не настроены</div>'}</div>`, actions());
  root.querySelectorAll('[data-addon]').forEach((button) => button.onclick = () => { const id = Number(button.dataset.addon); state.draft.addonIds = state.draft.addonIds.includes(id) ? state.draft.addonIds.filter((item) => item !== id) : [...state.draft.addonIds, id]; state.saveDraft(); renderAddons(root, navigate); });
  bindNav(root, 2, () => go(root, navigate, 4));
}

function renderPhotos(root, navigate) {
  root.innerHTML = shell('Покажите объект', 'Фото помогают быстрее оценить объём и подготовить команду.', `
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

function renderAddress(root, navigate) {
  const d = state.draft;
  root.innerHTML = shell('Куда приехать?', 'Нажмите на поле — сверху экрана всегда будет видно, что вы сейчас вводите.', `
    <div class="card pad form-card">${field('Город', 'city', d.city, 'Санкт-Петербург')}${field('Улица и дом', 'address', d.address, 'Невский проспект, 10')}<div class="row">${field('Квартира / офис', 'apartment', d.apartment, '25')}${field('Подъезд', 'entrance', d.entrance, '2')}</div>${field('Этаж', 'floor', d.floor, '7')}${textareaField('Комментарий к адресу', 'addressComment', d.addressComment, 'Вход со двора, домофон 125')}</div>`, actions());
  bindFields(root);
  bindNav(root, 4, () => { if (!d.city.trim() || !d.address.trim()) return showToast('Укажите город, улицу и дом', true); go(root, navigate, 6); });
}

function field(label, name, value, placeholder = '', type = 'text') {
  return `<div class="field floating"><input class="input" type="${type}" data-field="${name}" data-label="${escapeHtml(label)}" value="${escapeHtml(value)}" placeholder=" "><label>${escapeHtml(label)}</label>${placeholder ? `<small class="field-hint">Например: ${escapeHtml(placeholder)}</small>` : ''}</div>`;
}
function textareaField(label, name, value, placeholder = '') {
  return `<div class="field floating"><textarea class="textarea" data-field="${name}" data-label="${escapeHtml(label)}" placeholder=" ">${escapeHtml(value)}</textarea><label>${escapeHtml(label)}</label>${placeholder ? `<small class="field-hint">Например: ${escapeHtml(placeholder)}</small>` : ''}</div>`;
}
function bindFields(root) {
  root.querySelectorAll('[data-field]').forEach((input) => input.oninput = () => { state.draft[input.dataset.field] = input.value; state.saveDraft(); });
}

function localIso(date) {
  const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function calendarDates(days = 14) {
  const start = new Date(); start.setHours(12, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => { const date = new Date(start); date.setDate(start.getDate() + i); return date; });
}

function renderSchedule(root, navigate) {
  const d = state.draft;
  const minDate = localIso(new Date());
  root.innerHTML = shell('Выберите дату', `На один день принимаем не больше ${DAILY_CAPACITY_M2} м² уборки. Занятые дни будут отмечены.`, `
    ${Number(d.area) > DAILY_CAPACITY_M2 ? '<div class="info-note warning schedule-warning">Для объекта больше 300 м² нужна отдельная договорённость. Уменьшите площадь или свяжитесь с администратором.</div>' : ''}
    <div class="calendar-card card pad"><div class="calendar-legend"><span class="free">Свободно</span><span class="partial">Частично занято</span><span class="full">Занято</span></div><div class="calendar-strip" data-calendar><div class="calendar-loading">Загружаем даты...</div></div><div class="field floating custom-date-field"><input class="input" type="date" min="${minDate}" value="${escapeHtml(d.date)}" data-date data-label="Другая дата" placeholder=" "><label>Другая дата</label></div><div data-capacity></div><div class="time-section"><div class="field-label">Свободное время</div><div data-slots>${d.date ? '<div class="calendar-loading">Проверяем время...</div>' : '<div class="empty-inline">Сначала выберите дату</div>'}</div></div></div>`, actions({ nextDisabled: !d.date || !d.time || Number(d.area) > DAILY_CAPACITY_M2 }));

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
  const dates = calendarDates(14);
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
  const label = full ? 'Занято' : insufficient ? `Ост. ${remaining} м²` : used > 0 ? `${remaining} м²` : 'Свободно';
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date).replace('.', '');
  const month = new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(date).replace('.', '');
  return `<button type="button" class="calendar-day ${stateClass} ${state.draft.date === dateValue ? 'selected' : ''} ${insufficient ? 'insufficient' : ''}" data-calendar-date="${dateValue}" ${full || insufficient ? 'disabled' : ''}><span>${weekday}</span><b>${date.getDate()}</b><small>${month}</small><em>${label}</em></button>`;
}

async function loadSlots(root, navigate, date) {
  try {
    const data = await api.availability(date);
    const container = root.querySelector('[data-slots]');
    const capacity = root.querySelector('[data-capacity]');
    if (!container) return;
    const remaining = Number.isFinite(Number(data.remainingM2)) ? Number(data.remainingM2) : DAILY_CAPACITY_M2;
    const used = Number.isFinite(Number(data.usedM2)) ? Number(data.usedM2) : 0;
    if (capacity) capacity.innerHTML = `<div class="capacity-box"><div><span>Загрузка дня</span><strong>${used} / ${DAILY_CAPACITY_M2} м²</strong></div><div class="capacity-track"><i style="width:${Math.min(100, Math.round((used / DAILY_CAPACITY_M2) * 100))}%"></i></div><small>Осталось ${remaining} м²</small></div>`;
    if (data.closed || remaining < Number(state.draft.area || 0)) { container.innerHTML = '<div class="empty-inline danger-text">Эта дата уже занята для вашей площади. Выберите другую.</div>'; return; }
    container.innerHTML = `<div class="slot-grid">${data.slots.map((slot) => `<button type="button" class="slot ${!slot.available ? 'unavailable' : ''} ${state.draft.time === slot.time ? 'selected' : ''}" data-time="${slot.time}" ${!slot.available ? 'disabled' : ''}>${slot.time}</button>`).join('')}</div>`;
    container.querySelectorAll('[data-time]').forEach((button) => button.onclick = () => { state.draft.time = button.dataset.time; state.saveDraft(); renderSchedule(root, navigate); });
  } catch (error) { const container = root.querySelector('[data-slots]'); if (container) container.innerHTML = `<div class="empty-inline">${escapeHtml(error.message || 'Не удалось загрузить время')}</div>`; }
}

function renderContacts(root, navigate) {
  const d = state.draft;
  root.innerHTML = shell('Контактные данные', 'При вводе сверху экрана будет закреплено название активного поля.', `
    <div class="card pad form-card">${field('Ваше имя', 'customerName', d.customerName, 'Анна')}${field('Телефон', 'phone', d.phone, '+7 999 000-00-00', 'tel')}${textareaField('Комментарий к заказу', 'comment', d.comment, 'Что ещё нам нужно знать?')}</div>`, actions({ next: 'Проверить заявку' }));
  bindFields(root);
  bindNav(root, 6, () => { if (!d.customerName.trim()) return showToast('Укажите имя', true); if (String(d.phone).replace(/\D/g, '').length < 10) return showToast('Укажите корректный телефон', true); go(root, navigate, 8); });
}

function renderReview(root, navigate) {
  const d = state.draft;
  const services = state.bootstrap?.services || [];
  const primary = services.find((item) => item.id === Number(d.serviceId));
  const addons = services.filter((item) => d.addonIds.includes(item.id));
  const estimate = Math.round((primary?.price_per_m2 || 0) * d.area + addons.reduce((sum, item) => sum + (item.fixed_price || 0), 0));
  const propertyLabel = PROPERTY_TYPES.find(([value]) => value === d.propertyType)?.[1] || 'Объект';
  root.innerHTML = `<div class="review-head"><span class="eyebrow">Финальный шаг</span><h1 class="page-title booking-title">Проверьте заявку</h1><p class="page-subtitle">Если всё правильно — отправьте заказ.</p></div><div class="card pad review-card">${summary('Уборка', primary?.name || '—')}${summary('Объект', `${propertyLabel}, ${d.area} м²`)}${summary('Адрес', `${d.city}, ${d.address}${d.apartment ? `, ${d.apartment}` : ''}`)}${summary('Дата', formatDate(d.date))}${summary('Время', d.time)}${summary('Комнаты / санузлы', `${d.rooms} / ${d.bathrooms}`)}${summary('Доп. услуги', addons.length ? addons.map((item) => item.name).join(', ') : 'Нет')}${summary('Фото', `${state.photos.length} шт.`)}${summary('Контакт', `${d.customerName}, ${d.phone}`)}</div><div class="card pad price-card"><span class="profile-meta">Предварительная стоимость</span><div class="price">${estimate > 0 ? money(estimate) : 'Уточнит администратор'}</div></div>${actions({ next: 'Отправить заявку', nextDisabled: state.photos.length < 1 })}`;
  bindNav(root, 7, async () => {
    if (!state.photos.length) return showToast('Добавьте фотографии объекта', true);
    const button = root.querySelector('[data-next]'); button.disabled = true; button.textContent = 'Отправляем...';
    try { const result = await api.createOrder({ ...d }, state.photos.map((item) => item.file)); const order = result.order; await state.resetDraft(); renderSuccess(root, navigate, order); }
    catch (error) { button.disabled = false; button.textContent = 'Отправить заявку'; showToast(error.message || 'Не удалось отправить заявку', true); }
  });
}

function summary(label, value) { return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`; }
function renderSuccess(root, navigate, order) {
  root.innerHTML = `<div class="success"><div class="success-icon">✓</div><span class="eyebrow">Готово</span><h1 class="page-title booking-title">Заявка отправлена</h1><p class="page-subtitle">Администратор получит уведомление и свяжется с вами после проверки.</p><div class="card pad success-order">${summary('Номер заявки', order.order_number || `#${order.id}`)}</div><button class="primary-btn" data-open>Открыть заявку</button><button class="secondary-btn" style="margin-top:10px" data-home>На главную</button></div>`;
  root.querySelector('[data-open]').onclick = () => navigate('orders', { orderId: order.id });
  root.querySelector('[data-home]').onclick = () => navigate('booking');
}
function bindNav(root, backStep, nextHandler) { const back = root.querySelector('[data-back]'); if (back) back.onclick = () => go(root, null, backStep); const next = root.querySelector('[data-next]'); if (next) next.onclick = nextHandler; }
function go(root, navigate, step) { state.draft.step = step; state.saveDraft(); renderBooking(root, navigate || (() => {})); window.scrollTo({ top: 0, behavior: 'smooth' }); }
