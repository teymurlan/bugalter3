import { state } from '../state.js';
import { escapeHtml, formatDate, showToast } from '../utils.js';

const FAQ = [
  ['Как рассчитывается стоимость?', 'Предварительная стоимость рассчитывается по площади, виду уборки и дополнительным услугам. Точную сумму менеджер подтверждает после проверки заявки.'],
  ['Когда фотографии обязательны?', 'Для первого заказа на новый адрес фотографии обязательны. Если HOUSE CLEANING уже успешно убирал этот адрес и квартиру, при следующем заказе фото можно не добавлять.'],
  ['Можно ли изменить заявку?', 'Самостоятельное изменение заявки не предусмотрено. Для переноса даты, времени, адреса или услуг напишите менеджеру.'],
  ['Можно ли отменить уборку?', 'Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже — через менеджера.'],
  ['Как можно оплатить?', 'Оплата возможна картой, по счёту или наличными.'],
  ['Когда менеджер подтвердит заявку?', 'После оформления менеджер проверит данные и свяжется с вами выбранным способом.'],
  ['Как оформить абонемент?', 'Выберите подходящий абонемент на 5 или 10 уборок и напишите менеджеру — он поможет согласовать график.'],
  ['Как связаться с менеджером?', 'Нажмите «Написать менеджеру» — откроется личный диалог в Telegram.'],
];

function headers(extra = {}) { return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '', ...extra }; }
async function getJson(path) { const response = await fetch(path, { headers: headers() }); const data = await response.json().catch(() => ({})); if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`); return data; }
async function postJson(path, body) { const response = await fetch(path, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }); const data = await response.json().catch(() => ({})); if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`); return data; }
async function patchProfile(payload) { const response = await fetch('/api/client-profile', { method: 'PATCH', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) }); const data = await response.json().catch(() => ({})); if (!response.ok || data?.ok === false) throw new Error(data?.error || 'Не удалось сохранить данные'); return data.profile || payload; }

function icon(name) {
  const map = {
    gift: '<svg viewBox="0 0 24 24"><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13"/><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5L12 7Zm0 0h3.5A2.5 2.5 0 1 0 13 4.5L12 7Z"/></svg>',
    pass: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9h10M7 13h6"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.4 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.4-4.2 6-.9L12 3Z"/></svg>',
    price: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h5M8 16h8"/></svg>',
    faq: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 4.3 1.5c-.9.9-2.1 1.3-2.1 2.8M12 17h.01"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.1-.6L4 20l1.5-4.1A7.3 7.3 0 0 1 4 11.5 7.6 7.6 0 0 1 12 4a7.6 7.6 0 0 1 8 7.5Z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.2 8.2-8 10-4.8-1.8-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    palette: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.4-3c-.9-1-.2-2.6 1.1-2.6H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10.5" cy="6.8" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>',
  };
  return map[name] || map.shield;
}

function menuRow(name, title, subtitle, iconName) {
  return `<button class="cc-menu-row" type="button" data-menu="${name}"><span class="cc-menu-icon">${icon(iconName)}</span><span class="cc-menu-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span><span class="cc-menu-arrow">›</span></button>`;
}
function subpageHeader(title, subtitle = '') { return `<button class="cc-back hc-fixed-back" type="button" data-back>← Назад</button><header class="cc-subpage-head hc-subpage-offset"><span class="cc-kicker">HOUSE CLEANING</span><h1>${escapeHtml(title)}</h1>${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ''}</header>`; }
function goBack(root, navigate, from = 'profile') {
  if (from !== 'profile') return window.HCNavigation?.back?.(from) || navigate(from);
  return renderConciergeProfile(root, navigate);
}

