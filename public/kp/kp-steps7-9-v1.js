(() => {
  const EQUIPMENT_OPTIONS = [
    'Моющий пылесос Karcher WD 3',
    'Пылесос для сухой уборки Karcher WD 6',
    'Пароочиститель Karcher SC 4',
  ];

  let equipmentTextarea = null;
  let equipmentRoot = null;
  let customEquipmentInput = null;
  let nav = null;
  let originalShowToast = null;
  let lifecycleWrapped = false;

  function normalizeLines(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[•\-–—]\s*/, '').trim())
      .filter(Boolean);
  }

  function selectedEquipmentText() {
    if (!equipmentRoot) return String(equipmentTextarea?.value || '').trim();
    const lines = [...equipmentRoot.querySelectorAll('input[type="checkbox"]:checked')]
      .map((input) => input.value)
      .filter(Boolean);
    const custom = String(customEquipmentInput?.value || '').trim();
    if (custom) lines.push(...normalizeLines(custom));
    return [...new Set(lines)].join('\n');
  }

  function syncEquipmentTextarea() {
    if (!equipmentTextarea) return;
    const next = selectedEquipmentText();
    if (equipmentTextarea.value !== next) equipmentTextarea.value = next;
    equipmentTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    state.lastSaved = null;
  }

  function fillEquipmentSelector(value, defaultAll = false) {
    if (!equipmentRoot) return;
    const lines = normalizeLines(value);
    const known = new Set(EQUIPMENT_OPTIONS);
    const knownSelected = new Set(lines.filter((line) => known.has(line)));
    const customLines = lines.filter((line) => !known.has(line));

    equipmentRoot.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = defaultAll ? true : knownSelected.has(input.value);
    });
    if (customEquipmentInput) customEquipmentInput.value = customLines.join('\n');
    syncEquipmentTextarea();
  }

  function installEquipmentSelector() {
    equipmentTextarea = document.getElementById('equipment');
    if (!equipmentTextarea) return false;
    if (document.getElementById('kpEquipmentChooser')) {
      equipmentRoot = document.getElementById('kpEquipmentChooser');
      customEquipmentInput = document.getElementById('kpCustomEquipment');
      return true;
    }

    const originalCard = equipmentTextarea.closest('.commercial-equipment-card') || equipmentTextarea.parentElement;
    if (!originalCard) return false;

    equipmentTextarea.hidden = true;
    equipmentTextarea.setAttribute('aria-hidden', 'true');
    const label = equipmentTextarea.closest('label');
    if (label) label.style.display = 'none';
    const hint = originalCard.querySelector('.commercial-field-hint');
    if (hint) hint.style.display = 'none';

    equipmentRoot = document.createElement('div');
    equipmentRoot.id = 'kpEquipmentChooser';
    equipmentRoot.className = 'kp-equipment-chooser';
    equipmentRoot.innerHTML = `
      <div class="kp-equipment-title">Используемое оборудование</div>
      <div class="kp-equipment-hint">Отметьте оборудование, которое будет использоваться на объекте.</div>
      <div class="kp-equipment-options">
        ${EQUIPMENT_OPTIONS.map((item, index) => `
          <label class="kp-equipment-option" for="kpEquipment${index}">
            <input id="kpEquipment${index}" type="checkbox" value="${item}">
            <span>${item}</span>
          </label>`).join('')}
      </div>
      <label class="kp-equipment-custom">
        <span>Дополнительное оборудование — необязательно</span>
        <textarea id="kpCustomEquipment" rows="2" enterkeyhint="done" placeholder="Например: роторная машина, стремянка"></textarea>
      </label>`;

    originalCard.appendChild(equipmentRoot);
    customEquipmentInput = equipmentRoot.querySelector('#kpCustomEquipment');
    equipmentRoot.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', syncEquipmentTextarea);
    });
    customEquipmentInput.addEventListener('input', syncEquipmentTextarea);

    const existing = String(equipmentTextarea.value || '').trim();
    fillEquipmentSelector(existing, !existing);
    return true;
  }

  function reapplyEquipmentFromTextarea(defaultAll = false) {
    if (!equipmentRoot || !equipmentTextarea) return;
    fillEquipmentSelector(equipmentTextarea.value, defaultAll);
  }

  function clearErrorState() {
    document.querySelectorAll('.kp-field-error').forEach((node) => node.classList.remove('kp-field-error'));
  }

  function errorTarget(message) {
    const text = String(message || '').toLowerCase();
    if (/выберите услугу/.test(text)) return document.getElementById('v5Service') || document.getElementById('quickServiceCard');
    if (/количеств|площад/.test(text)) return document.getElementById('v5Qty') || document.getElementById('area') || document.getElementById('items');
    if (/укажите цену|цена/.test(text)) return document.getElementById('v5Price') || document.getElementById('items');
    if (/добавьте хотя бы одну услугу|услуг/.test(text)) return document.getElementById('quickServiceCard') || document.getElementById('items');
    if (/исх|номер|уже используется/.test(text)) return document.getElementById('outgoingNumber');
    if (/дат/.test(text)) return document.getElementById('issueDate');
    if (/срок/.test(text)) return document.getElementById('validDays');
    if (/итог|стоимост/.test(text)) return document.querySelector('.totals-card');
    return document.querySelector('.editor-panel');
  }

  function showFormError(message) {
    clearErrorState();
    const banner = document.getElementById('kpErrorBanner');
    const messageEl = document.getElementById('kpErrorMessage');
    if (messageEl) messageEl.textContent = String(message || 'Проверьте заполнение данных КП.');
    banner?.classList.remove('hidden');

    const target = errorTarget(message);
    const mark = target?.closest('label, .service-builder-v5, #quickServiceCard, .totals-card, .item') || target;
    mark?.classList.add('kp-field-error');

    setTimeout(() => {
      try { target?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        setTimeout(() => {
          try { target.focus({ preventScroll: true }); } catch {}
        }, 350);
      }
    }, 30);
  }

  function installErrorBanner() {
    if (document.getElementById('kpErrorBanner')) return;
    const editor = document.querySelector('.editor-panel');
    if (!editor) return;

    const banner = document.createElement('div');
    banner.id = 'kpErrorBanner';
    banner.className = 'kp-error-banner hidden';
    banner.setAttribute('role', 'alert');
    banner.innerHTML = `
      <div>
        <strong>Проверьте данные КП</strong>
        <span id="kpErrorMessage">Заполните обязательные данные.</span>
      </div>
      <button type="button" id="kpErrorClose" aria-label="Закрыть">×</button>`;
    editor.insertBefore(banner, editor.firstChild);
    banner.querySelector('#kpErrorClose')?.addEventListener('click', () => {
      banner.classList.add('hidden');
      clearErrorState();
    });

    if (!originalShowToast) {
      originalShowToast = showToast;
      showToast = function showToastWithVisibleError(message, error = false) {
        originalShowToast(message, error);
        if (error) showFormError(message);
      };
    }

    document.addEventListener('input', (event) => {
      const marked = event.target?.closest?.('.kp-field-error');
      if (marked) marked.classList.remove('kp-field-error');
    }, true);
    document.addEventListener('change', (event) => {
      const marked = event.target?.closest?.('.kp-field-error');
      if (marked) marked.classList.remove('kp-field-error');
    }, true);
  }

  function setNavActive(name) {
    if (!nav) return;
    nav.querySelectorAll('[data-nav]').forEach((button) => {
      const active = button.dataset.nav === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function hideOldResetButton() {
    const zone = document.querySelector('.kp-first5-reset-zone');
    if (zone) zone.classList.add('kp-reset-moved-to-nav');
  }

  function installBottomNav() {
    if (document.getElementById('kpBottomNav')) {
      nav = document.getElementById('kpBottomNav');
      return;
    }

    nav = document.createElement('nav');
    nav.id = 'kpBottomNav';
    nav.className = 'kp-bottom-nav';
    nav.setAttribute('aria-label', 'Навигация КП');
    nav.innerHTML = `
      <button type="button" data-nav="new"><span>＋</span><small>Новое КП</small></button>
      <button type="button" data-nav="history"><span>≡</span><small>История</small></button>
      <button type="button" data-nav="preview"><span>▣</span><small>Просмотр</small></button>
      <button type="button" data-nav="reset" class="danger"><span>↺</span><small>Сброс</small></button>`;
    document.body.appendChild(nav);
    document.body.classList.add('kp-has-bottom-nav');
    setNavActive('new');

    nav.querySelector('[data-nav="new"]')?.addEventListener('click', () => {
      setNavActive('new');
      document.getElementById('newQuoteBtn')?.click();
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
    });
    nav.querySelector('[data-nav="history"]')?.addEventListener('click', () => {
      setNavActive('history');
      document.querySelector('.history-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    nav.querySelector('[data-nav="preview"]')?.addEventListener('click', () => {
      setNavActive('preview');
      document.getElementById('previewBtn')?.click();
    });
    nav.querySelector('[data-nav="reset"]')?.addEventListener('click', () => {
      setNavActive('reset');
      document.getElementById('kpFirst5ResetButton')?.click();
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => setNavActive('new'));
    });

    document.addEventListener('focusin', (event) => {
      if (event.target?.matches?.('input, textarea, select')) {
        document.body.classList.add('kp-keyboard-open');
      }
    }, true);
    document.addEventListener('focusout', (event) => {
      if (!event.target?.matches?.('input, textarea, select')) return;
      setTimeout(() => {
        if (!document.activeElement?.matches?.('input, textarea, select')) {
          document.body.classList.remove('kp-keyboard-open');
        }
      }, 80);
    }, true);
  }

  function wrapEquipmentLifecycle() {
    if (lifecycleWrapped) return;
    lifecycleWrapped = true;

    const oldReset = resetForm;
    resetForm = async function resetFormWithEquipmentChecks() {
      const result = await oldReset();
      setTimeout(() => {
        installEquipmentSelector();
        reapplyEquipmentFromTextarea(true);
        hideOldResetButton();
        setNavActive('new');
      }, 0);
      return result;
    };

    const oldFill = fillForm;
    fillForm = function fillFormWithEquipmentChecks(quote, options = {}) {
      const result = oldFill(quote, options);
      setTimeout(() => {
        installEquipmentSelector();
        reapplyEquipmentFromTextarea(false);
        setNavActive('new');
      }, 0);
      return result;
    };
  }

  async function install() {
    installErrorBanner();
    installBottomNav();
    wrapEquipmentLifecycle();

    for (let i = 0; i < 100 && !document.getElementById('equipment'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    installEquipmentSelector();
    hideOldResetButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once: true });
  } else {
    install().catch(console.error);
  }
})();