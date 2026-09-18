import { state } from './state.js';
import { showToast } from './utils.js';

const params = new URLSearchParams(window.location.search);
const CLIENT_MODE = params.get('admin') !== '1' && params.get('staff') !== '1';
const LEFT_AT_KEY = 'hc-booking-left-at-v53';
const ORDER_ORIGIN_KEY = 'hc-order-origin-v53';
const SCROLL_RESTORE_KEY = 'hc-route-scroll-v53';
const RESUME_AFTER_MS = 10_000;

let resumeTimer = 0;
let observer = null;
const nativeFetch = window.fetch.bind(window);
const nativeScrollIntoView = Element.prototype.scrollIntoView;

function authHeaders(extra = {}) {
  return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '', ...extra };
}

function activeDraft(draft = state.draft) {
  return Boolean(Number(draft?.step || 0) > 0);
}

function cloneDraft(draft) {
  try { return JSON.parse(JSON.stringify(draft || {})); }
  catch { return { ...(draft || {}) }; }
}

function savedResumeDraft() {
  if (window.__HC_RESUME_DRAFT_V53 && activeDraft(window.__HC_RESUME_DRAFT_V53)) return window.__HC_RESUME_DRAFT_V53;
  return activeDraft(state.draft) ? state.draft : null;
}

function clearResumeMarker() {
  try { localStorage.removeItem(LEFT_AT_KEY); } catch {}
  window.__HC_FORCE_HOME_V53 = false;
  window.__HC_RESUME_DRAFT_V53 = null;
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = 0;
}

function flushDraftNow(draft) {
  if (!window.Telegram?.WebApp?.initData || !draft || !activeDraft(draft)) return;
  nativeFetch('/api/client-draft', {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ draft }),
    keepalive: true,
  }).catch(() => {});
}

function markBookingExit() {
  if (!CLIENT_MODE || state.route !== 'booking' || !activeDraft(state.draft)) return;
  const now = Date.now();
  try { localStorage.setItem(LEFT_AT_KEY, String(now)); } catch {}
  flushDraftNow(state.draft);
  scheduleResumeCard(now);
}

function elapsedSinceExit() {
  let value = 0;
  try { value = Number(localStorage.getItem(LEFT_AT_KEY) || 0); } catch {}
  return value > 0 ? Date.now() - value : 0;
}

function shouldOfferResume() {
  const draft = savedResumeDraft();
  if (!draft) return false;
  if (window.__HC_FORCE_HOME_V53) return true;
  const elapsed = elapsedSinceExit();
  return elapsed >= RESUME_AFTER_MS;
}

function stepLabel(draft) {
  const step = Number(draft?.step || 0);
  if (step === 1) return 'выбор уборки';
  if (step === 2) return 'данные об объекте';
  if (step === 3) return 'дополнительные услуги';
  if (step === 4) return 'адрес';
  if (step === 5) return draft?.visitTypeConfirmed && draft?.visitType === 'first' ? 'фотографии объекта' : 'первый или повторный заказ';
  if (step === 6) return 'дата и время';
  if (step === 7) return 'контакты';
  if (step === 8) return 'проверка заявки';
  return 'оформление заказа';
}

function scheduleResumeCard(leftAt = 0) {
  if (resumeTimer) clearTimeout(resumeTimer);
  let stamp = Number(leftAt || 0);
  if (!stamp) {
    try { stamp = Number(localStorage.getItem(LEFT_AT_KEY) || 0); } catch {}
  }
  if (!stamp) return;
  const delay = Math.max(0, RESUME_AFTER_MS - (Date.now() - stamp)) + 80;
  resumeTimer = window.setTimeout(() => {
    resumeTimer = 0;
    decorateHomeResume();
  }, delay);
}

