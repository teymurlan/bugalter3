import { api } from '../api.js';
import { state } from '../state.js';
import { compressImage, escapeHtml, formatDate, money, showToast } from '../utils.js';

const PROPERTY_TYPES = [
  ['apartment', 'Квартира'],
  ['house', 'Дом'],
  ['office', 'Офис'],
  ['commercial', 'Коммерческое помещение'],
  ['other', 'Другое'],
];

function progress(step) {
  const current = Math.max(1, Math.min(7, step));
  return `
    <div class="progress-wrap">
      <div class="progress-label">Шаг ${current} из 7</div>
      <div class="progress-bars">${Array.from({ length: 7 }, (_, i) => `<i class="${i < current ? 'done' : ''}"></i>`).join('')}</div>
    </div>`;
}

function shell(title, subtitle, body, actions = '') {
  return `${progress(state.draft.step)}<h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p>${body}${actions}`;
}

function actions({ back = true, next = 'Продолжить', nextDisabled = false } = {}) {
  return `<div class="wizard-actions ${back ? '' : 'one'}">
    ${back ? '<button class="secondary-btn" data-back>Назад</button>' : ''}
    <button class="primary-btn" data-next ${nextDisabled ? 'disabled' : ''}>${next}</button>
  </div>`;
}

export function renderBooking(root, navigate) {
  const draft = state.draft;
  const user = state.bootstrap?.user || {};
  if (!draft.customerName) draft.customerName = user.name || user.first_name || '';
  if (!draft.phone) draft.phone = user.phone || '';

  if (draft.step === 0) {
    root.innerHTML = `
      <section class="hero">
        <div class="brand"><div class="brand-mark">HC</div><div><div class="brand-title">HOUSE CLEANING</div><div class="brand-sub">Уборка квартир и домов</div></div></div>
        <div class="hero-copy"><h1>Заказать уборку</h1><p>Расскажите об объекте — мы оценим работу и подтвердим заказ.</p></div>
      </section>
      <div class="card pad">
        <h2 style="margin-top:0">Чистота без лишних звонков</h2>
        <p class="page-subtitle">Выберите услугу, загрузите фото объекта и удобное время. Оформление займёт около 2 минут.</p>
        <button class="primary-btn" data-start>Начать оформление</button>
      </div>`;
    root.querySelector('[data-start]').onclick = () => { draft.step = 1; state.saveDraft(); renderBooking(root, navigate); };
    return;
  }

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

function renderService(root, navigate) {
  const services = (state.bootstrap?.services || []).filter((item) => item.kind === 'primary');
  root.innerHTML = shell('Какая уборка вам нужна?', 'Выберите основной вид услуги.', `
    <div class="option-grid" style="margin-top:22px">
      ${services.map((service) => `
        <button type="button" class="option-card ${Number(state.draft.serviceId) === Number(service.id) ? 'selected' : ''}" data-service="${service.id}">
          <strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || '')}</small>
        </button>`).join('')}
    </div>`, actions({ nextDisabled: !state.draft.serviceId }));

  root.querySelectorAll('[data-service]').forEach((button) => button.onclick = () => {
    state.draft.serviceId = Number(button.dataset.service);
    state.saveDraft();
    renderService(root, navigate);
  });
  bindNav(root, 0, () => state.draft.serviceId && go(root, navigate, 2));
}

