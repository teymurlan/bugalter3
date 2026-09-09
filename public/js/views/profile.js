import { api } from '../api.js';
import { escapeHtml, showToast } from '../utils.js';
import { state } from '../state.js';

const FAQ = [
  ['Где вы работаете?', 'Только Санкт-Петербург и Ленинградская область.'],
  ['Как рассчитывается стоимость?', 'Предварительная стоимость считается по площади и выбранному виду уборки. Точную сумму подтверждает менеджер после оценки объекта и фотографий.'],
  ['Нужно ли добавлять фотографии?', 'Да. Фотографии помогают оценить состояние объекта и подготовить команду. При оформлении заявки нужно добавить минимум одно фото.'],
  ['Можно ли перенести или отменить запись?', 'Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже изменения согласовываются с менеджером.'],
  ['Когда менеджер подтвердит заявку?', 'После проверки параметров объекта, выбранной даты и фотографий. После подтверждения бот отправит отдельное уведомление.'],
  ['Что делать, если площадь больше 300 м²?', 'Для объектов больше 300 м² требуется отдельное согласование с менеджером.'],
];

export function renderProfile(root, navigate) {
  const user = state.bootstrap?.user || {};
  const displayName = user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Клиент';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'H';
  root.innerHTML = `
    <div class="profile-heading"><div><span class="eyebrow">HOUSE CLEANING</span><h1 class="page-title">Профиль</h1><p class="page-subtitle">Данные, история и полезная информация</p></div></div>
    <div class="card profile-card refined-profile-card">
      <div class="avatar">${user.photo_url ? `<img src="${escapeHtml(user.photo_url)}" alt="">` : escapeHtml(initial)}</div>
      <div class="profile-main"><div class="profile-name">${escapeHtml(displayName)}</div><div class="profile-meta">${user.username ? '@' + escapeHtml(user.username) : 'Telegram'}${user.telegram_id ? ` · ID ${escapeHtml(user.telegram_id)}` : ''}</div></div>
      <span class="profile-chevron">›</span>
    </div>
    <div class="service-area-mini"><span>⌖</span><div><strong>Зона работы</strong><small>Санкт-Петербург и Ленинградская область</small></div></div>
    <div class="card menu-list elegant-menu-list">
      <button class="menu-row" data-edit><div><strong>Мои данные</strong><small>Имя и номер телефона</small></div><span>›</span></button>
      <button class="menu-row" data-history><div><strong>История уборок</strong><small>Все ваши заявки</small></div><span>›</span></button>
      <button class="menu-row" data-price><div><strong>Прайс</strong><small>Услуги и ориентировочные цены</small></div><span>›</span></button>
      <button class="menu-row" data-faq><div><strong>Частые вопросы</strong><small>Ответы на популярные вопросы</small></div><span>›</span></button>
      <button class="menu-row" data-help><div><strong>Связаться с администратором</strong><small>Вопрос по заявке или услуге</small></div><span>›</span></button>
      <button class="menu-row" data-rules><div><strong>Правила и условия</strong><small>Порядок работы HOUSE CLEANING</small></div><span>›</span></button>
    </div>`;

  root.querySelector('[data-history]').onclick = () => navigate('orders');
  root.querySelector('[data-price]').onclick = () => showPrice(root, navigate);
  root.querySelector('[data-faq]').onclick = () => showFaq(root, navigate);
  root.querySelector('[data-edit]').onclick = () => showEdit(root, navigate);
  root.querySelector('[data-help]').onclick = () => {
    const tg = window.Telegram?.WebApp;
    const username = state.bootstrap?.config?.botUsername;
    if (!username) return showToast('Контакт администратора пока не настроен', true);
    const url = `https://t.me/${username}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, '_blank');
  };
  root.querySelector('[data-rules]').onclick = () => showRules(root, navigate);
}

function showFaq(root, navigate) {
  root.innerHTML = `
    <button class="back-link" type="button" data-back>← Назад</button>
    <span class="eyebrow">HOUSE CLEANING</span>
    <h1 class="page-title compact-page-title">Частые вопросы</h1>
    <p class="page-subtitle">Короткие ответы на то, что спрашивают чаще всего.</p>
    <div class="faq-list">${FAQ.map((item, index) => `
      <button class="faq-item ${index === 0 ? 'open' : ''}" type="button" data-faq-item>
        <span class="faq-question"><strong>${escapeHtml(item[0])}</strong><i>⌄</i></span>
        <span class="faq-answer">${escapeHtml(item[1])}</span>
      </button>`).join('')}</div>
    <button class="faq-contact" type="button" data-contact><span>Не нашли ответ?</span><strong>Написать администратору →</strong></button>`;

  root.querySelector('[data-back]').onclick = () => renderProfile(root, navigate);
  root.querySelectorAll('[data-faq-item]').forEach((item) => item.onclick = () => item.classList.toggle('open'));
  root.querySelector('[data-contact]').onclick = () => {
    const username = state.bootstrap?.config?.botUsername;
    if (!username) return showToast('Контакт администратора пока не настроен', true);
    const url = `https://t.me/${username}`;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, '_blank');
  };
}