function decorateHomeResume() {
  if (!CLIENT_MODE) return;
  const home = document.querySelector('.cc-home');
  if (!home) return;
  const existing = home.querySelector('[data-resume-booking-v53]');
  if (!shouldOfferResume()) {
    existing?.remove();
    scheduleResumeCard();
    return;
  }

  const draft = savedResumeDraft();
  if (!draft) return;
  if (existing) {
    const text = existing.querySelector('[data-resume-step]');
    if (text) text.textContent = `Вы остановились на этапе: ${stepLabel(draft)}.`;
    return;
  }

  const card = document.createElement('section');
  card.className = 'card hc-resume-card-v53';
  card.dataset.resumeBookingV53 = '1';
  card.innerHTML = `
    <div class="hc-resume-icon-v53" aria-hidden="true">↗</div>
    <div class="hc-resume-copy-v53">
      <span>НЕЗАВЕРШЁННЫЙ ЗАКАЗ</span>
      <strong>Продолжить оформление</strong>
      <p data-resume-step>Вы остановились на этапе: ${stepLabel(draft)}.</p>
    </div>
    <button class="hc-resume-main-v53" type="button" data-resume-order-v53>Продолжить</button>
    <button class="hc-resume-new-v53" type="button" data-new-order-v53>Начать заново</button>`;

  const header = home.querySelector('.cc-greeting-row');
  if (header) header.insertAdjacentElement('afterend', card);
  else home.prepend(card);

  card.querySelector('[data-resume-order-v53]').onclick = () => {
    const resume = cloneDraft(savedResumeDraft());
    if (!activeDraft(resume)) return;
    state.draft = resume;
    state.saveDraft();
    clearResumeMarker();
    location.reload();
  };

  card.querySelector('[data-new-order-v53]').onclick = async () => {
    const button = card.querySelector('[data-new-order-v53]');
    if (button) button.disabled = true;
    await state.resetDraft();
    clearResumeMarker();
    state.draft.step = 1;
    state.saveDraft();
    location.reload();
  };
}

async function openManager() {
  try {
    const response = await nativeFetch('/api/manager-contact', { headers: authHeaders(), cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      const id = Number(data?.telegram_id || 0);
      if (id) {
        window.location.href = `tg://user?id=${id}`;
        return;
      }
    }
  } catch {}

  const username = String(state.bootstrap?.config?.managerUsername || state.bootstrap?.config?.botUsername || '').replace(/^@/, '');
  if (!username) return showToast('Контакт менеджера пока не настроен', true);
  const url = `https://t.me/${username}`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

function decorateAreaLimit() {
  if (!CLIENT_MODE) return;
  const input = document.querySelector('[data-area-input]');
  const panel = input?.closest('.area-panel');
  if (!input || !panel) return;

  const next = document.querySelector('.wizard-actions [data-next]');
  const area = Number(input.value || state.draft?.area || 0);
  const over = Number.isFinite(area) && area > 300;
  const baseWarning = panel.querySelector('.info-note.warning:not(.hc-area-manager-v53)');
  if (baseWarning) baseWarning.hidden = true;

  let block = panel.querySelector('.hc-area-manager-v53');
  if (!over) {
    block?.remove();
    if (next) next.disabled = false;
  } else {
    if (!block) {
      block = document.createElement('div');
      block.className = 'info-note warning hc-area-manager-v53';
      block.innerHTML = `<strong>Объект больше 300 м²</strong><span>Онлайн-запись доступна до 300 м². Для большей площади согласуем дату, команду и стоимость отдельно.</span><button type="button" data-area-manager-v53>Написать менеджеру</button>`;
      (panel.querySelector('.area-actions') || panel.lastElementChild || panel).insertAdjacentElement('afterend', block);
      block.querySelector('[data-area-manager-v53]').onclick = openManager;
    }
    if (next) next.disabled = true;
  }

  if (input.dataset.hcLimitV53 !== '1') {
    input.dataset.hcLimitV53 = '1';
    input.addEventListener('input', () => requestAnimationFrame(decorateAreaLimit));
    input.addEventListener('change', () => requestAnimationFrame(decorateAreaLimit));
  }
}

function navButton(route) {
  return document.querySelector(`#bottom-nav [data-route="${route}"]`);
}

function saveOrigin(route) {
  try { sessionStorage.setItem(ORDER_ORIGIN_KEY, JSON.stringify({ route, scrollY: Math.max(0, window.scrollY || 0) })); } catch {}
}

function readOrigin() {
  try { return JSON.parse(sessionStorage.getItem(ORDER_ORIGIN_KEY) || 'null'); }
  catch { return null; }
}

function queueScrollRestore(route, y) {
  try { sessionStorage.setItem(SCROLL_RESTORE_KEY, JSON.stringify({ route, y: Math.max(0, Number(y || 0)) })); } catch {}
}

function restoreRouteScroll() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SCROLL_RESTORE_KEY) || 'null'); } catch {}
  if (!saved?.route) return;
  const ready = saved.route === 'orders' ? document.querySelector('.cc-order-list') : document.querySelector('.cc-home');
  if (!ready) return;
  try { sessionStorage.removeItem(SCROLL_RESTORE_KEY); } catch {}
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: Number(saved.y || 0), left: 0, behavior: 'instant' })));
}

