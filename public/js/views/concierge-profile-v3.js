import { state } from '../state.js';
import { escapeHtml, showToast } from '../utils.js';

const MANAGER_PHONE = '+79992107977';
const FAQ = [
  ['Как рассчитывается стоимость?', 'Предварительная стоимость рассчитывается по площади, виду уборки и дополнительным услугам. Точную сумму менеджер подтверждает после оценки объекта и фотографий.'],
  ['Зачем нужны фотографии объекта?', 'Фотографии нужны до уборки, чтобы оценить состояние помещения и объём работ.'],
  ['Можно ли изменить заявку?', 'Самостоятельное изменение заявки не предусмотрено. Для переноса даты, времени, адреса или услуг свяжитесь с менеджером.'],
  ['Можно ли отменить уборку?', 'Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже — через менеджера.'],
  ['Как можно оплатить?', 'Оплата возможна картой, по счёту или наличными.'],
  ['Как работает программа лояльности?', 'После 3 успешно завершённых уборок действует скидка 5%, после 10 — 10%.'],
  ['Как работает приглашение друзей?', 'Друг получает 15% на первую уборку по вашей ссылке. После успешного завершения его первой уборки вам начисляется 15% на следующую уборку.'],
  ['Как применить реферальную скидку?', 'Когда друг завершит уборку, в разделе «Пригласить друзей» появится доступная скидка. Выберите её для следующей заявки.'],
  ['Как оформить абонемент?', 'Абонемент на 5 или 10 уборок пока оформляется через менеджера.'],
  ['Как связаться с менеджером?', 'Можно написать напрямую в Telegram или позвонить по номеру +7 999 210-79-77.'],
];

function headers(extra = {}) { return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '', ...extra }; }
async function getJson(path) { const response = await fetch(path, { headers: headers() }); const data = await response.json().catch(() => ({})); if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`); return data; }
async function postJson(path, body) { const response = await fetch(path, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }); const data = await response.json().catch(() => ({})); if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`); return data; }
async function patchProfile(payload) { const response = await fetch('/api/client-profile', { method: 'PATCH', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) }); const data = await response.json().catch(() => ({})); if (!response.ok || data?.ok === false) throw new Error(data?.error || 'Не удалось сохранить данные'); return data.profile || payload; }

function icon(name) {
  const icons = {
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.5-4.1 3.1-6.3 7.5-6.3s7 2.2 7.5 6.3"/></svg>',
    price: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h5M8 16h8"/></svg>',
    faq: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 4.3 1.5c-.9.9-2.1 1.3-2.1 2.8M12 17h.01"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.6 8.6 0 0 1-3.1-.6L4 20l1.5-4.1A7.3 7.3 0 0 1 4 11.5 7.6 7.6 0 0 1 12 4a7.6 7.6 0 0 1 8 7.5Z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.2 8.2-8 10-4.8-1.8-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    gift: '<svg viewBox="0 0 24 24"><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13"/><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5L12 7Zm0 0h3.5A2.5 2.5 0 1 0 13 4.5L12 7Z"/></svg>',
    pass: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9h10M7 13h6"/></svg>',
  };
  return icons[name] || icons.user;
}

function menuRow(name, title, subtitle, iconName) {
  return `<button class="cc-menu-row" type="button" data-menu="${name}"><span class="cc-menu-icon">${icon(iconName)}</span><span class="cc-menu-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span><span class="cc-menu-arrow">›</span></button>`;
}
function subpageHeader(title, subtitle = '') { return `<button class="cc-back hc-fixed-back" type="button" data-back>← Назад</button><header class="cc-subpage-head hc-subpage-offset"><span class="cc-kicker">HOUSE CLEANING</span><h1>${escapeHtml(title)}</h1>${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ''}</header>`; }