function showPrice(root, navigate) {
  const services = state.bootstrap?.services || [];
  root.innerHTML = `<button class="back-link" type="button" data-back>← Назад</button><span class="eyebrow">HOUSE CLEANING</span><h1 class="page-title compact-page-title">Прайс</h1><p class="page-subtitle">Ориентировочные цены. Точную стоимость подтверждает менеджер после оценки объекта.</p>
    <h2 class="section-title">Основные услуги</h2>${services.filter(s => s.kind === 'primary').map(serviceCard).join('')}
    <h2 class="section-title">Дополнительно</h2>${services.filter(s => s.kind === 'addon').map(serviceCard).join('')}`;
  root.querySelector('[data-back]').onclick = () => renderProfile(root, navigate);
}

function serviceCard(service) {
  const price = service.price_per_m2 ? `от ${service.price_per_m2} ₽/м²` : service.fixed_price ? `от ${service.fixed_price} ₽` : 'Цена после оценки';
  return `<div class="card compact-service-card"><div><strong>${escapeHtml(service.name)}</strong><div class="profile-meta">${escapeHtml(service.description || '')}</div></div><b>${escapeHtml(price)}</b></div>`;
}

function showEdit(root, navigate) {
  const user = state.bootstrap?.user || {};
  root.innerHTML = `<button class="back-link" type="button" data-back>← Назад</button><span class="eyebrow">HOUSE CLEANING</span><h1 class="page-title compact-page-title">Мои данные</h1><p class="page-subtitle">Используем их при оформлении следующих заявок.</p>
    <div class="card pad compact-form-card"><div class="field"><label>Имя</label><input class="input" data-name value="${escapeHtml(user.name || user.first_name || '')}"></div><div class="field"><label>Телефон</label><input class="input" data-phone type="tel" value="${escapeHtml(user.phone || '')}"></div></div>
    <button class="primary-btn compact-primary" style="margin-top:14px" data-save>Сохранить</button>`;
  root.querySelector('[data-back]').onclick = () => renderProfile(root, navigate);
  root.querySelector('[data-save]').onclick = async () => {
    const button = root.querySelector('[data-save]');
    button.disabled = true;
    try {
      const payload = { name: root.querySelector('[data-name]').value, phone: root.querySelector('[data-phone]').value };
      await api.updateMe(payload);
      state.bootstrap.user.name = payload.name.trim();
      state.bootstrap.user.phone = payload.phone.trim();
      showToast('Данные сохранены');
      renderProfile(root, navigate);
    } catch (error) {
      button.disabled = false;
      showToast(error.message || 'Не удалось сохранить данные', true);
    }
  };
}

function showRules(root, navigate) {
  root.innerHTML = `<button class="back-link" type="button" data-back>← Назад</button><span class="eyebrow">HOUSE CLEANING</span><h1 class="page-title compact-page-title">Правила и условия</h1>
    <div class="card pad rules-card"><p>Мы работаем только в Санкт-Петербурге и Ленинградской области.</p><p>Заявка считается принятой после подтверждения администратором HOUSE CLEANING.</p><p>Предварительная стоимость рассчитывается по площади. Точная стоимость может быть уточнена после просмотра фотографий и параметров объекта.</p><p>Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже изменения согласовываются с администратором.</p></div>`;
  root.querySelector('[data-back]').onclick = () => renderProfile(root, navigate);
}