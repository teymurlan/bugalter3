(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let sheet = null;
  let pickerButton = null;

  function restorePageInteraction() {
    const root = document.documentElement;
    root.style.removeProperty('height');
    root.style.removeProperty('overflow');
    root.style.overflowY = 'auto';
    document.body.style.removeProperty('height');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('position');
    document.body.style.overflowY = 'auto';
    document.body.style.pointerEvents = 'auto';

    const active = document.activeElement;
    if (active?.id === 'v5Service') {
      try { active.blur(); } catch {}
    }

    const typing = document.activeElement?.matches?.('input, textarea, [contenteditable="true"]');
    if (!typing) {
      document.body.classList.remove('keyboard-open');
      document.getElementById('keyboardDoneBar')?.classList.add('hidden');
      document.getElementById('hcBottomNav')?.classList.remove('keyboard-hidden');
    }
  }

  function optionLabel(option) {
    return String(option?.textContent || '').trim();
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.classList.add('hidden');
    document.documentElement.style.overflowY = 'auto';
    document.body.style.overflowY = 'auto';
    setTimeout(restorePageInteraction, 0);
  }

  function openSheet(select) {
    restorePageInteraction();
    if (!sheet) buildSheet(select);
    const list = sheet.querySelector('.hc-service-sheet-list');
    list.innerHTML = '';

    [...select.children].forEach((child) => {
      if (child.tagName === 'OPTGROUP') {
        const group = document.createElement('div');
        group.className = 'hc-service-sheet-group';
        group.textContent = child.label || 'Услуги';
        list.appendChild(group);
        [...child.querySelectorAll('option')].forEach((option) => appendOption(select, list, option));
      } else if (child.tagName === 'OPTION' && child.value !== '') {
        appendOption(select, list, child);
      }
    });

    sheet.classList.remove('hidden');
    document.body.style.overflowY = 'hidden';
  }

  function appendOption(select, list, option) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hc-service-option';
    button.textContent = optionLabel(option);
    button.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      if (pickerButton) pickerButton.innerHTML = `<span>${escapeHtml(optionLabel(option))}</span>`;
      closeSheet();
    });
    list.appendChild(button);
  }

  function buildSheet(select) {
    sheet = document.createElement('div');
    sheet.id = 'hcServiceSheet';
    sheet.className = 'hc-service-sheet hidden';
    sheet.innerHTML = `
      <div class="hc-service-sheet-backdrop" data-close-service></div>
      <div class="hc-service-sheet-card" role="dialog" aria-modal="true" aria-label="Выбор услуги">
        <div class="hc-service-sheet-head"><strong>Выберите услугу</strong><button type="button" class="hc-service-sheet-close" data-close-service>×</button></div>
        <div class="hc-service-sheet-list"></div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.querySelectorAll('[data-close-service]').forEach((node) => node.addEventListener('click', closeSheet));
  }

  function installCustomServicePicker() {
    const select = document.getElementById('v5Service');
    if (!select || select.dataset.hcCustomPicker === '1') return Boolean(select?.dataset.hcCustomPicker === '1');
    if (select.options.length < 2) return false;

    select.dataset.hcCustomPicker = '1';
    select.classList.add('hc-native-select-hidden');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    pickerButton = document.createElement('button');
    pickerButton.type = 'button';
    pickerButton.className = 'hc-service-picker-button';
    pickerButton.setAttribute('aria-haspopup', 'dialog');
    pickerButton.innerHTML = '<span class="muted">Выберите услугу</span>';
    select.insertAdjacentElement('afterend', pickerButton);
    pickerButton.addEventListener('click', () => openSheet(select));

    select.addEventListener('focus', () => {
      try { select.blur(); } catch {}
    });
    select.addEventListener('change', () => {
      const selected = select.selectedOptions?.[0];
      pickerButton.innerHTML = select.value
        ? `<span>${escapeHtml(optionLabel(selected))}</span>`
        : '<span class="muted">Выберите услугу</span>';
    });
    return true;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }

  async function install() {
    restorePageInteraction();
    for (let i = 0; i < 220; i += 1) {
      if (installCustomServicePicker()) break;
      await sleep(25);
    }
    restorePageInteraction();
  }

  window.addEventListener('pageshow', () => setTimeout(restorePageInteraction, 0));
  window.addEventListener('focus', () => setTimeout(restorePageInteraction, 0));
  window.addEventListener('resize', () => setTimeout(restorePageInteraction, 80));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(restorePageInteraction, 50);
  });

  document.addEventListener('touchend', () => {
    if (!document.querySelector('.hc-service-sheet:not(.hidden)')) setTimeout(restorePageInteraction, 60);
  }, { passive: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once:true });
  else install().catch(console.error);
})();
