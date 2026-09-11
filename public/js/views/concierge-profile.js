import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, showToast } from '../utils.js';

const FAQ = [
  ['Где вы работаете?', 'Только Санкт-Петербург и Ленинградская область.'],
  ['Как рассчитывается стоимость?', 'Предварительная стоимость считается по площади и выбранному виду уборки. Точную сумму подтверждает менеджер после оценки объекта и фотографий.'],
  ['Зачем нужны фотографии объекта?', 'Фотографии нужны только до уборки: они помогают менеджеру оценить состояние помещения и объём работ.'],
  ['Можно ли изменить заявку?', 'Самостоятельно изменить заявку нельзя. Для переноса даты, времени или других деталей свяжитесь с менеджером.'],
  ['Можно ли отменить уборку?', 'Да. Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже отмена и любые изменения — только через менеджера.'],
  ['Как можно оплатить?', 'Оплатить уборку можно картой, по счёту или наличными.'],
  ['Когда менеджер подтвердит заявку?', 'После проверки параметров объекта, выбранной даты и фотографий. Менеджер свяжется с вами выбранным способом.'],
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
    gift: '<svg viewBox="0 0 24 24"><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13"/><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5L12 7Zm0 0h3.5A2.5 2.5 0 1 0 13 4.5L12 7Z"/></svg>',
    pass: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9h10M7 13h6"/></svg>',
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

function withTimeout(promise, timeoutMs, fallback) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function loadCompletedCount() {
  try {
    const data = await withTimeout(api.orders(), 2200, { orders: [] });
    let orders = Array.isArray(data?.orders) ? data.orders : [];
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const abortTimer = controller ? setTimeout(() => controller.abort(), 2200) : null;
      const response = await fetch('/api/demo-client-orders', {
        headers: { 'X-Telegram-Init-Data': initData },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (abortTimer) clearTimeout(abortTimer);
      if (response.ok) {
        const stored = (await response.json())?.orders || [];
        const byNumber = new Map(stored.map((item) => [String(item.order_number || ''), item]));
        orders = orders.map((item) => byNumber.has(String(item.order_number || '')) ? { ...item, ...byNumber.get(String(item.order_number || '')), id: item.id } : item);
      }
    } catch { /* local statuses are enough as fallback */ }
    return orders.filter((order) => order.status === 'COMPLETED').length;
  } catch {
    return 0;
  }
}

function loyaltyInfo(completed) {
  if (completed >= 10) return { discount: 10, target: 10, progress: 100, title: 'Скидка 10%', note: `${completed} завершённых уборок · максимальная текущая скидка` };
  if (completed >= 3) return { discount: 5, target: 10, progress: Math.min(100, completed / 10 * 100), title: 'Скидка 5%', note: `Ещё ${10 - completed} до скидки 10%` };
  return { discount: 0, target: 3, progress: Math.min(100, completed / 3 * 100), title: 'Программа лояльности', note: `Ещё ${3 - completed} до скидки 5%` };
}

function loyaltyCard(completed) {
  const info = loyaltyInfo(completed);
  return `<section class="card cc-loyalty-card"><div class="cc-loyalty-top"><span class="cc-menu-icon">${icon('shield')}</span><div><small>Ваш уровень</small><strong>${escapeHtml(info.title)}</strong></div><b>${completed}</b></div><div class="cc-loyalty-progress"><i style="width:${Math.round(info.progress)}%"></i></div><div class="cc-loyalty-bottom"><span>${escapeHtml(info.note)}</span><small>После 3 уборок — 5%, после 10 — 10%</small></div></section>`;
}

function loyaltyLoadingCard() {
  return `<section class="card cc-loyalty-card"><div class="cc-loyalty-top"><span class="cc-menu-icon">${icon('shield')}</span><div><small>Ваш уровень</small><strong>Программа лояльности</strong></div><b>…</b></div><div class="cc-loyalty-progress"><i style="width:0%"></i></div><div class="cc-loyalty-bottom"><span>Проверяем историю уборок…</span><small>Экран уже доступен — данные загрузятся отдельно</small></div></section>`;
}

function referralCode(user) {
  const raw = String(user.telegram_id || window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '').replace(/\D/g, '');
  if (!raw) return 'HOUSE15';
  const value = Number(raw);
  return Number.isSafeInteger(value) ? `HC${value.toString(36).toUpperCase()}` : `HC${raw.slice(-8)}`;
}

function referralLink(user) {
  const bot = String(state.bootstrap?.config?.botUsername || '').replace(/^@/, '');
  const code = referralCode(user);
  return bot ? `https://t.me/${bot}?start=ref_${code}` : '';
}

async function copyText(value, successText) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(successText);
  } catch {
    showToast(`Код: ${value}`);
  }
}