function renderObject(root, navigate) {
  const draft = state.draft;
  root.innerHTML = shell('Расскажите об объекте', 'Это поможет оценить объём и длительность уборки.', `
    <div class="card pad" style="margin-top:22px">
      <div class="field"><label>Тип объекта</label><select class="select" data-field="propertyType">
        ${PROPERTY_TYPES.map(([value, label]) => `<option value="${value}" ${draft.propertyType === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select></div>
      <div class="field"><label>Площадь, м²</label><input class="input" type="number" min="10" max="5000" inputmode="decimal" value="${draft.area}" data-field="area"></div>
      <div class="row">
        ${counterHtml('Комнаты', 'rooms', draft.rooms)}
        ${counterHtml('Санузлы', 'bathrooms', draft.bathrooms)}
      </div>
      <div class="switch-row"><div><strong>Есть животные</strong><div class="profile-meta">Сообщим клинеру заранее</div></div><button type="button" class="switch ${draft.pets ? 'on' : ''}" data-pets><i></i></button></div>
    </div>`, actions());

  root.querySelector('[data-field="propertyType"]').onchange = (e) => { draft.propertyType = e.target.value; state.saveDraft(); };
  root.querySelector('[data-field="area"]').oninput = (e) => { draft.area = Number(e.target.value || 0); state.saveDraft(); };
  root.querySelectorAll('[data-counter]').forEach((button) => button.onclick = () => {
    const field = button.dataset.counter;
    const delta = Number(button.dataset.delta);
    const max = field === 'rooms' ? 50 : 20;
    draft[field] = Math.max(0, Math.min(max, Number(draft[field]) + delta));
    state.saveDraft();
    renderObject(root, navigate);
  });
  root.querySelector('[data-pets]').onclick = () => { draft.pets = !draft.pets; state.saveDraft(); renderObject(root, navigate); };
  bindNav(root, 1, () => {
    if (draft.area < 10 || draft.area > 5000) return showToast('Проверьте площадь объекта', true);
    go(root, navigate, 3);
  });
}

function counterHtml(label, field, value) {
  return `<div class="field"><label>${label}</label><div class="counter"><button type="button" data-counter="${field}" data-delta="-1">−</button><span>${value}</span><button type="button" data-counter="${field}" data-delta="1">+</button></div></div>`;
}

function renderAddons(root, navigate) {
  const addons = (state.bootstrap?.services || []).filter((item) => item.kind === 'addon');
  root.innerHTML = shell('Дополнительные услуги', 'Выберите только то, что действительно нужно.', `
    <div class="option-grid" style="margin-top:22px">
      ${addons.map((service) => `
        <button type="button" class="option-card ${state.draft.addonIds.includes(service.id) ? 'selected' : ''}" data-addon="${service.id}">
          <strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || '')}${service.fixed_price ? ` · ${money(service.fixed_price)}` : ''}</small>
        </button>`).join('') || '<div class="empty card">Дополнительные услуги пока не настроены</div>'}
    </div>`, actions({ next: 'Продолжить' }));
  root.querySelectorAll('[data-addon]').forEach((button) => button.onclick = () => {
    const id = Number(button.dataset.addon);
    state.draft.addonIds = state.draft.addonIds.includes(id) ? state.draft.addonIds.filter((item) => item !== id) : [...state.draft.addonIds, id];
    state.saveDraft();
    renderAddons(root, navigate);
  });
  bindNav(root, 2, () => go(root, navigate, 4));
}

function renderPhotos(root, navigate) {
  root.innerHTML = shell('Покажите нам объект', 'Добавьте фото помещений — так мы точнее оценим объём работы.', `
    <div style="margin-top:22px">
      <label class="photo-drop" for="photo-input"><div><strong>+ Добавить фотографии</strong><small>Камера или галерея · до 10 фото</small></div></label>
      <input id="photo-input" type="file" accept="image/*" multiple class="hidden">
      <div class="photo-grid">
        ${state.photos.map((item, index) => `<div class="photo-thumb"><img src="${item.url}" alt="Фото объекта ${index + 1}"><button type="button" data-remove-photo="${index}">×</button></div>`).join('')}
      </div>
      <div class="photo-count">${state.photos.length} из 10 фотографий</div>
    </div>`, actions({ nextDisabled: state.photos.length < 1 }));

  const input = root.querySelector('#photo-input');
  input.onchange = async () => {
    const files = [...input.files].slice(0, Math.max(0, 10 - state.photos.length));
    if (!files.length) return;
    input.disabled = true;
    try {
      for (const file of files) {
        const compressed = await compressImage(file);
        state.photos.push({ file: compressed, url: URL.createObjectURL(compressed) });
      }
      await state.persistPhotos();
      renderPhotos(root, navigate);
    } catch (error) {
      showToast(error.message || 'Не удалось обработать фото', true);
      input.disabled = false;
    }
  };
  root.querySelectorAll('[data-remove-photo]').forEach((button) => button.onclick = () => {
    const index = Number(button.dataset.removePhoto);
    URL.revokeObjectURL(state.photos[index].url);
    state.photos.splice(index, 1);
    state.persistPhotos();
    renderPhotos(root, navigate);
  });
  bindNav(root, 3, () => state.photos.length ? go(root, navigate, 5) : showToast('Добавьте минимум одно фото', true));
}

function renderAddress(root, navigate) {
  const d = state.draft;
  root.innerHTML = shell('Куда приехать?', 'Укажите точный адрес объекта.', `
    <div class="card pad" style="margin-top:22px">
      ${field('Город', 'city', d.city, 'Санкт-Петербург')}
      ${field('Улица и дом', 'address', d.address, 'Невский проспект, 10')}
      <div class="row">${field('Квартира / офис', 'apartment', d.apartment, '25')}${field('Подъезд', 'entrance', d.entrance, '2')}</div>
      ${field('Этаж', 'floor', d.floor, '7')}
      <div class="field"><label>Комментарий к адресу</label><textarea class="textarea" data-field="addressComment" placeholder="Вход со двора, домофон 125">${escapeHtml(d.addressComment)}</textarea></div>
    </div>`, actions());
  bindFields(root);
  bindNav(root, 4, () => {
    if (!d.city.trim() || !d.address.trim()) return showToast('Укажите город, улицу и дом', true);
    go(root, navigate, 6);
  });
}

function field(label, name, value, placeholder = '') {
  return `<div class="field"><label>${label}</label><input class="input" data-field="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></div>`;
}

function bindFields(root) {
  root.querySelectorAll('[data-field]').forEach((input) => input.oninput = () => {
    state.draft[input.dataset.field] = input.value;
    state.saveDraft();
  });
}

function renderSchedule(root, navigate) {
  const d = state.draft;
  const minDate = new Date().toISOString().slice(0, 10);
  root.innerHTML = shell('Когда вам удобно?', 'Выберите дату — доступные часы появятся ниже.', `
    <div class="card pad" style="margin-top:22px">
      <div class="field"><label>Дата</label><input class="input" type="date" min="${minDate}" value="${escapeHtml(d.date)}" data-date></div>
      <div data-slots>${d.date ? '<div class="loading" style="min-height:150px"><div><div class="spinner"></div>Проверяем время...</div></div>' : '<div class="empty">Сначала выберите дату</div>'}</div>
    </div>`, actions({ nextDisabled: !d.date || !d.time }));

  const dateInput = root.querySelector('[data-date]');
  dateInput.onchange = () => {
    d.date = dateInput.value;
    d.time = '';
    state.saveDraft();
    renderSchedule(root, navigate);
  };

  if (d.date) loadSlots(root, navigate, d.date);
  bindNav(root, 5, () => d.date && d.time ? go(root, navigate, 7) : showToast('Выберите дату и время', true));
}

async function loadSlots(root, navigate, date) {
  try {
    const data = await api.availability(date);
    const container = root.querySelector('[data-slots]');
    if (!container) return;
    if (data.closed) {
      container.innerHTML = '<div class="empty">На эту дату запись закрыта</div>';
      return;
    }
    container.innerHTML = `<div class="slot-grid">${data.slots.map((slot) => `<button type="button" class="slot ${!slot.available ? 'unavailable' : ''} ${state.draft.time === slot.time ? 'selected' : ''}" data-time="${slot.time}" ${!slot.available ? 'disabled' : ''}>${slot.time}</button>`).join('')}</div>`;
    container.querySelectorAll('[data-time]').forEach((button) => button.onclick = () => {
      state.draft.time = button.dataset.time;
      state.saveDraft();
      renderSchedule(root, navigate);
    });
  } catch (error) {
    const container = root.querySelector('[data-slots]');
    if (container) container.innerHTML = `<div class="empty">${escapeHtml(error.message || 'Не удалось загрузить время')}</div>`;
  }
}

function renderContacts(root, navigate) {
  const d = state.draft;
  root.innerHTML = shell('Как с вами связаться?', 'Проверьте имя и номер телефона.', `
    <div class="card pad" style="margin-top:22px">
      ${field('Ваше имя', 'customerName', d.customerName, 'Анна')}
      <div class="field"><label>Телефон</label><input class="input" type="tel" inputmode="tel" data-field="phone" value="${escapeHtml(d.phone)}" placeholder="+7 999 000-00-00"></div>
      <div class="field"><label>Комментарий</label><textarea class="textarea" data-field="comment" placeholder="Что ещё нам нужно знать?">${escapeHtml(d.comment)}</textarea></div>
    </div>`, actions({ next: 'Проверить заявку' }));
  bindFields(root);
  bindNav(root, 6, () => {
    if (!d.customerName.trim()) return showToast('Укажите имя', true);
    if (String(d.phone).replace(/\D/g, '').length < 10) return showToast('Укажите корректный телефон', true);
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

  root.innerHTML = shell('Проверьте заявку', 'Перед отправкой убедитесь, что всё указано верно.', `
    <div class="card pad" style="margin-top:22px">
      ${summary('Уборка', primary?.name || '—')}
      ${summary('Объект', `${propertyLabel}, ${d.area} м²`)}
      ${summary('Адрес', `${d.city}, ${d.address}${d.apartment ? `, ${d.apartment}` : ''}`)}
      ${summary('Дата', formatDate(d.date))}
      ${summary('Время', d.time)}
      ${summary('Комнаты / санузлы', `${d.rooms} / ${d.bathrooms}`)}
      ${summary('Доп. услуги', addons.length ? addons.map((item) => item.name).join(', ') : 'Нет')}
      ${summary('Фото', `${state.photos.length} шт.`)}
      ${summary('Контакт', `${d.customerName}, ${d.phone}`)}
    </div>
    <div class="card pad" style="margin-top:14px">
      <span class="profile-meta">Предварительная стоимость</span>
      <div class="price" style="margin-top:6px">${estimate > 0 ? money(estimate) : 'Уточнит администратор'}</div>
    </div>`, actions({ next: 'Отправить заявку', nextDisabled: state.photos.length < 1 }));

  bindNav(root, 7, async () => {
    if (!state.photos.length) return showToast('Добавьте фотографии объекта', true);
    const button = root.querySelector('[data-next]');
    button.disabled = true;
    button.textContent = 'Отправляем...';
    try {
      const result = await api.createOrder({ ...d }, state.photos.map((item) => item.file));
      const order = result.order;
      await state.resetDraft();
      renderSuccess(root, navigate, order);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Отправить заявку';
      showToast(error.message || 'Не удалось отправить заявку', true);
    }
  });
}

function summary(label, value) {
  return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function renderSuccess(root, navigate, order) {
  root.innerHTML = `<div class="success">
    <div class="success-icon">✓</div>
    <h1 class="page-title">Заявка отправлена</h1>
    <p class="page-subtitle">Мы проверим информацию и сообщим после подтверждения.</p>
    <div class="card pad" style="margin:26px 0;text-align:left">${summary('Номер заявки', order.order_number || `#${order.id}`)}</div>
    <button class="primary-btn" data-open>Открыть заявку</button>
    <button class="secondary-btn" style="margin-top:10px" data-home>На главную</button>
  </div>`;
  root.querySelector('[data-open]').onclick = () => navigate('orders', { orderId: order.id });
  root.querySelector('[data-home]').onclick = () => navigate('booking');
}

function bindNav(root, backStep, nextHandler) {
  const back = root.querySelector('[data-back]');
  if (back) back.onclick = () => go(root, null, backStep);
  const next = root.querySelector('[data-next]');
  if (next) next.onclick = nextHandler;
}

function go(root, navigate, step) {
  state.draft.step = step;
  state.saveDraft();
  renderBooking(root, navigate || (() => {}));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
