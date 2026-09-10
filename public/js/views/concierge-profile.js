import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, showToast } from '../utils.js';

const FAQ = [
  ['Где вы работаете?', 'Только Санкт-Петербург и Ленинградская область.'],
  ['Как рассчитывается стоимость?', 'Предварительная стоимость считается по площади и выбранному виду уборки. Точную сумму подтверждает менеджер после оценки объекта и фотографий.'],
  ['Зачем нужны фотографии объекта?', 'Они помогают менеджеру оценить состояние помещения, объём работ и подготовить команду до выезда.'],
  ['Можно ли перенести или отменить запись?', 'Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже изменения согласовываются с менеджером.'],
  ['Когда менеджер подтвердит заявку?', 'После проверки параметров объекта, выбранной даты и фотографий. После подтверждения бот отправит отдельное уведомление.'],
  ['Что делать, если площадь больше 300 м²?', 'Для объектов больше 300 м² требуется отдельное согласование с менеджером.'],
];

function icon(name) {
  const icons = {
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.5-4.1 3.1-6.3 7.5-6.3s7 2.2 7.5 6.3"/></svg>',
    history: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l2.5 1.5"/></svg>',
    price: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h5M8 16h8"/></svg>',
    faq: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 4.3 1.5c-.9.9-2.1 1.3-2.1 2.8M12 17h.01"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.1-.6L4 20l1.5-4.1A7.3 7.3 0 0 1 4 11.5 7.6 7.6 0 0 1 12 4a7.6 7.6 0 0 1 8 7.5Z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.2 8.2-8 10-4.8-1.8-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  };
  return icons[name] || icons.user;
}

function managerUsername() {
  return String(state.bootstrap?.config?.managerUsername || state.bootstrap?.config?.botUsername || '').replace(/^@/, '');
}

function openManager() {
  const username = managerUsername();
  if (!username) return showToast('Контакт администратора пока не настроен', true);
  const url = `https://t.me/${username}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

function menuRow(name, title, subtitle, iconName) {
  return `<button class="cc-menu-row" type="button" data-menu="${name}"><span class="cc-menu-icon">${icon(iconName)}</span><span class="cc-menu-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span><span class="cc-menu-arrow">›</span></button>`;
}

function loyaltyCard(user) {
  const level = user.loyalty_level || user.level || '';
  const discount = Number(user.discount_percent ?? user.discount ?? 0);
  if (!level && !(discount > 0)) return '';
  return `<div class="card cc-care-card" style="margin:10px 0 14px"><div class="cc-care-icon">${icon('shield')}</div><div class="cc-care-copy"><strong>Ваш уровень${level ? ` · ${escapeHtml(level)}` : ''}</strong><span>${discount > 0 ? `Персональная скидка ${discount}%` : 'Привилегии программы лояльности'}</span></div><span class="cc-care-arrow">›</span></div>`;
}

export function renderConciergeProfile(root, navigate) {
  const user = state.bootstrap?.user || {};
  const displayName = user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Клиент';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'H';
  const username = user.username ? `@${user.username}` : 'Telegram';
  const addressesAvailable = Array.isArray(user.addresses) && user.addresses.length > 0;

  root.innerHTML = `
    <div class="cc-profile-page">
      <header class="cc-profile-head"><div><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1 class="page-title">Профиль</h1><p class="page-subtitle">Ваши данные, помощь и полезная информация.</p></div></header>
      <div class="card cc-profile-card">
        <div class="cc-avatar">${user.photo_url ? `<img src="${escapeHtml(user.photo_url)}" alt="">` : escapeHtml(initial)}</div>
        <div class="cc-profile-copy"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(username)}${user.telegram_id ? ` · ID ${escapeHtml(user.telegram_id)}` : ''}</span></div>
        <b>›</b>
      </div>
      ${loyaltyCard(user)}
      <div class="cc-profile-note"><i></i><span>Обслуживаем Санкт-Петербург и Ленинградскую область</span></div>
      <div class="card cc-menu">
        ${menuRow('edit', 'Мои данные', 'Имя и номер телефона', 'user')}
        ${addressesAvailable ? menuRow('addresses', 'Мои адреса', 'Сохранённые адреса', 'pin') : ''}
        ${menuRow('history', 'История уборок', 'Все ваши заявки', 'history')}
        ${menuRow('price', 'Прайс', 'Услуги и ориентировочные цены', 'price')}
        ${menuRow('faq', 'Частые вопросы', 'Короткие ответы о сервисе', 'faq')}
        ${menuRow('help', 'Связаться с администратором', 'Вопрос по заявке или услуге', 'chat')}
        ${menuRow('rules', 'Правила и условия', 'Порядок работы HOUSE CLEANING', 'shield')}
      </div>
    </div>`;

  root.querySelector('[data-menu="edit"]').onclick = () => showEdit(root, navigate);
  root.querySelector('[data-menu="history"]').onclick = () => navigate('orders');
  root.querySelector('[data-menu="price"]').onclick = () => showPrice(root, navigate);
  root.querySelector('[data-menu="faq"]').onclick = () => showFaq(root, navigate);
  root.querySelector('[data-menu="help"]').onclick = openManager;
  root.querySelector('[data-menu="rules"]').onclick = () => showRules(root, navigate);
  root.querySelector('[data-menu="addresses"]')?.addEventListener('click', () => showAddresses(root, navigate, user.addresses));
}

function subpageHeader(title, subtitle = '') {
  return `<button class="cc-back" type="button" data-back>← Профиль</button><header class="cc-subpage-head"><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1>${escapeHtml(title)}</h1>${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ''}</header>`;
}

function showFaq(root, navigate) {
  root.innerHTML = `${subpageHeader('Частые вопросы', 'Всё важное о записи, стоимости и работе сервиса.')}
    <div class="cc-faq-list">${FAQ.map((item, index) => `<button class="cc-faq ${index === 0 ? 'open' : ''}" type="button" data-faq><span class="cc-faq-q"><strong>${escapeHtml(item[0])}</strong><i>⌄</i></span><span class="cc-faq-a">${escapeHtml(item[1])}</span></button>`).join('')}</div>
    <button class="cc-contact-card" type="button" data-contact><span><span>Не нашли ответ?</span><strong>Написать администратору</strong></span><b>›</b></button>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
  root.querySelectorAll('[data-faq]').forEach((item) => item.onclick = () => item.classList.toggle('open'));
  root.querySelector('[data-contact]').onclick = openManager;
}

function showPrice(root, navigate) {
  const services = state.bootstrap?.services || [];
  const primary = services.filter((service) => service.kind === 'primary');
  const addons = services.filter((service) => service.kind === 'addon');
  root.innerHTML = `${subpageHeader('Прайс', 'Ориентировочные цены. Точную стоимость подтверждает менеджер после оценки объекта.')}
    <div class="cc-section-head"><h2>Основные услуги</h2><span>за м²</span></div>
    <div class="cc-price-list">${primary.map(serviceRow).join('') || '<div class="card cc-order-empty">Услуги пока не настроены</div>'}</div>
    ${addons.length ? `<div class="cc-section-head" style="margin-top:20px"><h2>Дополнительно</h2><span>по оценке</span></div><div class="cc-price-list">${addons.map(serviceRow).join('')}</div>` : ''}`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
}

function serviceRow(service) {
  const price = service.price_per_m2 ? `от ${service.price_per_m2} ₽/м²` : service.fixed_price ? `от ${service.fixed_price} ₽` : 'После оценки';
  return `<div class="card cc-price-row"><div><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || '')}</small></div><b>${escapeHtml(price)}</b></div>`;
}

function showEdit(root, navigate) {
  const user = state.bootstrap?.user || {};
  root.innerHTML = `${subpageHeader('Мои данные', 'Используем их при оформлении следующих заявок.')}
    <div class="card cc-form-card">
      <div class="field"><label>Имя</label><input class="input" data-name value="${escapeHtml(user.name || user.first_name || '')}" data-label="Имя"></div>
      <div class="field"><label>Телефон</label><input class="input" data-phone type="tel" value="${escapeHtml(user.phone || '')}" data-label="Телефон"></div>
    </div>
    <button class="primary-btn" style="margin-top:12px" type="button" data-save>Сохранить</button>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
  root.querySelector('[data-save]').onclick = async () => {
    const button = root.querySelector('[data-save]');
    const payload = { name: root.querySelector('[data-name]').value, phone: root.querySelector('[data-phone]').value };
    button.disabled = true;
    try {
      await api.updateMe(payload);
      state.bootstrap.user.name = payload.name.trim();
      state.bootstrap.user.phone = payload.phone.trim();
      showToast('Данные сохранены');
      renderConciergeProfile(root, navigate);
    } catch (error) {
      button.disabled = false;
      showToast(error.message || 'Не удалось сохранить данные', true);
    }
  };
}

function showAddresses(root, navigate, addresses) {
  root.innerHTML = `${subpageHeader('Мои адреса', 'Адреса, которые уже сохранены в вашем профиле.')}
    <div class="cc-price-list">${addresses.map((address) => {
      const value = typeof address === 'string' ? address : [address.city, address.address].filter(Boolean).join(', ');
      return `<div class="card cc-price-row"><div><strong>${escapeHtml(value || 'Адрес')}</strong></div></div>`;
    }).join('')}</div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
}

function showRules(root, navigate) {
  root.innerHTML = `${subpageHeader('Правила и условия')}
    <div class="card cc-form-card" style="font-size:12px;line-height:1.65;color:#9aa5ad">
      <p>Мы работаем только в Санкт-Петербурге и Ленинградской области.</p>
      <p>Заявка считается принятой после подтверждения администратором HOUSE CLEANING.</p>
      <p>Предварительная стоимость рассчитывается по площади и выбранным услугам. Точная стоимость может быть уточнена после просмотра фотографий и параметров объекта.</p>
      <p>Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже изменения согласовываются с администратором.</p>
    </div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
}