function shareReferral(user) {
  const link = referralLink(user);
  const code = referralCode(user);
  const text = 'HOUSE CLEANING: по моей рекомендации вы получите скидку 15% на первую уборку.';
  if (!link) return copyText(code, 'Реферальный код скопирован');
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(share);
  else window.open(share, '_blank');
}

export function renderConciergeProfile(root, navigate, params = {}) {
  if (params.section === 'faq') return showFaq(root, navigate);
  if (params.section === 'referral') return showReferral(root, navigate);
  if (params.section === 'subscriptions') return showSubscriptions(root, navigate);

  const user = state.bootstrap?.user || {};
  const displayName = user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Клиент';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'H';
  const username = user.username ? `@${user.username}` : 'Telegram';
  const addressesAvailable = Array.isArray(user.addresses) && user.addresses.length > 0;

  root.innerHTML = `
    <div class="cc-profile-page">
      <header class="cc-profile-head"><div><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1 class="page-title">Профиль</h1><p class="page-subtitle">Ваши данные, привилегии и полезная информация.</p></div></header>
      <div class="card cc-profile-card"><div class="cc-avatar">${user.photo_url ? `<img src="${escapeHtml(user.photo_url)}" alt="">` : escapeHtml(initial)}</div><div class="cc-profile-copy"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(username)}</span></div><b>›</b></div>
      <div data-loyalty-slot>${loyaltyLoadingCard()}</div>
      <div class="cc-profile-note"><i></i><span>Обслуживаем Санкт-Петербург и Ленинградскую область</span></div>
      <div class="card cc-menu">
        ${menuRow('referral', 'Пригласить друзей', '15% вам и 15% другу', 'gift')}
        ${menuRow('subscriptions', 'Абонементы', 'На 5 или 10 уборок', 'pass')}
        ${menuRow('edit', 'Мои данные', 'Имя и номер телефона', 'user')}
        ${addressesAvailable ? menuRow('addresses', 'Мои адреса', 'Сохранённые адреса', 'pin') : ''}
        ${menuRow('history', 'История уборок', 'Все ваши заявки', 'history')}
        ${menuRow('price', 'Прайс', 'Услуги и ориентировочные цены', 'price')}
        ${menuRow('faq', 'Частые вопросы', 'Оплата, отмена и работа сервиса', 'faq')}
        ${menuRow('help', 'Связаться с администратором', 'Вопрос по заявке или услуге', 'chat')}
        ${menuRow('rules', 'Правила и условия', 'Порядок работы HOUSE CLEANING', 'shield')}
      </div>
    </div>`;

  root.querySelector('[data-menu="referral"]').onclick = () => showReferral(root, navigate);
  root.querySelector('[data-menu="subscriptions"]').onclick = () => showSubscriptions(root, navigate);
  root.querySelector('[data-menu="edit"]').onclick = () => showEdit(root, navigate);
  root.querySelector('[data-menu="history"]').onclick = () => navigate('orders');
  root.querySelector('[data-menu="price"]').onclick = () => showPrice(root, navigate);
  root.querySelector('[data-menu="faq"]').onclick = () => showFaq(root, navigate);
  root.querySelector('[data-menu="help"]').onclick = openManager;
  root.querySelector('[data-menu="rules"]').onclick = () => showRules(root, navigate);
  root.querySelector('[data-menu="addresses"]')?.addEventListener('click', () => showAddresses(root, navigate, user.addresses));

  loadCompletedCount().then((completed) => {
    const slot = root.querySelector('[data-loyalty-slot]');
    if (!slot || !root.querySelector('.cc-profile-page')) return;
    slot.innerHTML = loyaltyCard(completed);
  }).catch(() => {});
}

