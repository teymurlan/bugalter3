import { state } from './state.js';
import { showToast } from './utils.js';

const root = document.querySelector('#app');
let choice = '';
let queued = false;

function profileSummary(user) {
  const address = [user.locality, user.street, user.house, user.apartment ? `кв./офис ${user.apartment}` : ''].filter(Boolean).join(', ');
  return [user.name || user.first_name, user.phone, address].filter(Boolean);
}

function hasSavedProfile(user) {
  return Boolean(user && (user.phone || user.street || user.house || user.phone2));
}

function applyProfile(user) {
  const draft = state.draft;
  if (user.name || user.first_name) draft.customerName = user.name || user.first_name;
  if (user.phone) draft.phone = user.phone;
  if (user.region === 'lo' || user.region === 'spb') draft.serviceArea = user.region;
  if (user.region === 'lo') {
    draft.city = 'Ленинградская область';
    draft.address = [user.locality, user.street, user.house].filter(Boolean).join(', ');
  } else if (user.street || user.house) {
    draft.city = 'Санкт-Петербург';
    draft.address = [user.street, user.house].filter(Boolean).join(', ');
  }
  if (user.apartment) draft.apartment = user.apartment;
  if (user.floor) draft.floor = user.floor;
  if (user.entrance) draft.entrance = user.entrance;
  state.saveDraft();
}

function enhance() {
  if (!root || choice) return;
  const serviceGrid = root.querySelector('.service-grid-v2');
  if (!serviceGrid || root.querySelector('[data-profile-prefill]')) return;
  const user = state.bootstrap?.user || {};
  if (!hasSavedProfile(user)) return;
  const summary = profileSummary(user);
  if (!summary.length) return;

  const card = document.createElement('section');
  card.className = 'card hc-profile-prefill';
  card.dataset.profilePrefill = '1';
  card.innerHTML = `<div><small>Сохранённые данные</small><strong>Использовать данные из профиля?</strong><p>${summary.map(escapeHtml).join('<br>')}</p></div><div><button class="hc-btn hc-btn-blue" type="button" data-use-profile>Использовать</button><button class="hc-btn hc-btn-ghost" type="button" data-skip-profile>Другие данные</button></div>`;
  serviceGrid.insertAdjacentElement('beforebegin', card);
  card.querySelector('[data-use-profile]').onclick = () => {
    choice = 'use';
    applyProfile(user);
    card.remove();
    showToast('Данные из профиля подставлены');
  };
  card.querySelector('[data-skip-profile]').onclick = () => {
    choice = 'skip';
    card.remove();
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char] || char));
}

if (root) {
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; enhance(); });
  }).observe(root, { childList: true, subtree: false });
  enhance();
}
