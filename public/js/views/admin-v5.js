import { renderAdmin as renderBaseAdmin } from './admin-v4.js?v=34';
import { api } from '../api.js';
import { escapeHtml, formatDate, formatTime, showToast } from '../utils.js';

function headers(extra = {}) { return { 'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '', ...extra }; }
async function getJson(path) { const response = await fetch(path, { headers: headers() }); const data = await response.json().catch(() => ({})); if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`); return data; }
async function postJson(path, body = {}) { const response = await fetch(path, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }); const data = await response.json().catch(() => ({})); if (!response.ok || data?.ok === false) throw new Error(data?.error || `Ошибка ${response.status}`); return data; }

function removePhoneActions(root) {
  root.querySelectorAll('[data-call]').forEach((button) => button.remove());
  root.querySelectorAll('.ops-client-stats .ops-stat').forEach((card) => {
    if (String(card.querySelector('span')?.textContent || '').trim() === 'Скидка') card.remove();
  });
}

function decorateOverview(root, navigate) {
  const title = String(root.querySelector('.ops-header h1')?.textContent || '').trim();
  if (title !== 'Обзор' || root.querySelector('[data-launch-tools]')) return;
  const anchor = root.querySelector('.ops-stats');
  if (!anchor) return;
  const section = document.createElement('section');
  section.className = 'card hc-admin-launch-tools';
  section.dataset.launchTools = '1';
  section.innerHTML = `<div class="hc-admin-launch-head"><div><span>Версия 1.0</span><strong>Проверка перед запуском</strong></div><button class="hc-btn hc-btn-blue" type="button" data-system-health>Состояние системы</button></div><div class="hc-admin-health" data-health-result><span>Worker</span><b>Готов к проверке</b></div><div class="hc-admin-test-actions"><button class="hc-btn hc-btn-gold" type="button" data-create-test>＋ Тестовая заявка</button><button class="hc-btn hc-btn-blue" type="button" data-show-tests>Тестовые заявки</button></div><div data-test-list></div>`;
  anchor.insertAdjacentElement('afterend', section);

  section.querySelector('[data-system-health]').onclick = async () => {
    const holder = section.querySelector('[data-health-result]');
    holder.innerHTML = '<span>Проверяем...</span>';
    try {
      const data = await getJson('/api/admin-system-health');
      holder.innerHTML = `<div><span>Worker</span><b class="ok">OK · ${escapeHtml(data.worker || '')}</b></div><div><span>Durable Objects</span><b class="${data.durable_objects ? 'ok' : 'bad'}">${data.durable_objects ? 'OK' : 'Нет'}</b></div><div><span>D1</span><b class="${data.d1_ready ? 'ok' : 'warn'}">${data.d1_ready ? `Подключён · ${escapeHtml(data.d1_binding || '')}` : data.d1_connected ? 'Binding есть, база не готова' : 'Binding не найден'}</b></div><div><span>Фото</span><b>Telegram file_id</b></div>`;
    } catch (error) { holder.innerHTML = `<span class="bad">${escapeHtml(error.message || 'Не удалось проверить')}</span>`; }
  };

  section.querySelector('[data-create-test]').onclick = async () => {
    const button = section.querySelector('[data-create-test]');
    button.disabled = true;
    try {
      const data = await postJson('/api/admin-create-test-order');
      showToast(`Создана ${data.order?.order_number || 'тестовая заявка'}`);
      await showTests(section);
    } catch (error) { showToast(error.message || 'Не удалось создать тестовую заявку', true); }
    finally { button.disabled = false; }
  };
  section.querySelector('[data-show-tests]').onclick = () => showTests(section);
}

async function showTests(section) {
  const holder = section.querySelector('[data-test-list]');
  holder.innerHTML = '<div class="hc-admin-test-loading">Загружаем...</div>';
  try {
    const data = await getJson('/api/demo-admin-orders?include_test=1');
    const tests = (Array.isArray(data.orders) ? data.orders : []).filter((order) => order?.is_test && !order?.prelaunch_test).slice(0, 10);
    holder.innerHTML = tests.length ? `<div class="hc-admin-test-list">${tests.map(testCard).join('')}</div>` : '<div class="hc-admin-test-empty">Тестовых заявок пока нет.</div>';
    holder.querySelectorAll('[data-test-status]').forEach((button) => button.onclick = async () => {
      const number = button.dataset.testOrder;
      const order = tests.find((item) => String(item.order_number) === number);
      if (!order) return;
      button.disabled = true;
      try { await api.adminSetStatus(order, button.dataset.testStatus); showToast('Статус тестовой заявки обновлён'); await showTests(section); }
      catch (error) { button.disabled = false; showToast(error.message || 'Не удалось изменить статус', true); }
    });
  } catch (error) { holder.innerHTML = `<div class="hc-admin-test-empty">${escapeHtml(error.message || 'Не удалось загрузить')}</div>`; }
}

function testCard(order) {
  return `<article class="hc-admin-test-card"><div><span>ТЕСТ</span><strong>${escapeHtml(order.order_number || '')}</strong></div><p>${escapeHtml(order.service_name || 'Тестовая уборка')} · ${escapeHtml(formatDate(order.date))} ${escapeHtml(formatTime(order.time))}</p><div><button class="hc-btn hc-btn-green" data-test-status="CONFIRMED" data-test-order="${escapeHtml(order.order_number)}">Подтвердить</button><button class="hc-btn hc-btn-gold" data-test-status="IN_PROGRESS" data-test-order="${escapeHtml(order.order_number)}">Начать</button><button class="hc-btn hc-btn-green" data-test-status="COMPLETED" data-test-order="${escapeHtml(order.order_number)}">Завершить</button></div></article>`;
}

function decorate(root, navigate) {
  removePhoneActions(root);
  decorateOverview(root, navigate);
}

export async function renderAdmin(root, navigate) {
  await renderBaseAdmin(root, navigate);
  decorate(root, navigate);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(root, navigate); });
  });
  observer.observe(root, { childList: true, subtree: true });
}