async function openManager() {
  try {
    const contact = await getJson('/api/manager-contact');
    const id = Number(contact.telegram_id || 0);
    if (id) { window.location.href = `tg://user?id=${id}`; return; }
  } catch {}
  const username = String(state.bootstrap?.config?.managerUsername || '').replace(/^@/, '');
  if (!username) return showToast('Контакт менеджера пока не настроен', true);
  const url = `https://t.me/${username}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank');
}
function callManager() { window.location.href = `tel:${MANAGER_PHONE}`; }

function loyaltyCard(data = {}) {
  const completed = Number(data.completed_orders || 0);
  const discount = Number(data.loyalty_percent || 0);
  const target = completed < 3 ? 3 : 10;
  const progress = completed >= 10 ? 100 : Math.min(100, Math.round(completed / target * 100));
  const note = completed >= 10 ? 'Максимальный уровень достигнут' : `Ещё ${Math.max(0, target - completed)} до скидки ${target === 3 ? 5 : 10}%`;
  const active = Number(data.selected_percent || 0);
  const type = data.selected_type === 'referral_friend' ? 'Скидка друга' : data.selected_type === 'referral_reward' ? 'Реферальная скидка' : active ? 'Лояльность' : '';
  return `<section class="card cc-loyalty-card"><div class="cc-loyalty-top"><span class="cc-menu-icon">${icon('shield')}</span><div><small>Программа лояльности</small><strong>${discount ? `Скидка ${discount}%` : 'Ваш прогресс'}</strong></div><b>${completed}</b></div><div class="cc-loyalty-progress"><i style="width:${progress}%"></i></div><div class="cc-loyalty-bottom"><span>${escapeHtml(note)}</span><small>После 3 уборок — 5%, после 10 — 10%</small></div>${active ? `<div class="hc-profile-active-benefit"><span>К следующей заявке</span><strong>${escapeHtml(type)} · ${active}%</strong></div>` : ''}</section>`;
}

export function renderConciergeProfile(root, navigate, params = {}) {
  if (params.section === 'faq') return showFaq(root, navigate);
  if (params.section === 'referral') return showReferral(root, navigate);
  if (params.section === 'subscriptions') return showSubscriptions(root, navigate);
  if (params.section === 'data') return showEdit(root, navigate);
  if (params.section === 'price') return showPrice(root, navigate);
  if (params.section === 'contact') return showContact(root, navigate);
  if (params.section === 'rules') return showRules(root, navigate);

  const user = state.bootstrap?.user || {};
  const displayName = user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Клиент';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'H';
  const username = user.username ? `@${user.username}` : 'Telegram';
  root.innerHTML = `<div class="cc-profile-page"><header class="cc-profile-head"><div><span class="cc-kicker">HOUSE CLEANING</span><h1 class="page-title">Профиль</h1><p class="page-subtitle">Данные, скидки и настройки сервиса.</p></div></header>
    <button class="card cc-profile-card cc-profile-card-button" type="button" data-profile-data><div class="cc-avatar">${user.photo_url ? `<img src="${escapeHtml(user.photo_url)}" alt="">` : escapeHtml(initial)}</div><div class="cc-profile-copy"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(username)}</span><small>Нажмите, чтобы изменить данные</small></div><b>›</b></button>
    <div data-loyalty-slot><div class="card cc-loyalty-card"><div class="loading"><div><div class="spinner"></div>Проверяем скидки...</div></div></div></div>
    <div class="card cc-menu">${menuRow('referral', 'Пригласить друзей', '15% вам и 15% другу', 'gift')}${menuRow('subscriptions', 'Абонементы', '5 или 10 уборок', 'pass')}${menuRow('price', 'Прайс', 'Услуги и ориентировочные цены', 'price')}${menuRow('faq', 'Частые вопросы', 'Оплата, отмена и сервис', 'faq')}${menuRow('help', 'Связаться с менеджером', 'Telegram или телефон', 'chat')}${menuRow('rules', 'Правила и условия', 'Порядок работы HOUSE CLEANING', 'shield')}</div></div>`;
  root.querySelector('[data-profile-data]').onclick = () => showEdit(root, navigate);
  root.querySelector('[data-menu="referral"]').onclick = () => showReferral(root, navigate);
  root.querySelector('[data-menu="subscriptions"]').onclick = () => showSubscriptions(root, navigate);
  root.querySelector('[data-menu="price"]').onclick = () => showPrice(root, navigate);
  root.querySelector('[data-menu="faq"]').onclick = () => showFaq(root, navigate);
  root.querySelector('[data-menu="help"]').onclick = () => showContact(root, navigate);
  root.querySelector('[data-menu="rules"]').onclick = () => showRules(root, navigate);
  getJson('/api/client-benefits').then((data) => { const slot = root.querySelector('[data-loyalty-slot]'); if (slot) slot.innerHTML = loyaltyCard(data); }).catch(() => {});
}

async function showReferral(root, navigate) {
  root.innerHTML = `${subpageHeader('Пригласить друзей', 'Друг получает 15% на первую уборку, вы — 15% после её успешного завершения.')}
    <section class="card cc-referral-hero"><span class="cc-referral-badge">15% + 15%</span><h2>Приглашайте по персональной ссылке</h2><p>Отправьте ссылку. Мы автоматически отследим переход, согласие, заявку и завершённую уборку.</p></section>
    <section class="card cc-ref-v2-stats" data-ref-stats><div><strong>…</strong><span>Перешли</span></div><div><strong>…</strong><span>Оформили</span></div><div><strong>…</strong><span>Завершили</span></div><div><strong>…</strong><span>Доступно 15%</span></div></section>
    <div data-ref-reward></div>
    <div class="cc-ref-actions"><button class="primary-btn" type="button" data-share disabled>Поделиться ссылкой</button><button class="secondary-btn" type="button" data-copy disabled>Скопировать ссылку</button></div>
    <div class="hc-ref-list" data-ref-list><div class="card cc-order-empty">Загружаем приглашения...</div></div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
  let link = '';
  try {
    const [linkData, stats] = await Promise.all([getJson('/api/referral-link'), getJson('/api/referral-dashboard')]);
    link = String(linkData.link || '');
    const holder = root.querySelector('[data-ref-stats]');
    if (holder) holder.innerHTML = `<div><strong>${Number(stats.invited_count || 0)}</strong><span>Перешли</span></div><div><strong>${Number(stats.ordered_friends || 0)}</strong><span>Оформили</span></div><div><strong>${Number(stats.completed_friends || 0)}</strong><span>Завершили</span></div><div><strong>${Number(stats.available_rewards || 0)}</strong><span>Доступно 15%</span></div>`;
    drawReward(root, stats, navigate);
    const list = Array.isArray(stats.referrals) ? stats.referrals : [];
    root.querySelector('[data-ref-list]').innerHTML = list.length ? list.map(referralCard).join('') : '<div class="card cc-order-empty">Пока никто не перешёл по вашей ссылке.</div>';
    root.querySelector('[data-share]').disabled = !link;
    root.querySelector('[data-copy]').disabled = !link;
  } catch (error) {
    root.querySelector('[data-ref-list]').innerHTML = `<div class="card cc-order-empty">${escapeHtml(error.message || 'Не удалось загрузить приглашения')}</div>`;
  }
  root.querySelector('[data-share]').onclick = () => {
    if (!link) return;
    const text = ['🏠 HOUSE CLEANING', '', 'Хочу порекомендовать тебе сервис уборки.', '', 'По моей персональной ссылке ты получишь скидку 15% на первую уборку.', '', 'Оформить заявку можно прямо в Telegram 👇'].join('\n');
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl); else window.open(shareUrl, '_blank');
  };
  root.querySelector('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(link); showToast('Ссылка скопирована'); }
    catch { showToast('Не удалось скопировать ссылку', true); }
  };
}