function subpageHeader(title, subtitle = '') {
  return `<button class="cc-back" type="button" data-back>← Профиль</button><header class="cc-subpage-head"><span class="cc-kicker">HOUSE CLEANING · CONCIERGE</span><h1>${escapeHtml(title)}</h1>${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ''}</header>`;
}

function showReferral(root, navigate) {
  const user = state.bootstrap?.user || {};
  const code = referralCode(user);
  const link = referralLink(user);
  root.innerHTML = `${subpageHeader('Пригласить друзей', 'Порекомендуйте HOUSE CLEANING и получите скидку вместе.')}
    <section class="card cc-referral-hero"><span class="cc-referral-badge">15% + 15%</span><h2>15% другу на первую уборку</h2><p>После выполненной уборки приглашённого друга вы получите 15% на свою следующую уборку.</p></section>
    <div class="card cc-ref-code"><small>Ваш код</small><strong>${escapeHtml(code)}</strong><span>${link ? 'Можно отправить код или персональную ссылку' : 'Отправьте этот код другу'}</span></div>
    <div class="cc-ref-actions"><button class="primary-btn" type="button" data-share>Поделиться с другом</button><button class="secondary-btn" type="button" data-copy>${link ? 'Скопировать ссылку' : 'Скопировать код'}</button></div>
    <div class="cc-policy-note"><strong>Как это работает:</strong> друг оформляет первую уборку по вашей рекомендации. После её выполнения скидка 15% становится доступна вам на следующую уборку.</div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
  root.querySelector('[data-share]').onclick = () => shareReferral(user);
  root.querySelector('[data-copy]').onclick = () => copyText(link || code, link ? 'Реферальная ссылка скопирована' : 'Реферальный код скопирован');
}

function showSubscriptions(root, navigate) {
  const plan = (count) => `<section class="card cc-pass-card"><div class="cc-pass-top"><span>Абонемент</span><strong>${count} уборок</strong></div><ul><li>Меньше повторных оформлений</li><li>Удобнее планировать регулярную уборку</li><li>Персональное сопровождение менеджера</li><li>Параметры следующих уборок можно согласовывать заранее</li></ul><button class="primary-btn" type="button" data-pass-manager>Оформить через менеджера</button></section>`;
  root.innerHTML = `${subpageHeader('Абонементы', 'Для тех, кому нужна регулярная уборка без лишних повторных оформлений.')}
    <div class="cc-pass-list">${plan(5)}${plan(10)}</div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
  root.querySelectorAll('[data-pass-manager]').forEach((button) => button.onclick = openManager);
}

function showFaq(root, navigate) {
  root.innerHTML = `${subpageHeader('Частые вопросы', 'Всё важное о записи, стоимости, оплате и работе сервиса.')}
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
    <div class="cc-section-head"><h2>Основные услуги</h2><span>за м²</span></div><div class="cc-price-list">${primary.map(serviceRow).join('') || '<div class="card cc-order-empty">Услуги пока не настроены</div>'}</div>
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
    <div class="card cc-form-card"><div class="field"><label>Имя</label><input class="input" data-name value="${escapeHtml(user.name || user.first_name || '')}" data-label="Имя"></div><div class="field"><label>Телефон</label><input class="input" data-phone type="tel" value="${escapeHtml(user.phone || '')}" data-label="Телефон"></div></div>
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
    <div class="cc-price-list">${addresses.map((address) => { const value = typeof address === 'string' ? address : [address.city, address.address].filter(Boolean).join(', '); return `<div class="card cc-price-row"><div><strong>${escapeHtml(value || 'Адрес')}</strong></div></div>`; }).join('')}</div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
}

function showRules(root, navigate) {
  root.innerHTML = `${subpageHeader('Правила и условия')}
    <div class="card cc-form-card" style="font-size:12px;line-height:1.65;color:#9aa5ad"><p>Мы работаем только в Санкт-Петербурге и Ленинградской области.</p><p>Заявка считается принятой после подтверждения менеджером HOUSE CLEANING.</p><p>Предварительная стоимость рассчитывается по площади и выбранным услугам. Точная стоимость может быть уточнена после просмотра фотографий и параметров объекта.</p><p>Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже изменения и отмена согласовываются с менеджером.</p></div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
}
