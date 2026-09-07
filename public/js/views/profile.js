import { api } from '../api.js';
import { escapeHtml, showToast } from '../utils.js';
import { state } from '../state.js';

export function renderProfile(root, navigate) {
  const user = state.bootstrap?.user || {};
  const displayName = user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Клиент';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'H';
  root.innerHTML = `
    <h1 class="page-title">Профиль</h1><p class="page-subtitle">Ваши данные и помощь</p>
    <div class="card profile-card">
      <div class="avatar">${user.photo_url ? `<img src="${escapeHtml(user.photo_url)}" alt="">` : escapeHtml(initial)}</div>
      <div><div class="profile-name">${escapeHtml(displayName)}</div><div class="profile-meta">${user.username ? '@' + escapeHtml(user.username) + ' · ' : ''}Telegram ID: ${escapeHtml(user.telegram_id || '')}</div></div>
    </div>
    <div class="card menu-list">
      <button class="menu-row" data-edit><div><strong>Мои данные</strong><small>Имя и номер телефона</small></div><span>›</span></button>
      <button class="menu-row" data-history><div><strong>История уборок</strong><small>Все завершённые заявки</small></div><span>›</span></button>
      <button class="menu-row" data-price><div><strong>Прайс</strong><small>Основные и дополнительные услуги</small></div><span>›</span></button>
      <button class="menu-row" data-help><div><strong>Связаться с администратором</strong><small>Вопрос по заявке или услуге</small></div><span>›</span></button>
      <button class="menu-row" data-rules><div><strong>Правила и условия</strong><small>Порядок работы HOUSE CLEANING</small></div><span>›</span></button>
    </div>`;

  root.querySelector('[data-history]').onclick = () => navigate('orders');
  root.querySelector('[data-price]').onclick = () => showPrice(root, navigate);
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

function showPrice(root, navigate) {
  const services = state.bootstrap?.services || [];
  root.innerHTML = `<button class="secondary-btn" style="width:auto;min-height:44px;padding:10px 14px;margin-bottom:18px" data-back>← Назад</button><h1 class="page-title">Прайс</h1><p class="page-subtitle">Актуальные услуги HOUSE CLEANING</p>
    <h2 class="section-title">Основные услуги</h2>${services.filter(s => s.kind === 'primary').map(serviceCard).join('')}
    <h2 class="section-title">Дополнительно</h2>${services.filter(s => s.kind === 'addon').map(serviceCard).join('')}`;
  root.querySelector('[data-back]').onclick = () => renderProfile(root, navigate);
}

function serviceCard(service) {
  const price = service.price_per_m2 ? `${service.price_per_m2} ₽/м²` : service.fixed_price ? `${service.fixed_price} ₽` : 'Цена после оценки';
  return `<div class="card pad" style="margin-bottom:10px"><strong>${escapeHtml(service.name)}</strong><div class="profile-meta" style="margin-top:5px">${escapeHtml(service.description || '')}</div><div style="color:var(--gold);margin-top:10px;font-weight:800">${escapeHtml(price)}</div></div>`;
}

function showEdit(root, navigate) {
  const user = state.bootstrap?.user || {};
  root.innerHTML = `<button class="secondary-btn" style="width:auto;min-height:44px;padding:10px 14px;margin-bottom:18px" data-back>← Назад</button><h1 class="page-title">Мои данные</h1><p class="page-subtitle">Используем их при оформлении следующих заявок.</p>
    <div class="card pad" style="margin-top:20px"><div class="field"><label>Имя</label><input class="input" data-name value="${escapeHtml(user.name || user.first_name || '')}"></div><div class="field"><label>Телефон</label><input class="input" data-phone type="tel" value="${escapeHtml(user.phone || '')}"></div></div>
    <button class="primary-btn" style="margin-top:18px" data-save>Сохранить</button>`;
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
  root.innerHTML = `<button class="secondary-btn" style="width:auto;min-height:44px;padding:10px 14px;margin-bottom:18px" data-back>← Назад</button><h1 class="page-title">Правила и условия</h1>
    <div class="card pad" style="margin-top:20px;line-height:1.6"><p>Заявка считается принятой после подтверждения администратором HOUSE CLEANING.</p><p>Стоимость может быть уточнена после просмотра фотографий и параметров объекта.</p><p>Если планы изменились, отмените новую заявку в приложении или свяжитесь с администратором.</p></div>`;
  root.querySelector('[data-back]').onclick = () => renderProfile(root, navigate);
}