function drawReward(root, stats, navigate) {
  const holder = root.querySelector('[data-ref-reward]');
  if (!holder) return;
  const available = Number(stats.available_rewards || 0);
  const armed = Boolean(stats.reward_armed);
  if (!available) { holder.innerHTML = '<div class="cc-policy-note"><strong>Как получить 15%:</strong> приглашённый друг должен успешно завершить свою первую уборку.</div>'; return; }
  holder.innerHTML = `<section class="card hc-ref-reward-card ${armed ? 'armed' : ''}"><span>Ваша награда</span><strong>${available} × 15%</strong><p>${armed ? 'Одна скидка выбрана для следующей уборки.' : 'Выберите скидку, когда захотите использовать её в следующей заявке.'}</p><button class="hc-btn ${armed ? 'hc-btn-ghost' : 'hc-btn-green'}" type="button" data-arm-reward>${armed ? 'Не применять сейчас' : 'Применить 15% к следующей уборке'}</button></section>`;
  holder.querySelector('[data-arm-reward]').onclick = async () => {
    const button = holder.querySelector('[data-arm-reward]'); button.disabled = true;
    try { await postJson('/api/referral-reward', { enabled: !armed }); showToast(armed ? 'Скидка снята с следующей заявки' : 'Скидка 15% выбрана'); showReferral(root, navigate); }
    catch (error) { button.disabled = false; showToast(error.message || 'Не удалось изменить скидку', true); }
  };
}