function decorateSuccess() {
  const success = document.querySelector('.success-v2');
  if (!success || success.dataset.hcSuccessV53 === '1') return;
  success.dataset.hcSuccessV53 = '1';
  clearResumeMarker();

  const subtitle = success.querySelector('.page-subtitle');
  if (subtitle) subtitle.textContent = 'Заявка сохранена. Все детали и статус всегда доступны в разделе «Мои заявки».';

  const open = success.querySelector('[data-open]');
  const home = success.querySelector('[data-home]');
  if (open) {
    open.textContent = 'Посмотреть мои заявки';
    open.onclick = () => navButton('orders')?.click();
  }
  if (home) {
    home.textContent = 'Вернуться на главную';
    home.onclick = () => navButton('home')?.click();
  }
}

function patchSilentClientMessages() {
  if (!CLIENT_MODE || window.__HC_SILENT_FETCH_V53) return;
  window.__HC_SILENT_FETCH_V53 = true;
  window.fetch = (input, init = {}) => {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.origin);
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.origin === location.origin && url.pathname === '/api/demo-order' && method === 'POST') {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        headers.set('X-HC-Silent-Client', '1');
        return nativeFetch(input, { ...init, headers });
      }
    } catch {}
    return nativeFetch(input, init);
  };
}

function patchCalendarAutoScroll() {
  if (!CLIENT_MODE || window.__HC_CALENDAR_SCROLL_V53) return;
  window.__HC_CALENDAR_SCROLL_V53 = true;
  Element.prototype.scrollIntoView = function (...args) {
    try {
      if (this?.matches?.('.calendar-day.selected') && this?.closest?.('[data-calendar]')) return;
    } catch {}
    return nativeScrollIntoView.apply(this, args);
  };
}

function patchRemoteDraftHydration() {
  if (!CLIENT_MODE || state.__hcHydrateV53) return;
  state.__hcHydrateV53 = true;
  const original = state.hydrateRemoteDraft.bind(state);
  state.hydrateRemoteDraft = async function () {
    await original();
    const leftAt = (() => { try { return Number(localStorage.getItem(LEFT_AT_KEY) || 0); } catch { return 0; } })();
    if (!activeDraft(this.draft) || !leftAt) return;
    const elapsed = Date.now() - leftAt;
    if (elapsed > RESUME_AFTER_MS) {
      window.__HC_RESUME_DRAFT_V53 = cloneDraft(this.draft);
      window.__HC_FORCE_HOME_V53 = true;
      this.draft = { ...this.draft, step: 0 };
    } else {
      scheduleResumeCard(leftAt);
    }
  };
}

function decorate() {
  decorateHomeResume();
  decorateAreaLimit();
  decorateSuccess();
  restoreRouteScroll();
}

function installInteractionGuards() {
  document.addEventListener('pointerdown', (event) => {
    if (!CLIENT_MODE) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const nav = target.closest('#bottom-nav [data-route]');
    if (nav && state.route === 'booking' && activeDraft(state.draft)) markBookingExit();

    if (target.closest('.cc-order-list [data-order-id]')) saveOrigin('orders');
    if (target.closest('.cc-home [data-nearest-order]')) saveOrigin('home');
    const context = target.closest('.cc-home [data-context-action]');
    if (context && /открыть заявку/i.test(context.textContent || '')) saveOrigin('home');
  }, true);

  document.addEventListener('click', (event) => {
    if (!CLIENT_MODE) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const next = target.closest('.wizard-actions [data-next]');
    const areaInput = document.querySelector('[data-area-input]');
    if (next && areaInput && Number(areaInput.value || 0) > 300) {
      event.preventDefault();
      event.stopImmediatePropagation();
      decorateAreaLimit();
      showToast('Для площади больше 300 м² напишите менеджеру', true);
      return;
    }

    const detailBack = target.closest('.cc-detail-head') ? null : target.closest('[data-back]');
    if (detailBack && document.querySelector('.cc-detail-head')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (window.HCNavigation?.back) {
        window.HCNavigation.back('orders');
        return;
      }
      const origin = readOrigin() || { route: 'orders', scrollY: 0 };
      const route = origin.route === 'home' ? 'home' : 'orders';
      queueScrollRestore(route, origin.scrollY);
      navButton(route)?.click();
    }
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markBookingExit();
  });
  window.addEventListener('pagehide', markBookingExit);
}

if (CLIENT_MODE) {
  patchSilentClientMessages();
  patchCalendarAutoScroll();
  patchRemoteDraftHydration();
  installInteractionGuards();
  observer = new MutationObserver(() => requestAnimationFrame(decorate));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', decorate, { once: true });
  requestAnimationFrame(decorate);
}