async function openManager() {
  try {
    const data = await getJson('/api/manager-contact');
    const username = String(data?.username || data?.telegram_username || '').replace(/^@/, '');
    if (username) return openTelegram(`https://t.me/${username}`);
  } catch {}
  const username = String(state.bootstrap?.config?.managerUsername || state.bootstrap?.config?.botUsername || '').replace(/^@/, '');
  if (!username) return showToast('Контакт менеджера пока не настроен', true);
  openTelegram(`https://t.me/${username}`);
}
function openTelegram(url) { const tg = window.Telegram?.WebApp; if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank'); }

export function renderConciergeProfile(root, navigate, params = {}) {
  const from = params.from || 'profile';
  if (params.section === 'faq') return showFaq(root, navigate, from);
  if (params.section === 'subscriptions') return showSubscriptions(root, navigate, from);
  if (params.section === 'reviews') return showReviews(root, navigate, from);
  if (params.section === 'data') return showEdit(root, navigate, from);
  if (params.section === 'price') return showPrice(root, navigate, from);
  if (params.section === 'contact') return showContact(root, navigate, from);
  if (params.section === 'rules') return showRules(root, navigate, from);
  if (params.section === 'appearance') return showAppearance(root, navigate, from);
  if (params.section === 'notifications') return showNotifications(root, navigate, from);

  const user = state.bootstrap?.user || {};
  const displayName = user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Клиент';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'H';
  const username = user.username ? `@${user.username}` : 'Telegram';
  root.innerHTML = `<div class="cc-profile-page"><header class="cc-profile-head"><div><span class="cc-kicker">HOUSE CLEANING</span><h1 class="page-title">Профиль</h1><p class="page-subtitle">Ваши данные и сервис HOUSE CLEANING.</p></div></header>
    <button class="card cc-profile-card cc-profile-card-button" type="button" data-profile-data><div class="cc-avatar">${user.photo_url ? `<img src="${escapeHtml(user.photo_url)}" alt="">` : escapeHtml(initial)}</div><div class="cc-profile-copy"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(username)}</span><small>Имя, телефоны и адрес</small></div><b>›</b></button>
    <div class="card cc-menu">${menuRow('notifications', 'Уведомления', 'Напоминания и сообщения о заказах', 'bell')}${menuRow('appearance', 'Внешний вид', 'Светлая, тёмная или синяя тема', 'palette')}${menuRow('subscriptions', 'Абонементы', 'Регулярная уборка на 5 или 10 визитов', 'pass')}${menuRow('reviews', 'Отзывы', 'Оценки клиентов HOUSE CLEANING', 'star')}${menuRow('price', 'Прайс', 'Услуги и ориентировочные цены', 'price')}${menuRow('faq', 'Частые вопросы', 'Коротко о заказе и сервисе', 'faq')}${menuRow('help', 'Связаться с менеджером', 'Написать в Telegram', 'chat')}${menuRow('rules', 'Правила и условия', 'Порядок работы HOUSE CLEANING', 'shield')}</div></div>`;
  root.querySelector('[data-profile-data]').onclick = () => showEdit(root, navigate, 'profile');
  root.querySelector('[data-menu="notifications"]').onclick = () => showNotifications(root, navigate, 'profile');
  root.querySelector('[data-menu="appearance"]').onclick = () => showAppearance(root, navigate, 'profile');
  root.querySelector('[data-menu="subscriptions"]').onclick = () => showSubscriptions(root, navigate, 'profile');
  root.querySelector('[data-menu="reviews"]').onclick = () => showReviews(root, navigate, 'profile');
  root.querySelector('[data-menu="price"]').onclick = () => showPrice(root, navigate, 'profile');
  root.querySelector('[data-menu="faq"]').onclick = () => showFaq(root, navigate, 'profile');
  root.querySelector('[data-menu="help"]').onclick = () => showContact(root, navigate, 'profile');
  root.querySelector('[data-menu="rules"]').onclick = () => showRules(root, navigate, 'profile');
}

async function showAppearance(root, navigate, from) {
  const themes = window.HCUltraTheme?.options || [
    { id:'light', label:'Светлая' },
    { id:'dark', label:'Тёмная' },
    { id:'blue', label:'Синяя' },
  ];
  const current = window.HCUltraTheme?.get?.() || 'light';
  root.innerHTML = `${subpageHeader('Внешний вид', 'Выберите оформление приложения. Настройка сохранится на этом устройстве.')}
    <section class="card pad"><div class="u7-theme-grid">
      ${themes.map((item) => `<button class="u7-theme-choice ${current===item.id?'active':''}" type="button" data-theme="${escapeHtml(item.id)}"><i></i><span>${escapeHtml(item.label)}</span></button>`).join('')}
    </div><div class="cc-policy-note"><strong>Ultra 7:</strong> тема меняет фон, карточки, поля, нижнее меню и системные цвета Telegram Mini App.</div></section>`;
  root.querySelector('[data-back]').onclick = () => goBack(root, navigate, from);
  root.querySelectorAll('[data-theme]').forEach((button) => {
    button.onclick = () => {
      const selected = button.dataset.theme;
      window.HCUltraTheme?.set?.(selected);
      root.querySelectorAll('[data-theme]').forEach((item) => item.classList.toggle('active', item.dataset.theme === selected));
      showToast('Оформление сохранено');
    };
  });
}

async function showNotifications(root, navigate, from) {
  root.innerHTML = `${subpageHeader('Уведомления', 'Вы сами выбираете, какие сообщения получать от HOUSE CLEANING.')}
    <div class="u7-settings-list" data-notification-settings><div class="card cc-order-empty">Загружаем настройки...</div></div>`;
  root.querySelector('[data-back]').onclick = () => goBack(root, navigate, from);
  const holder = root.querySelector('[data-notification-settings]');
  try {
    const data = await getJson('/api/client-notification-settings');
    const settings = data.settings || {};
    const rows = [
      ['confirmed','Подтверждение заявки','Сообщение, когда менеджер подтвердил уборку.'],
      ['reminder','Напоминание за 24 часа','Напомним о предстоящей уборке заранее.'],
      ['completed','Завершение уборки','Итоговое сообщение после завершения работ.'],
      ['review','Просьба оставить отзыв','Короткое приглашение оценить выполненную уборку.'],
      ['marketing','Новости и предложения','Информационные рассылки HOUSE CLEANING.'],
    ];
    holder.innerHTML = `${rows.map(([id,title,subtitle]) => `<label class="u7-toggle-row"><span class="u7-toggle-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span><span class="u7-switch"><input type="checkbox" data-notify="${id}" ${settings[id] !== false ? 'checked' : ''}><span></span></span></label>`).join('')}
      <div class="u7-save-row"><button class="primary-btn" type="button" data-save-notifications>Сохранить</button></div>`;
    holder.querySelector('[data-save-notifications]').onclick = async () => {
      const button = holder.querySelector('[data-save-notifications]');
      button.disabled = true;
      const payload = {};
      holder.querySelectorAll('[data-notify]').forEach((input) => { payload[input.dataset.notify] = Boolean(input.checked); });
      try {
        await postJson('/api/client-notification-settings', payload);
        showToast('Настройки уведомлений сохранены');
      } catch (error) {
        showToast(error.message || 'Не удалось сохранить настройки', true);
      } finally {
        button.disabled = false;
      }
    };
  } catch (error) {
    holder.innerHTML = `<div class="card cc-order-empty">${escapeHtml(error.message || 'Не удалось загрузить настройки')}</div>`;
  }
}

function showSubscriptions(root, navigate, from) {
  const plan = (count, accent) => `<section class="card cc-pass-card hc-pass-launch ${accent ? 'featured' : ''}"><div class="cc-pass-top"><span>Абонемент</span><strong>${count} уборок</strong></div><p>${count === 10 ? 'Максимум удобства для регулярной уборки.' : 'Оптимально для тех, кто хочет поддерживать чистоту регулярно.'}</p><ul><li>Согласованный график</li><li>Не нужно каждый раз оформлять заявку заново</li><li>Персональное сопровождение менеджера</li></ul><button class="primary-btn" type="button" data-pass-manager>Написать менеджеру</button></section>`;
  root.innerHTML = `${subpageHeader('Абонементы', 'Регулярная уборка проще, когда график согласован заранее.')}<div class="cc-pass-list">${plan(5, false)}${plan(10, true)}</div>`;
  root.querySelector('[data-back]').onclick = () => goBack(root, navigate, from);
  root.querySelectorAll('[data-pass-manager]').forEach((button) => button.onclick = openManager);
}

async function showReviews(root, navigate, from) {
  root.innerHTML = `${subpageHeader('Отзывы', 'Отзывы клиентов после завершённых уборок.')}<section class="card hc-public-review-summary" data-review-summary><strong>—</strong><span>Загружаем рейтинг...</span></section><div class="hc-public-review-filters" data-review-filters></div><div class="hc-public-review-list" data-review-list><div class="card cc-order-empty">Загружаем отзывы...</div></div>`;
  root.querySelector('[data-back]').onclick = () => goBack(root, navigate, from);
  try {
    const data = await getJson('/api/public-reviews');
    const reviews = Array.isArray(data.reviews) ? data.reviews : [];
    root.querySelector('[data-review-summary]').innerHTML = `<strong>${Number(data.average || 0).toFixed(1)}</strong><span>★ · ${Number(data.count || 0)} отзывов</span>`;
    let filter = 'all';
    let sort = 'new';
    const draw = () => {
      const filters = [['all','Все'],['5','5★'],['4','4★'],['low','3★ и ниже']];
      root.querySelector('[data-review-filters]').innerHTML = `${filters.map(([id,label]) => `<button class="${filter===id?'active':''}" data-review-filter="${id}">${label}</button>`).join('')}<button class="${sort==='new'?'active':''}" data-review-sort>Сначала новые</button>`;
      let items = [...reviews];
      if (filter === '5') items = items.filter((r) => Number(r.rating) === 5);
      if (filter === '4') items = items.filter((r) => Number(r.rating) === 4);
      if (filter === 'low') items = items.filter((r) => Number(r.rating) <= 3);
      if (sort === 'new') items.sort((a,b) => String(b.created_at||'').localeCompare(String(a.created_at||'')));
      root.querySelector('[data-review-list]').innerHTML = items.length ? items.map(publicReviewCard).join('') : '<div class="card cc-order-empty">По этому фильтру отзывов нет.</div>';
      root.querySelectorAll('[data-review-filter]').forEach((button) => button.onclick = () => { filter = button.dataset.reviewFilter; draw(); });
      root.querySelector('[data-review-sort]').onclick = () => { sort = sort === 'new' ? 'default' : 'new'; draw(); };
    };
    draw();
  } catch (error) { root.querySelector('[data-review-list]').innerHTML = `<div class="card cc-order-empty">${escapeHtml(error.message || 'Не удалось загрузить отзывы')}</div>`; }
}
function publicReviewCard(review) { return `<article class="card hc-public-review"><div><strong>${escapeHtml(review.name || 'Клиент')}</strong><span>${Number(review.rating || 0).toFixed(1)} ★</span></div><small>${review.created_at ? escapeHtml(formatDate(review.created_at)) : ''}</small>${review.text ? `<p>${escapeHtml(review.text)}</p>` : '<p class="hc-muted">Без комментария</p>'}</article>`; }

function showPrice(root, navigate, from) {
  const services = state.bootstrap?.services || [];
  const primary = services.filter((service) => service.kind === 'primary');
  const addons = services.filter((service) => service.kind === 'addon');
  const row = (service) => `<div class="card cc-price-row"><div><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || '')}</small></div><b>${service.price_per_m2 ? `от ${service.price_per_m2} ₽/м²` : service.fixed_price ? `от ${service.fixed_price} ₽` : 'После оценки'}</b></div>`;
  root.innerHTML = `${subpageHeader('Прайс', 'Ориентировочные цены. Точную стоимость подтверждает менеджер.')}<div class="cc-price-list">${primary.map(row).join('')}</div>${addons.length ? `<div class="cc-section-head"><h2>Дополнительно</h2></div><div class="cc-price-list">${addons.map(row).join('')}</div>` : ''}`;
  root.querySelector('[data-back]').onclick = () => goBack(root, navigate, from);
}

function showFaq(root, navigate, from) {
  root.innerHTML = `${subpageHeader('Частые вопросы', 'Короткие ответы о заказе и сервисе.')}<div class="cc-faq-list hc-faq-clean">${FAQ.map((item) => `<button class="cc-faq" type="button" data-faq><span class="cc-faq-q"><strong>${escapeHtml(item[0])}</strong><i>+</i></span><span class="cc-faq-a">${escapeHtml(item[1])}</span></button>`).join('')}</div><button class="hc-btn hc-btn-blue hc-manager-only-btn" type="button" data-write>✉️ Написать менеджеру</button>`;
  root.querySelector('[data-back]').onclick = () => goBack(root, navigate, from);
  root.querySelectorAll('[data-faq]').forEach((button) => button.onclick = () => { root.querySelectorAll('[data-faq].open').forEach((other) => { if (other !== button) other.classList.remove('open'); }); button.classList.toggle('open'); });
  root.querySelector('[data-write]').onclick = openManager;
}

function showContact(root, navigate, from) {
  root.innerHTML = `${subpageHeader('Связаться с менеджером', 'Напишите нам в Telegram — менеджер увидит сообщение лично.')}<div class="card hc-contact-launch"><span>💬</span><div><strong>HOUSE CLEANING</strong><p>Вопрос по заявке, адресу, услуге или абонементу.</p></div></div><button class="hc-btn hc-btn-blue hc-manager-only-btn" type="button" data-write>✉️ Написать менеджеру</button>`;
  root.querySelector('[data-back]').onclick = () => goBack(root, navigate, from);
  root.querySelector('[data-write]').onclick = openManager;
}

function showEdit(root, navigate, from) {
  const user = state.bootstrap?.user || {};
  let region = user.region === 'lo' ? 'lo' : 'spb';
  const draw = () => {
    root.innerHTML = `${subpageHeader('Мои данные', 'Сохранённые данные предложим при следующей записи.')}<div class="card cc-form-card hc-profile-form">${field('Имя', 'name', user.name || user.first_name || '')}${field('Основной телефон', 'phone', user.phone || '', 'tel')}${field('Дополнительный телефон', 'phone2', user.phone2 || '', 'tel')}<div class="field"><label>Регион</label><div class="hc-location-choice"><button type="button" class="hc-location-option ${region === 'spb' ? 'selected' : ''}" data-region="spb">Санкт-Петербург</button><button type="button" class="hc-location-option ${region === 'lo' ? 'selected' : ''}" data-region="lo">Ленинградская область</button></div></div>${region === 'lo' ? field('Город / населённый пункт', 'locality', user.locality || '') : ''}${field('Улица', 'street', user.street || '')}${field('Дом', 'house', user.house || '')}${field('Квартира / офис', 'apartment', user.apartment || '')}${field('Этаж', 'floor', user.floor || '')}${field('Парадная / подъезд', 'entrance', user.entrance || '')}</div><button class="primary-btn" type="button" data-save style="margin-top:12px">Сохранить</button>`;
    root.querySelector('[data-back]').onclick = () => goBack(root, navigate, from);
    root.querySelectorAll('[data-region]').forEach((button) => button.onclick = () => { region = button.dataset.region; draw(); });
    root.querySelector('[data-save]').onclick = async () => {
      const payload = { region };
      root.querySelectorAll('[data-profile-field]').forEach((input) => { payload[input.dataset.profileField] = input.value.trim(); });
      if (!payload.name) return showToast('Укажите имя', true);
      if (!payload.phone) return showToast('Укажите основной телефон', true);
      const hasAddress = [payload.locality, payload.street, payload.house].some(Boolean);
      if (hasAddress && ((!payload.street || !payload.house) || (region === 'lo' && !payload.locality))) return showToast('Заполните адрес полностью', true);
      const button = root.querySelector('[data-save]'); button.disabled = true;
      try { const profile = await patchProfile(payload); state.bootstrap.user = { ...(state.bootstrap?.user || {}), ...profile }; try { localStorage.setItem('hc-client-profile-v1', JSON.stringify(profile)); } catch {} showToast('Данные сохранены'); goBack(root, navigate, from); } catch (error) { button.disabled = false; showToast(error.message || 'Не удалось сохранить данные', true); }
    };
  };
  draw();
}
function field(label, name, value, type = 'text') { return `<div class="field"><label>${escapeHtml(label)}</label><input class="input" type="${type}" data-profile-field="${name}" value="${escapeHtml(value)}" data-label="${escapeHtml(label)}"></div>`; }

function showRules(root, navigate, from) {
  root.innerHTML = `${subpageHeader('Правила и условия')}<div class="card cc-form-card hc-rules"><p>Заявка считается подтверждённой после подтверждения менеджером HOUSE CLEANING.</p><p>Предварительная стоимость рассчитывается по площади и выбранным услугам. Точная сумма уточняется после проверки заявки.</p><p>Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже изменения и отмена согласовываются с менеджером.</p></div>`;
  root.querySelector('[data-back]').onclick = () => goBack(root, navigate, from);
}