function referralCard(item) {
  const stages = [
    ['Перешёл по ссылке', true],
    ['Принял условия', Boolean(item.consent_accepted_at)],
    ['Оформил заявку', Boolean(item.order_created)],
    ['Заявка подтверждена', Boolean(item.order_confirmed)],
    ['Уборка завершена', Boolean(item.completed)],
  ];
  return `<article class="card hc-ref-client-card"><div class="hc-ref-client-head"><div><small>Приглашённый друг</small><strong>${escapeHtml(item.friend_name || `ID ${item.friend_id}`)}</strong></div><span class="hc-ref-stage stage-${escapeHtml(item.stage || 'started')}">${escapeHtml(stageLabel(item.stage))}</span></div><div class="hc-ref-steps">${stages.map(([label, done]) => `<div class="${done ? 'done' : ''}"><i>${done ? '✓' : '·'}</i><span>${escapeHtml(label)}</span></div>`).join('')}</div></article>`;
}
function stageLabel(stage) { return ({ started: 'Перешёл', accepted: 'Принял условия', ordered: 'Оформил', confirmed: 'Подтверждён', completed: 'Завершил' })[stage] || 'Перешёл'; }

function showSubscriptions(root, navigate) {
  const plan = (count) => `<section class="card cc-pass-card"><div class="cc-pass-top"><span>Абонемент</span><strong>${count} уборок</strong></div><ul><li>Не нужно каждый раз оформлять заказ заново</li><li>Удобное планирование регулярной уборки</li><li>Согласованный график</li><li>Персональное сопровождение менеджера</li></ul><button class="primary-btn" type="button" data-pass-manager>Написать менеджеру</button></section>`;
  root.innerHTML = `${subpageHeader('Абонементы', 'Регулярная уборка без лишних повторных оформлений.')}<div class="cc-pass-list">${plan(5)}${plan(10)}</div><div class="cc-policy-note">Покупка в приложении появится позже. Сейчас абонемент оформляется через менеджера.</div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
  root.querySelectorAll('[data-pass-manager]').forEach((button) => button.onclick = openManager);
}

function showPrice(root, navigate) {
  const services = state.bootstrap?.services || [];
  const primary = services.filter((service) => service.kind === 'primary');
  const addons = services.filter((service) => service.kind === 'addon');
  const row = (service) => `<div class="card cc-price-row"><div><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || '')}</small></div><b>${service.price_per_m2 ? `от ${service.price_per_m2} ₽/м²` : service.fixed_price ? `от ${service.fixed_price} ₽` : 'После оценки'}</b></div>`;
  root.innerHTML = `${subpageHeader('Прайс', 'Ориентировочные цены. Точную стоимость подтверждает менеджер.')}<div class="cc-price-list">${primary.map(row).join('')}</div>${addons.length ? `<div class="cc-section-head"><h2>Дополнительно</h2></div><div class="cc-price-list">${addons.map(row).join('')}</div>` : ''}`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
}

function showFaq(root, navigate) {
  root.innerHTML = `${subpageHeader('Частые вопросы', 'Короткие ответы без лишнего текста.')}<div class="cc-faq-list hc-faq-clean">${FAQ.map((item) => `<button class="cc-faq" type="button" data-faq><span class="cc-faq-q"><strong>${escapeHtml(item[0])}</strong><i>+</i></span><span class="cc-faq-a">${escapeHtml(item[1])}</span></button>`).join('')}</div><div class="hc-contact-pair"><button class="hc-btn hc-btn-blue" type="button" data-write>✉️ Написать менеджеру</button><button class="hc-btn hc-btn-green" type="button" data-call>📞 Позвонить</button></div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
  root.querySelectorAll('[data-faq]').forEach((button) => button.onclick = () => button.classList.toggle('open'));
  root.querySelector('[data-write]').onclick = openManager;
  root.querySelector('[data-call]').onclick = callManager;
}

