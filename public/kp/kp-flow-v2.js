(() => {
  const FLOW_VERSION = '2';
  const UNIT_CHOICES = [
    { key: 'm2', label: 'м²', value: 'м²' },
    { key: 'piece', label: 'шт.', value: 'шт.' },
    { key: 'service', label: 'усл. ед.', value: 'усл. ед.' },
    { key: 'other', label: 'Другое', value: '' },
  ];
  const PAYMENT_OPTIONS = new Set([0, 20, 30, 50, 100]);

  let flowRoot = null;
  let progressRoot = null;
  let currentStep = 1;
  let maxReached = 1;
  let builder = null;
  let builderState = freshBuilderState();
  let duplicateIndex = -1;
  let lifecycleWrapped = false;
  let previousShowToast = null;
  let previousUpdateTotals = null;
  let previousRenderItems = null;

  function freshBuilderState(mode = 'list') {
    return {
      mode,
      presetIndex: -1,
      name: '',
      quantity: '',
      price: '',
      unit: 'усл. ед.',
      customUnit: '',
      unitTouched: false,
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function canonicalUnit(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(м2|м²|м\.?²?)$/i.test(raw)) return 'м²';
    if (/^шт\.?$/i.test(raw)) return 'шт.';
    if (/^(усл\.?|усл\.?\s*ед\.?|услуга|услуги)$/i.test(raw)) return 'усл. ед.';
    return raw;
  }

  function unitKey(value) {
    const unit = canonicalUnit(value);
    if (unit === 'м²') return 'm2';
    if (unit === 'шт.') return 'piece';
    if (unit === 'усл. ед.') return 'service';
    return 'other';
  }

  function guessUnit(name) {
    const text = String(name || '').toLowerCase().replace(/ё/g, 'е');
    if (!text.trim()) return '';

    if (/окн|стеклопакет|светильник|ламп|двер|стул|кресл|шкаф|радиатор|санузел|унитаз|раковин|витрин.*(?:шт|ед)|предмет/.test(text)) {
      return 'шт.';
    }
    if (/\bм\s*[²2]\b|кв\.?\s*м|площад|уборк|пол(?:а|ов|ы)?\b|потол|стен|фасад|ковролин|плитк|линолеум|паркет/.test(text)) {
      return 'м²';
    }
    if (/выезд|локальн|труднодоступ|дополнительн|консультац|обработк|дезинфекц|услуг|работ|комплекс/.test(text)) {
      return 'усл. ед.';
    }
    return '';
  }

  function currentOutgoingNumber() {
    const input = document.getElementById('outgoingNumber');
    const match = String(input?.value || state.currentNumber || '').match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function serviceCount() {
    return Array.isArray(state.items) ? state.items.length : 0;
  }

  function compactCurrentLine() {
    const calc = calcLocal();
    const number = currentOutgoingNumber();
    const count = serviceCount();
    const servicesWord = count === 1 ? 'услуга' : (count >= 2 && count <= 4 ? 'услуги' : 'услуг');
    return `КП №${number || '—'} · ${count} ${servicesWord} · ${money(calc.total)}`;
  }

  function clearInlineErrors(scope = document) {
    scope.querySelectorAll?.('.kp-inline-error').forEach((node) => node.remove());
    scope.querySelectorAll?.('.kp-invalid').forEach((node) => node.classList.remove('kp-invalid'));
  }

  function stepForTarget(target) {
    if (!target) return currentStep;
    const step = target.closest?.('.kp-flow-step');
    return Number(step?.dataset?.step || currentStep);
  }

  function holderFor(target) {
    return target?.closest?.('.kp-flow-field, .kp-item-edit-field, label, .kp-flow-service-builder, .kp-flow-item, .totals-card') || target;
  }

  function userMessage(message) {
    const text = String(message || '').trim();
    if (!text) return 'Проверьте заполнение данных.';
    if (/failed to fetch|network|ошибка\s*5\d\d|internal/i.test(text)) return 'Не удалось выполнить действие. Проверьте интернет и попробуйте ещё раз.';
    if (/invalid|json|undefined|null/i.test(text)) return 'Не удалось обработать данные. Проверьте заполнение полей.';
    return text;
  }

  function showInlineError(target, message, forcedStep = 0) {
    const clean = userMessage(message);
    const step = forcedStep || stepForTarget(target);
    if (step && step !== currentStep) goToStep(step, { validate: false, scroll: false });

    const holder = holderFor(target);
    if (!holder) {
      showGlobalMessage(clean, true);
      return false;
    }

    holder.querySelector?.(':scope > .kp-inline-error')?.remove();
    holder.classList.add('kp-invalid');
    const error = document.createElement('small');
    error.className = 'kp-inline-error';
    error.textContent = clean;
    holder.appendChild(error);

    requestAnimationFrame(() => {
      try { holder.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        setTimeout(() => {
          try { target.focus({ preventScroll: true }); } catch {}
        }, 260);
      }
    });
    return false;
  }

  function showGlobalMessage(message, error = false) {
    const root = document.getElementById('kpFlowGlobalMessage');
    if (!root) return;
    root.textContent = userMessage(message);
    root.classList.toggle('error', Boolean(error));
    root.classList.remove('hidden');
    clearTimeout(showGlobalMessage.timer);
    showGlobalMessage.timer = setTimeout(() => root.classList.add('hidden'), 3400);
  }

  function targetForMessage(message) {
    const text = String(message || '').toLowerCase();
    if (/дат/.test(text)) return { target: fields.issue_date, step: 1 };
    if (/исх|номер/.test(text)) return { target: document.getElementById('outgoingNumber'), step: 1 };
    if (/срок действия/.test(text)) return { target: fields.valid_days, step: 1 };
    if (/назван.*услуг/.test(text)) return { target: builder?.querySelector('#kpFlowCustomName') || document.getElementById('items'), step: 2 };
    if (/количеств|площад/.test(text)) return { target: builder?.querySelector('#kpFlowQty') || document.getElementById('items'), step: 2 };
    if (/цен/.test(text)) return { target: builder?.querySelector('#kpFlowPrice') || document.getElementById('items'), step: 2 };
    if (/добавьте.*услуг|хотя бы одну услугу/.test(text)) return { target: builder || document.getElementById('items'), step: 2 };
    if (/скид/.test(text)) return { target: fields.discount_percent, step: 3 };
    if (/предоплат|условия оплаты/.test(text)) return { target: fields.prepayment_percent?.closest('.totals-card > div') || fields.prepayment_percent, step: 3 };
    if (/итог|стоимост/.test(text)) return { target: document.querySelector('.totals-card'), step: 3 };
    return { target: flowRoot, step: currentStep };
  }

  function showMappedError(message) {
    const mapped = targetForMessage(message);
    showInlineError(mapped.target, message, mapped.step);
  }

  function installToastBridge() {
    if (previousShowToast) return;
    previousShowToast = showToast;
    showToast = function flowToast(message, error = false) {
      if (error) {
        document.getElementById('kpErrorBanner')?.classList.add('hidden');
        showMappedError(message);
        return;
      }
      previousShowToast(message, false);
    };
  }

  function unitButtonsHtml(selectedValue) {
    const selected = unitKey(selectedValue);
    return UNIT_CHOICES.map((item) => `
      <button type="button" class="kp-unit-chip${selected === item.key ? ' active' : ''}" data-unit="${item.key}">${item.label}</button>`).join('');
  }

  function currentBuilderUnit() {
    const key = unitKey(builderState.unit);
    if (key === 'other') return String(builderState.customUnit || builderState.unit || '').trim();
    return canonicalUnit(builderState.unit) || 'усл. ед.';
  }

  function setBuilderUnit(value, manual = true) {
    const key = unitKey(value);
    builderState.unitTouched = manual || builderState.unitTouched;
    if (key === 'other') {
      builderState.unit = String(value || builderState.customUnit || '').trim();
    } else {
      builderState.unit = UNIT_CHOICES.find((item) => item.key === key)?.value || canonicalUnit(value) || 'усл. ед.';
      builderState.customUnit = '';
    }
    syncBuilder();
  }

  function maybeAutoUnit(name, preferred = '') {
    if (builderState.unitTouched) return;
    const normalizedPreferred = canonicalUnit(preferred);
    const guessed = normalizedPreferred || guessUnit(name);
    if (guessed) builderState.unit = guessed;
  }

  function renderPresetOptions() {
    const root = builder?.querySelector('#kpFlowPresetOptions');
    if (!root) return;
    const presets = state.bootstrap?.presets || [];
    if (!presets.length) {
      root.innerHTML = '<div class="kp-flow-empty-small">Список услуг пока пуст.</div>';
      return;
    }

    const groups = new Map();
    presets.forEach((preset, index) => {
      const group = String(preset.group || 'Услуги');
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ preset, index });
    });

    root.innerHTML = [...groups.entries()].map(([group, entries]) => `
      <div class="kp-flow-preset-group">
        <div class="kp-flow-preset-group-title">${escapeHtml(group.replace(/работ/gi, 'услуг'))}</div>
        ${entries.map(({ preset, index }) => `
          <button type="button" class="kp-flow-preset-option" data-preset-index="${index}">
            <span>${escapeHtml(preset.name)}</span>
            <small>${Number(preset.price || 0) > 0 ? `${money(preset.price)} / ${escapeHtml(canonicalUnit(preset.unit) || 'усл. ед.')}` : escapeHtml(canonicalUnit(preset.unit) || 'усл. ед.')}</small>
          </button>`).join('')}
      </div>`).join('');
  }

  function selectPreset(index) {
    const preset = state.bootstrap?.presets?.[index];
    if (!preset) return;
    builderState = freshBuilderState('list');
    builderState.presetIndex = index;
    builderState.name = String(preset.name || '').trim();
    builderState.price = Number(preset.price || 0) > 0 ? String(preset.price) : '';
    maybeAutoUnit(builderState.name, preset.unit);
    if (!builderState.unit) builderState.unit = 'усл. ед.';
    if (canonicalUnit(builderState.unit) === 'усл. ед.') builderState.quantity = '1';
    else if (canonicalUnit(builderState.unit) === 'м²' && num(fields.area?.value) > 0) builderState.quantity = fields.area.value;
    builder?.querySelector('#kpFlowPresetOptions')?.classList.add('hidden');
    syncBuilder();
  }

  function setBuilderMode(mode) {
    const nextMode = mode === 'custom' ? 'custom' : 'list';
    builderState = freshBuilderState(nextMode);
    duplicateIndex = -1;
    clearInlineErrors(builder || document);
    syncBuilder();
  }

  function syncBuilder() {
    if (!builder) return;
    builder.querySelectorAll('[data-builder-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.builderMode === builderState.mode);
      button.setAttribute('aria-pressed', button.classList.contains('active') ? 'true' : 'false');
    });

    const listBlock = builder.querySelector('#kpFlowListBlock');
    const customBlock = builder.querySelector('#kpFlowCustomBlock');
    listBlock?.classList.toggle('hidden', builderState.mode !== 'list');
    customBlock?.classList.toggle('hidden', builderState.mode !== 'custom');

    const pickerLabel = builder.querySelector('#kpFlowPresetLabel');
    if (pickerLabel) pickerLabel.textContent = builderState.name || 'Выберите услугу';
    const customName = builder.querySelector('#kpFlowCustomName');
    if (customName && customName.value !== builderState.name) customName.value = builderState.name;
    const qty = builder.querySelector('#kpFlowQty');
    const price = builder.querySelector('#kpFlowPrice');
    if (qty && qty.value !== String(builderState.quantity)) qty.value = String(builderState.quantity);
    if (price && price.value !== String(builderState.price)) price.value = String(builderState.price);

    const unitRoot = builder.querySelector('#kpFlowUnits');
    if (unitRoot) unitRoot.innerHTML = unitButtonsHtml(currentBuilderUnit() || builderState.unit);
    const otherWrap = builder.querySelector('#kpFlowOtherUnitWrap');
    const otherInput = builder.querySelector('#kpFlowOtherUnit');
    const isOther = unitKey(builderState.unit || builderState.customUnit) === 'other';
    otherWrap?.classList.toggle('hidden', !isOther);
    if (otherInput && otherInput.value !== builderState.customUnit) otherInput.value = builderState.customUnit;

    const autoHint = builder.querySelector('#kpFlowUnitHint');
    if (autoHint) {
      const guessed = !builderState.unitTouched ? guessUnit(builderState.name) : '';
      autoHint.textContent = guessed ? `Подсказка по названию: ${guessed}` : 'Единицу всегда можно изменить вручную.';
    }

    const previewName = builder.querySelector('#kpFlowPositionName');
    const previewCalc = builder.querySelector('#kpFlowPositionCalc');
    const previewTotal = builder.querySelector('#kpFlowPositionTotal');
    const quantity = num(builderState.quantity);
    const priceValue = num(builderState.price);
    const unit = currentBuilderUnit() || '—';
    if (previewName) previewName.textContent = builderState.name || 'Новая услуга';
    if (previewCalc) previewCalc.textContent = `${builderState.quantity || '0'} ${unit} × ${priceValue > 0 ? money(priceValue) : '0 ₽'}`;
    if (previewTotal) previewTotal.textContent = money(quantity * priceValue);

    builder.querySelector('#kpFlowDuplicate')?.classList.toggle('hidden', duplicateIndex < 0);
    refreshFlowSummary();
  }

  function builderPayload() {
    return {
      name: String(builderState.name || '').trim(),
      unit: currentBuilderUnit(),
      quantity: String(builderState.quantity || '').trim(),
      price: String(builderState.price || '').trim(),
    };
  }

  function validateBuilder() {
    clearInlineErrors(builder);
    const item = builderPayload();
    if (!item.name) {
      const target = builderState.mode === 'custom'
        ? builder.querySelector('#kpFlowCustomName')
        : builder.querySelector('#kpFlowPresetPicker');
      return showInlineError(target, builderState.mode === 'custom' ? 'Укажите название услуги' : 'Выберите услугу', 2);
    }
    if (num(item.quantity) <= 0) return showInlineError(builder.querySelector('#kpFlowQty'), 'Введите количество', 2);
    if (!item.unit) return showInlineError(builder.querySelector('#kpFlowOtherUnit'), 'Укажите единицу измерения', 2);
    if (num(item.price) <= 0) return showInlineError(builder.querySelector('#kpFlowPrice'), 'Введите корректную цену', 2);
    return item;
  }

  function commitBuilderItem(forceSeparate = false) {
    const item = validateBuilder();
    if (!item) return;

    const normalized = item.name.toLowerCase().replace(/\s+/g, ' ').trim();
    const existingIndex = state.items.findIndex((row) => String(row.name || '').toLowerCase().replace(/\s+/g, ' ').trim() === normalized);
    if (existingIndex >= 0 && !forceSeparate) {
      duplicateIndex = existingIndex;
      const duplicate = builder.querySelector('#kpFlowDuplicate');
      if (duplicate) {
        duplicate.classList.remove('hidden');
        duplicate.querySelector('strong').textContent = 'Такая услуга уже есть в КП';
      }
      return;
    }

    state.items.push(item);
    state.lastSaved = null;
    duplicateIndex = -1;
    renderItems();
    updateTotals();
    showBuilderFeedback('Услуга добавлена в КП');
    const mode = builderState.mode;
    builderState = freshBuilderState(mode);
    syncBuilder();
  }

  function showBuilderFeedback(message) {
    const feedback = builder?.querySelector('#kpFlowBuilderFeedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.remove('hidden');
    clearTimeout(showBuilderFeedback.timer);
    showBuilderFeedback.timer = setTimeout(() => feedback.classList.add('hidden'), 2200);
  }

  function openItemEditor(index) {
    const row = document.querySelector(`.kp-flow-item[data-index="${index}"]`);
    if (!row) return;
    row.querySelector('.kp-flow-item-edit')?.classList.remove('hidden');
    row.querySelector('[data-action="edit"]')?.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      try { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      row.querySelector('input[data-k="name"]')?.focus({ preventScroll: true });
    });
  }

  function renderItemUnitEditor(root, index, value) {
    const selected = unitKey(value);
    const custom = selected === 'other' ? canonicalUnit(value) : '';
    root.innerHTML = `
      <div class="kp-item-unit-chips">${unitButtonsHtml(value)}</div>
      <input class="kp-item-custom-unit${selected === 'other' ? '' : ' hidden'}" data-custom-unit inputmode="text" value="${escapeAttr(custom)}" placeholder="Например: м.п., час, компл." />`;

    root.querySelectorAll('.kp-unit-chip').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.unit;
        if (key === 'other') {
          const current = canonicalUnit(state.items[index].unit);
          state.items[index].unit = unitKey(current) === 'other' ? current : '';
        } else {
          state.items[index].unit = UNIT_CHOICES.find((item) => item.key === key)?.value || 'усл. ед.';
        }
        state.lastSaved = null;
        renderItems();
      });
    });

    const customInput = root.querySelector('[data-custom-unit]');
    customInput?.addEventListener('input', () => {
      state.items[index].unit = customInput.value;
      state.lastSaved = null;
      updateTotals();
      refreshFlowSummary();
    });
  }

  function renderCompactItems() {
    if (!itemsEl) return;
    itemsEl.innerHTML = '';
    if (!state.items.length) {
      const empty = document.createElement('div');
      empty.className = 'kp-flow-empty-state';
      empty.innerHTML = '<strong>Пока нет услуг.</strong><span>Добавьте первую услугу выше.</span>';
      itemsEl.appendChild(empty);
      updateTotals();
      refreshFlowSummary();
      return;
    }

    state.items.forEach((item, index) => {
      const row = document.createElement('article');
      row.className = 'item kp-flow-item';
      row.dataset.index = String(index);
      const unit = canonicalUnit(item.unit) || String(item.unit || '—');
      const amount = num(item.quantity) * num(item.price);
      row.innerHTML = `
        <div class="kp-flow-item-main">
          <div class="kp-flow-item-copy">
            <strong>${escapeHtml(item.name || 'Без названия')}</strong>
            <span>${escapeHtml(item.quantity || '0')} ${escapeHtml(unit)} × ${money(num(item.price))}</span>
          </div>
          <div class="item-total">${money(amount)}</div>
        </div>
        <div class="kp-flow-item-actions">
          <button type="button" data-action="edit" aria-expanded="false">Изменить</button>
          <button type="button" data-action="duplicate">Дублировать</button>
          <button type="button" data-action="delete" class="danger">Удалить</button>
        </div>
        <div class="kp-flow-item-edit hidden">
          <label class="kp-item-edit-field">Название услуги<input data-k="name" value="${escapeAttr(item.name)}" /></label>
          <div class="kp-flow-two">
            <label class="kp-item-edit-field">Количество<input data-k="quantity" inputmode="decimal" value="${escapeAttr(item.quantity)}" /></label>
            <label class="kp-item-edit-field">Цена, ₽<input data-k="price" inputmode="decimal" value="${escapeAttr(item.price)}" /></label>
          </div>
          <div class="kp-item-edit-field"><span>Ед. измерения</span><div data-unit-editor></div></div>
          <button type="button" class="kp-flow-done-edit" data-action="done">Готово</button>
        </div>`;

      row.querySelectorAll('input[data-k]').forEach((input) => {
        input.addEventListener('input', () => {
          state.items[index][input.dataset.k] = input.value;
          state.lastSaved = null;
          input.closest('.kp-invalid')?.classList.remove('kp-invalid');
          input.closest('.kp-item-edit-field')?.querySelector('.kp-inline-error')?.remove();
          updateTotals();
          const copy = row.querySelector('.kp-flow-item-copy');
          if (copy) {
            const current = state.items[index];
            copy.querySelector('strong').textContent = current.name || 'Без названия';
            copy.querySelector('span').textContent = `${current.quantity || '0'} ${canonicalUnit(current.unit) || current.unit || '—'} × ${money(num(current.price))}`;
          }
        });
      });

      row.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
        const panel = row.querySelector('.kp-flow-item-edit');
        const open = panel.classList.toggle('hidden') === false;
        row.querySelector('[data-action="edit"]').setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      row.querySelector('[data-action="done"]')?.addEventListener('click', () => {
        row.querySelector('.kp-flow-item-edit')?.classList.add('hidden');
        row.querySelector('[data-action="edit"]')?.setAttribute('aria-expanded', 'false');
      });
      row.querySelector('[data-action="duplicate"]')?.addEventListener('click', () => {
        state.items.splice(index + 1, 0, { ...state.items[index] });
        state.lastSaved = null;
        renderItems();
        showBuilderFeedback('Позиция продублирована');
      });
      row.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        state.items.splice(index, 1);
        state.lastSaved = null;
        renderItems();
      });

      renderItemUnitEditor(row.querySelector('[data-unit-editor]'), index, item.unit);
      itemsEl.appendChild(row);
    });
    updateTotals();
    refreshFlowSummary();
  }

  function installCompactItems() {
    if (previousRenderItems) return;
    previousRenderItems = renderItems;
    renderItems = renderCompactItems;
    renderItems();
  }

  function createBuilder() {
    if (builder) return builder;
    builder = document.createElement('div');
    builder.id = 'kpFlowServiceBuilder';
    builder.className = 'kp-flow-service-builder';
    builder.innerHTML = `
      <div class="kp-flow-segment" role="tablist" aria-label="Способ добавления услуги">
        <button type="button" data-builder-mode="list" class="active">Из списка</button>
        <button type="button" data-builder-mode="custom">Своя услуга</button>
      </div>

      <div id="kpFlowListBlock" class="kp-flow-builder-block">
        <label class="kp-flow-field">
          <span>Услуга</span>
          <button id="kpFlowPresetPicker" type="button" class="kp-flow-picker" aria-expanded="false">
            <span id="kpFlowPresetLabel">Выберите услугу</span><b>⌄</b>
          </button>
          <div id="kpFlowPresetOptions" class="kp-flow-preset-options hidden"></div>
        </label>
      </div>

      <div id="kpFlowCustomBlock" class="kp-flow-builder-block hidden">
        <label class="kp-flow-field">Название услуги<input id="kpFlowCustomName" placeholder="Например: Мойка стеклянных перегородок" /></label>
      </div>

      <div class="kp-flow-two">
        <label class="kp-flow-field">Количество<input id="kpFlowQty" inputmode="decimal" placeholder="0" /></label>
        <label class="kp-flow-field">Цена, ₽<input id="kpFlowPrice" inputmode="decimal" placeholder="0" /></label>
      </div>

      <div class="kp-flow-field kp-flow-unit-field">
        <span>Ед. измерения</span>
        <div id="kpFlowUnits" class="kp-unit-chips"></div>
        <div id="kpFlowOtherUnitWrap" class="kp-flow-other-unit hidden">
          <input id="kpFlowOtherUnit" placeholder="Например: м.п., час, компл." />
        </div>
        <small id="kpFlowUnitHint" class="kp-flow-field-hint">Единицу всегда можно изменить вручную.</small>
      </div>

      <div class="kp-flow-position-preview">
        <div><strong id="kpFlowPositionName">Новая услуга</strong><span id="kpFlowPositionCalc">0 × 0 ₽</span></div>
        <b id="kpFlowPositionTotal">0 ₽</b>
      </div>

      <div id="kpFlowDuplicate" class="kp-flow-duplicate hidden">
        <strong>Такая услуга уже есть в КП</strong>
        <span>Выберите, что сделать.</span>
        <div>
          <button type="button" id="kpFlowEditDuplicate">Редактировать существующую</button>
          <button type="button" id="kpFlowAddDuplicate">Добавить отдельной строкой</button>
        </div>
      </div>

      <button id="kpFlowAddService" type="button" class="kp-flow-primary">Добавить в КП</button>
      <div id="kpFlowBuilderFeedback" class="kp-flow-inline-success hidden" role="status"></div>`;

    builder.querySelectorAll('[data-builder-mode]').forEach((button) => {
      button.addEventListener('click', () => setBuilderMode(button.dataset.builderMode));
    });
    builder.querySelector('#kpFlowPresetPicker')?.addEventListener('click', () => {
      const options = builder.querySelector('#kpFlowPresetOptions');
      const open = options.classList.toggle('hidden') === false;
      builder.querySelector('#kpFlowPresetPicker').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    builder.querySelector('#kpFlowPresetOptions')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-preset-index]');
      if (!option) return;
      selectPreset(Number(option.dataset.presetIndex));
      builder.querySelector('#kpFlowPresetPicker')?.setAttribute('aria-expanded', 'false');
    });
    builder.querySelector('#kpFlowCustomName')?.addEventListener('input', (event) => {
      builderState.name = event.target.value;
      maybeAutoUnit(builderState.name);
      syncBuilder();
    });
    builder.querySelector('#kpFlowQty')?.addEventListener('input', (event) => {
      builderState.quantity = event.target.value;
      syncBuilder();
    });
    builder.querySelector('#kpFlowPrice')?.addEventListener('input', (event) => {
      builderState.price = event.target.value;
      syncBuilder();
    });
    builder.querySelector('#kpFlowUnits')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-unit]');
      if (!button) return;
      const key = button.dataset.unit;
      if (key === 'other') {
        builderState.unitTouched = true;
        builderState.unit = builderState.customUnit || '';
      } else {
        builderState.unitTouched = true;
        builderState.unit = UNIT_CHOICES.find((item) => item.key === key)?.value || 'усл. ед.';
        builderState.customUnit = '';
      }
      syncBuilder();
      if (key === 'other') setTimeout(() => builder.querySelector('#kpFlowOtherUnit')?.focus(), 0);
    });
    builder.querySelector('#kpFlowOtherUnit')?.addEventListener('input', (event) => {
      builderState.unitTouched = true;
      builderState.customUnit = event.target.value;
      builderState.unit = event.target.value;
      syncBuilder();
    });
    builder.querySelector('#kpFlowAddService')?.addEventListener('click', () => commitBuilderItem(false));
    builder.querySelector('#kpFlowEditDuplicate')?.addEventListener('click', () => {
      if (duplicateIndex < 0) return;
      const index = duplicateIndex;
      duplicateIndex = -1;
      syncBuilder();
      openItemEditor(index);
    });
    builder.querySelector('#kpFlowAddDuplicate')?.addEventListener('click', () => commitBuilderItem(true));

    renderPresetOptions();
    syncBuilder();
    return builder;
  }

  function validateStep1() {
    clearInlineErrors(flowRoot?.querySelector('[data-step="1"]') || document);
    const outgoing = document.getElementById('outgoingNumber');
    if (num(outgoing?.value) < 1) return showInlineError(outgoing, 'Укажите исходящий номер', 1);
    if (!String(fields.issue_date?.value || '').trim()) return showInlineError(fields.issue_date, 'Выберите дату', 1);
    if (num(fields.valid_days?.value) < 1) return showInlineError(fields.valid_days, 'Укажите срок действия КП', 1);
    return true;
  }

  function validateItem(index) {
    const item = state.items[index] || {};
    const row = document.querySelector(`.kp-flow-item[data-index="${index}"]`);
    if (!String(item.name || '').trim()) {
      openItemEditor(index);
      return showInlineError(row?.querySelector('input[data-k="name"]') || row, 'Укажите название услуги', 2);
    }
    if (num(item.quantity) <= 0) {
      openItemEditor(index);
      return showInlineError(row?.querySelector('input[data-k="quantity"]') || row, 'Введите количество', 2);
    }
    if (!String(item.unit || '').trim()) {
      openItemEditor(index);
      return showInlineError(row?.querySelector('[data-unit-editor]') || row, 'Укажите единицу измерения', 2);
    }
    if (num(item.price) <= 0) {
      openItemEditor(index);
      return showInlineError(row?.querySelector('input[data-k="price"]') || row, 'Введите корректную цену', 2);
    }
    return true;
  }

  function validateStep2() {
    clearInlineErrors(flowRoot?.querySelector('[data-step="2"]') || document);
    if (!state.items.length) return showInlineError(builder || document.getElementById('items'), 'Добавьте хотя бы одну услугу', 2);
    for (let index = 0; index < state.items.length; index += 1) {
      if (!validateItem(index)) return false;
    }
    if (calcLocal().total <= 0) return showInlineError(document.getElementById('items'), 'Итоговая стоимость должна быть больше нуля', 2);
    return true;
  }

  function validateStep3() {
    clearInlineErrors(flowRoot?.querySelector('[data-step="3"]') || document);
    const discount = num(fields.discount_percent?.value);
    if (discount < 0 || discount > 100) return showInlineError(fields.discount_percent, 'Скидка должна быть от 0 до 100%', 3);
    const prepayment = Number(fields.prepayment_percent?.value || 0);
    if (!PAYMENT_OPTIONS.has(prepayment)) {
      return showInlineError(fields.prepayment_percent?.closest('.totals-card > div') || fields.prepayment_percent, 'Выберите доступный процент предоплаты или оставьте 0%', 3);
    }
    return true;
  }

  function validateAll() {
    if (!validateStep1()) return false;
    if (!validateStep2()) return false;
    if (!validateStep3()) return false;
    try {
      validateClientPayload(buildPayload());
      return true;
    } catch (error) {
      showMappedError(error?.message || error);
      return false;
    }
  }

  function updateProgress() {
    if (!progressRoot) return;
    progressRoot.querySelectorAll('[data-progress-step]').forEach((button) => {
      const step = Number(button.dataset.progressStep);
      button.classList.toggle('active', step === currentStep);
      button.classList.toggle('done', step < currentStep || step < maxReached);
      button.disabled = step > maxReached;
      button.setAttribute('aria-current', step === currentStep ? 'step' : 'false');
    });
  }

  function goToStep(step, options = {}) {
    const targetStep = Math.min(4, Math.max(1, Number(step) || 1));
    const validate = options.validate !== false;
    const scroll = options.scroll !== false;

    if (validate && targetStep > currentStep) {
      if (currentStep === 1 && !validateStep1()) return false;
      if (currentStep === 2 && !validateStep2()) return false;
      if (currentStep === 3 && !validateStep3()) return false;
    }

    currentStep = targetStep;
    maxReached = Math.max(maxReached, targetStep);
    flowRoot?.querySelectorAll('.kp-flow-step').forEach((section) => {
      section.classList.toggle('active', Number(section.dataset.step) === currentStep);
    });
    updateProgress();
    refreshFlowSummary();
    if (currentStep === 4) renderReview();
    if (scroll) {
      requestAnimationFrame(() => {
        try { progressRoot?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
      });
    }
    return true;
  }

  function refreshFlowSummary() {
    document.querySelectorAll('[data-flow-mini-summary]').forEach((node) => {
      node.textContent = compactCurrentLine();
    });
    if (currentStep === 4) renderReview();
  }

  function reviewRow(label, value, extraClass = '') {
    return `<div class="kp-review-row ${extraClass}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function renderReview() {
    const root = document.getElementById('kpFlowReview');
    if (!root) return;
    const calc = calcLocal();
    const number = currentOutgoingNumber();
    const client = [fields.client_name?.value, fields.client_company?.value].map((value) => String(value || '').trim()).filter(Boolean).join(' · ') || 'Не указан';
    const prepayment = Number(fields.prepayment_percent?.value || 0);
    const equipment = String(document.getElementById('equipment')?.value || '').trim();

    const services = state.items.map((item) => `
      <div class="kp-review-service">
        <div><strong>${escapeHtml(item.name || 'Без названия')}</strong><span>${escapeHtml(item.quantity || '0')} ${escapeHtml(canonicalUnit(item.unit) || item.unit || '—')} × ${money(num(item.price))}</span></div>
        <b>${money(num(item.quantity) * num(item.price))}</b>
      </div>`).join('');

    root.innerHTML = `
      <div class="kp-review-card">
        ${reviewRow('Исходящий номер', `№${number || '—'}`)}
        ${reviewRow('Дата', dateRu(fields.issue_date?.value))}
        ${reviewRow('Заказчик', client)}
        ${fields.object_type?.value ? reviewRow('Объект', fields.object_type.value) : ''}
      </div>
      <div class="kp-review-card">
        <div class="kp-review-card-title">Услуги</div>
        ${services || '<div class="kp-flow-empty-small">Услуги не добавлены.</div>'}
      </div>
      <div class="kp-review-card kp-review-totals">
        ${reviewRow('Подытог', money(calc.subtotal))}
        ${calc.discount > 0 ? reviewRow(`Скидка ${calc.discountPercent}%`, `−${money(calc.discount)}`) : ''}
        ${prepayment > 0 ? reviewRow(`Предоплата ${prepayment}%`, money(calc.prepayment)) : ''}
        ${reviewRow('Итого', money(calc.total), 'total')}
      </div>
      ${fields.duration?.value || equipment ? `<div class="kp-review-card">
        ${fields.duration?.value ? reviewRow('Срок выполнения', fields.duration.value) : ''}
        ${equipment ? `<div class="kp-review-equipment"><span>Оборудование</span><p>${escapeHtml(equipment).replace(/\n/g, '<br>')}</p></div>` : ''}
      </div>` : ''}`;
  }

  async function createQuoteFromReview(button) {
    clearInlineErrors(flowRoot);
    if (!validateAll()) return;
    goToStep(4, { validate: false, scroll: false });
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Создаём КП…';
    try {
      await downloadCurrentPdf();
      maxReached = 1;
      goToStep(1, { validate: false, scroll: true });
    } catch (error) {
      showMappedError(error?.message || error);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function createStep(number, title, subtitle = '') {
    const section = document.createElement('section');
    section.className = `kp-flow-step${number === 1 ? ' active' : ''}`;
    section.dataset.step = String(number);
    section.innerHTML = `<div class="kp-flow-step-head"><div><span>Шаг ${number} из 4</span><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div></div>`;
    return section;
  }

  function appendExisting(step, node) {
    if (node) step.appendChild(node);
  }

  function buildFlowShell() {
    if (document.getElementById('kpFlowRoot')) return true;
    const editor = document.querySelector('.editor-panel');
    if (!editor || !state.bootstrap) return false;

    flowRoot = document.createElement('div');
    flowRoot.id = 'kpFlowRoot';
    flowRoot.dataset.version = FLOW_VERSION;

    progressRoot = document.createElement('nav');
    progressRoot.id = 'kpFlowProgress';
    progressRoot.className = 'kp-flow-progress';
    progressRoot.setAttribute('aria-label', 'Шаги создания КП');
    progressRoot.innerHTML = `
      <button type="button" data-progress-step="1"><b>1</b><span>Данные</span></button>
      <button type="button" data-progress-step="2" disabled><b>2</b><span>Услуги</span></button>
      <button type="button" data-progress-step="3" disabled><b>3</b><span>Условия</span></button>
      <button type="button" data-progress-step="4" disabled><b>4</b><span>Проверка</span></button>`;

    const globalMessage = document.createElement('div');
    globalMessage.id = 'kpFlowGlobalMessage';
    globalMessage.className = 'kp-flow-global-message hidden';
    globalMessage.setAttribute('role', 'status');

    const step1 = createStep(1, 'Данные', 'Основная информация коммерческого предложения.');
    const step2 = createStep(2, 'Услуги', 'Добавьте услуги из списка или свою позицию.');
    const step3 = createStep(3, 'Условия', 'Проверьте суммы и условия выполнения.');
    const step4 = createStep(4, 'Проверка', 'Короткое резюме перед созданием PDF.');

    const outgoingGrid = document.getElementById('outgoingNumber')?.closest('.grid');
    const validLabel = fields.valid_days?.closest('label');
    const clientGrid = fields.client_name?.closest('.grid');
    const objectGrid = fields.object_type?.closest('.grid');
    const titleLabel = fields.title?.closest('label');
    appendExisting(step1, outgoingGrid);
    appendExisting(step1, validLabel);
    appendExisting(step1, clientGrid);
    appendExisting(step1, objectGrid);
    appendExisting(step1, titleLabel);

    const step1Actions = document.createElement('div');
    step1Actions.className = 'kp-flow-step-actions';
    step1Actions.innerHTML = '<button type="button" class="kp-flow-primary" data-next="2">Далее → Услуги</button>';
    step1.appendChild(step1Actions);

    const mini2 = document.createElement('div');
    mini2.className = 'kp-flow-mini-summary';
    mini2.dataset.flowMiniSummary = '1';
    step2.appendChild(mini2);
    step2.appendChild(createBuilder());
    appendExisting(step2, itemsEl);
    const step2Actions = document.createElement('div');
    step2Actions.className = 'kp-flow-step-actions split';
    step2Actions.innerHTML = '<button type="button" class="kp-flow-secondary" data-back="1">← Данные</button><button type="button" class="kp-flow-primary" data-next="3">Далее → Условия</button>';
    step2.appendChild(step2Actions);

    const mini3 = document.createElement('div');
    mini3.className = 'kp-flow-mini-summary';
    mini3.dataset.flowMiniSummary = '1';
    step3.appendChild(mini3);
    appendExisting(step3, document.querySelector('.totals-card'));
    appendExisting(step3, fields.duration?.closest('.grid'));
    const equipment = document.getElementById('equipment');
    appendExisting(step3, equipment?.closest('.commercial-equipment-card'));
    const step3Actions = document.createElement('div');
    step3Actions.className = 'kp-flow-step-actions split';
    step3Actions.innerHTML = '<button type="button" class="kp-flow-secondary" data-back="2">← Услуги</button><button type="button" class="kp-flow-primary" data-next="4">Далее → Проверка</button>';
    step3.appendChild(step3Actions);

    const mini4 = document.createElement('div');
    mini4.className = 'kp-flow-mini-summary';
    mini4.dataset.flowMiniSummary = '1';
    step4.appendChild(mini4);
    const review = document.createElement('div');
    review.id = 'kpFlowReview';
    step4.appendChild(review);
    const step4Actions = document.createElement('div');
    step4Actions.className = 'kp-flow-step-actions split';
    step4Actions.innerHTML = '<button type="button" class="kp-flow-secondary" data-back="3">← Назад и изменить</button><button type="button" id="kpFlowCreateQuote" class="kp-flow-primary">Создать КП</button>';
    step4.appendChild(step4Actions);

    flowRoot.append(step1, step2, step3, step4);
    editor.insertBefore(progressRoot, editor.firstChild);
    editor.insertBefore(globalMessage, progressRoot.nextSibling);
    editor.insertBefore(flowRoot, globalMessage.nextSibling);
    editor.classList.add('kp-flow-enabled');

    progressRoot.addEventListener('click', (event) => {
      const button = event.target.closest('[data-progress-step]');
      if (!button || button.disabled) return;
      const step = Number(button.dataset.progressStep);
      if (step <= maxReached) goToStep(step, { validate: false });
    });
    flowRoot.addEventListener('click', (event) => {
      const next = event.target.closest('[data-next]');
      const back = event.target.closest('[data-back]');
      if (next) goToStep(Number(next.dataset.next), { validate: true });
      if (back) goToStep(Number(back.dataset.back), { validate: false });
    });
    step4.querySelector('#kpFlowCreateQuote')?.addEventListener('click', (event) => createQuoteFromReview(event.currentTarget));

    document.querySelectorAll('.editor-panel > .section-head, .editor-panel > .services-head, #presetRow, #quickServiceCard, .sticky-actions').forEach((node) => {
      if (!flowRoot.contains(node)) node.classList.add('kp-flow-legacy-hidden');
    });
    document.getElementById('addItemBtn')?.classList.add('kp-flow-legacy-hidden');
    document.getElementById('newQuoteBtn')?.classList.add('kp-flow-top-new-hidden');

    configureBottomNav();
    installCompactItems();
    refreshFlowSummary();
    updateProgress();
    return true;
  }

  function configureBottomNav() {
    const nav = document.getElementById('kpBottomNav');
    if (!nav) return false;
    nav.classList.add('kp-flow-bottom-nav');
    nav.querySelector('[data-nav="preview"]')?.remove();
    const newButton = nav.querySelector('[data-nav="new"] small');
    if (newButton) newButton.textContent = 'Новое КП';
    const resetButton = nav.querySelector('[data-nav="reset"] small');
    if (resetButton) resetButton.textContent = 'Сброс';
    return true;
  }

  function installPaymentToggle() {
    if (document.body.dataset.flowPaymentToggle === '1') return;
    document.body.dataset.flowPaymentToggle = '1';
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('.quick-payment-button');
      if (!button) return;
      const percent = Number(button.dataset.percent || 0);
      const current = Number(fields.prepayment_percent?.value || 0);
      if (current !== percent) {
        setTimeout(refreshFlowSummary, 0);
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      fields.prepayment_percent.value = '0';
      if (fields.payment_terms) fields.payment_terms.value = '';
      document.querySelectorAll('.quick-payment-button').forEach((item) => item.classList.remove('active'));
      state.lastSaved = null;
      updateTotals();
      fields.prepayment_percent.dispatchEvent(new Event('input', { bubbles: true }));
      showGlobalMessage('Предоплата сброшена до 0%');
    }, true);
  }

  function hookErrorCleanup() {
    document.addEventListener('input', (event) => {
      const holder = holderFor(event.target);
      holder?.classList.remove('kp-invalid');
      holder?.querySelector?.(':scope > .kp-inline-error')?.remove();
      refreshFlowSummary();
    }, true);
    document.addEventListener('change', (event) => {
      const holder = holderFor(event.target);
      holder?.classList.remove('kp-invalid');
      holder?.querySelector?.(':scope > .kp-inline-error')?.remove();
      refreshFlowSummary();
    }, true);
  }

  function wrapLifecycle() {
    if (lifecycleWrapped) return;
    lifecycleWrapped = true;

    const oldReset = resetForm;
    resetForm = async function flowResetForm() {
      const result = await oldReset();
      builderState = freshBuilderState('list');
      duplicateIndex = -1;
      maxReached = 1;
      setTimeout(() => {
        renderPresetOptions();
        renderItems();
        syncBuilder();
        goToStep(1, { validate: false, scroll: false });
      }, 0);
      return result;
    };

    const oldFill = fillForm;
    fillForm = function flowFillForm(quote, options = {}) {
      const result = oldFill(quote, options);
      builderState = freshBuilderState('list');
      duplicateIndex = -1;
      maxReached = 1;
      setTimeout(() => {
        renderItems();
        syncBuilder();
        goToStep(1, { validate: false, scroll: true });
      }, 0);
      return result;
    };

    if (!previousUpdateTotals) {
      previousUpdateTotals = updateTotals;
      updateTotals = function flowUpdateTotals() {
        const result = previousUpdateTotals();
        refreshFlowSummary();
        return result;
      };
    }
  }

  function areaAssist() {
    fields.area?.addEventListener('input', () => {
      if (builderState.mode !== 'list' || builderState.presetIndex < 0 || builderState.unitTouched) return;
      if (canonicalUnit(builderState.unit) === 'м²' && !String(builderState.quantity || '').trim()) {
        builderState.quantity = fields.area.value;
        syncBuilder();
      }
    });
  }

  async function install() {
    installToastBridge();
    installPaymentToggle();
    hookErrorCleanup();
    wrapLifecycle();
    areaAssist();

    for (let i = 0; i < 160 && !state.bootstrap; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    for (let i = 0; i < 100 && !document.getElementById('equipment'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    for (let i = 0; i < 80 && !document.getElementById('kpBottomNav'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    buildFlowShell();
    configureBottomNav();
    document.getElementById('kpErrorBanner')?.classList.add('hidden');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install().catch((error) => console.error('KP flow v2 failed', error)), { once: true });
  } else {
    install().catch((error) => console.error('KP flow v2 failed', error));
  }
})();