function showContact(root, navigate) {
  root.innerHTML = `${subpageHeader('Связаться с менеджером', 'Выберите удобный способ связи.')}<div class="hc-contact-pair hc-contact-large"><button class="hc-btn hc-btn-blue" type="button" data-write>✉️ Написать в Telegram</button><button class="hc-btn hc-btn-green" type="button" data-call>📞 +7 999 210-79-77</button></div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
  root.querySelector('[data-write]').onclick = openManager;
  root.querySelector('[data-call]').onclick = callManager;
}

function showEdit(root, navigate) {
  const user = state.bootstrap?.user || {};
  let region = user.region === 'lo' ? 'lo' : 'spb';
  const draw = () => {
    root.innerHTML = `${subpageHeader('Мои данные', 'Сохранённые данные можно использовать при следующей записи.')}<div class="card cc-form-card hc-profile-form">
      ${field('Имя', 'name', user.name || user.first_name || '')}${field('Основной телефон', 'phone', user.phone || '', 'tel')}${field('Дополнительный телефон', 'phone2', user.phone2 || '', 'tel')}
      <div class="field"><label>Регион</label><div class="hc-location-choice"><button type="button" class="hc-location-option ${region === 'spb' ? 'selected' : ''}" data-region="spb">Санкт-Петербург</button><button type="button" class="hc-location-option ${region === 'lo' ? 'selected' : ''}" data-region="lo">Ленинградская область</button></div></div>
      ${region === 'lo' ? field('Город / населённый пункт', 'locality', user.locality || '') : ''}${field('Улица', 'street', user.street || '')}${field('Дом', 'house', user.house || '')}${field('Квартира / офис', 'apartment', user.apartment || '')}${field('Этаж', 'floor', user.floor || '')}${field('Парадная / подъезд', 'entrance', user.entrance || '')}
    </div><button class="primary-btn" type="button" data-save style="margin-top:12px">Сохранить</button>`;
    root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
    root.querySelectorAll('[data-region]').forEach((button) => button.onclick = () => { region = button.dataset.region; draw(); });
    root.querySelector('[data-save]').onclick = async () => {
      const payload = { region };
      root.querySelectorAll('[data-profile-field]').forEach((input) => { payload[input.dataset.profileField] = input.value.trim(); });
      if (!payload.name) return showToast('Укажите имя', true);
      if (!payload.phone) return showToast('Укажите основной телефон', true);
      const hasAddress = [payload.locality, payload.street, payload.house].some(Boolean);
      if (hasAddress && ((!payload.street || !payload.house) || (region === 'lo' && !payload.locality))) return showToast('Заполните адрес полностью', true);
      const button = root.querySelector('[data-save]'); button.disabled = true;
      try {
        const profile = await patchProfile(payload);
        state.bootstrap.user = { ...(state.bootstrap?.user || {}), ...profile };
        try { localStorage.setItem('hc-client-profile-v1', JSON.stringify(profile)); } catch {}
        showToast('Данные сохранены');
        renderConciergeProfile(root, navigate);
      } catch (error) { button.disabled = false; showToast(error.message || 'Не удалось сохранить данные', true); }
    };
  };
  draw();
}

function field(label, name, value, type = 'text') { return `<div class="field"><label>${escapeHtml(label)}</label><input class="input" type="${type}" data-profile-field="${name}" value="${escapeHtml(value)}" data-label="${escapeHtml(label)}"></div>`; }

function showRules(root, navigate) {
  root.innerHTML = `${subpageHeader('Правила и условия')}<div class="card cc-form-card hc-rules"><p>Заявка считается подтверждённой после подтверждения менеджером HOUSE CLEANING.</p><p>Предварительная стоимость рассчитывается по площади и выбранным услугам. Точная сумма уточняется после оценки объекта.</p><p>Самостоятельная отмена доступна не позднее чем за 24 часа до начала уборки. Позже изменения и отмена согласовываются с менеджером.</p></div>`;
  root.querySelector('[data-back]').onclick = () => renderConciergeProfile(root, navigate);
}
