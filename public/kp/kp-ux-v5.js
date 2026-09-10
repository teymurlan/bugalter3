(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const REGION_SPB = 'Санкт-Петербург';
  const REGION_LO = 'Ленинградская область';
  let regionSelect = null;

  function cleanAddress(value) {
    let text = String(value || '').trim();
    const patterns = [
      /^г\.?\s*санкт[- ]петербург\s*,?\s*/i,
      /^санкт[- ]петербург\s*,?\s*/i,
      /^ленинградская\s+область\s*,?\s*/i,
      /^лен\.\s*область\s*,?\s*/i,
    ];
    for (const rx of patterns) text = text.replace(rx, '');
    return text.trim();
  }

  function detectRegion(value) {
    const text = String(value || '');
    if (/ленинградск|лен\.\s*обл/i.test(text)) return REGION_LO;
    return REGION_SPB;
  }

  function combineAddress(region, address) {
    const raw = cleanAddress(address);
    return raw ? `${region}, ${raw}` : region;
  }

  function injectRegionPicker() {
    if (document.getElementById('objectRegion')) {
      regionSelect = document.getElementById('objectRegion');
      return;
    }
    const address = fields?.address;
    const addressLabel = address?.closest('label');
    if (!address || !addressLabel) return;

    const currentAddress = address.value;
    const region = detectRegion(currentAddress);
    address.value = cleanAddress(currentAddress);
    address.placeholder = 'Улица, дом, корпус, квартира / помещение';

    const firstText = [...addressLabel.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (firstText) firstText.textContent = 'Адрес (без города)';

    const regionLabel = document.createElement('label');
    regionLabel.className = 'region-picker-label';
    regionLabel.innerHTML = `Регион объекта
      <select id="objectRegion" aria-label="Регион объекта">
        <option value="${REGION_SPB}">${REGION_SPB}</option>
        <option value="${REGION_LO}">${REGION_LO}</option>
      </select>`;
    regionSelect = regionLabel.querySelector('select');
    regionSelect.value = region;

    const grid = document.createElement('div');
    grid.className = 'location-grid';
    addressLabel.before(grid);
    grid.appendChild(regionLabel);
    grid.appendChild(addressLabel);

    const hint = document.createElement('div');
    hint.className = 'location-hint';
    hint.textContent = 'В готовое КП регион добавится автоматически — его не нужно писать в адресе.';
    grid.after(hint);
  }

  const originalBuildPayload = buildPayload;
  buildPayload = function buildPayloadV5() {
    const payload = originalBuildPayload();
    const region = regionSelect?.value || REGION_SPB;
    payload.address = combineAddress(region, fields.address.value);
    return payload;
  };

  const originalFillForm = fillForm;
  fillForm = function fillFormV5(quote, options = {}) {
    originalFillForm(quote, options);
    if (regionSelect) regionSelect.value = detectRegion(quote?.address);
    fields.address.value = cleanAddress(quote?.address);
  };

  const originalResetForm = resetForm;
  resetForm = async function resetFormV5() {
    const result = await originalResetForm();
    if (regionSelect) regionSelect.value = REGION_SPB;
    fields.address.value = cleanAddress(fields.address.value);
    return result;
  };

  function qtyLabelFor(unit) {
    if (unit === 'м²') return 'Площадь, м²';
    if (unit === 'шт.' || unit === 'шт') return 'Количество, шт.';
    return 'Количество';
  }

  function priceLabelFor(unit) {
    if (unit === 'м²') return 'Цена за м², ₽';
    if (unit === 'шт.' || unit === 'шт') return 'Цена за шт., ₽';
    return 'Цена, ₽';
  }

  function enhanceServiceBuilder() {
    const card = document.getElementById('quickServiceCard');
    if (!card || card.dataset.v5 === '1') return;
    card.dataset.v5 = '1';
    card.classList.add('service-builder-v5');

    card.innerHTML = `
      <div class="service-builder-title">
        <div><strong>Добавить работу</strong><small>Выбери услугу — единица и стандартная цена подставятся сами.</small></div>
        <span class="service-step-badge">БЫСТРО</span>
      </div>
      <label class="service-main"><span>Услуга</span><select id="v5Service"><option value="">Выберите услугу</option></select></label>
      <div class="service-details">
        <label><span id="v5QtyLabel">Количество</span><input id="v5Qty" inputmode="decimal" enterkeyhint="done" placeholder="0" /></label>
        <label><span id="v5PriceLabel">Цена, ₽</span><input id="v5Price" inputmode="decimal" enterkeyhint="done" placeholder="0" /></label>
      </div>
      <button id="v5UseArea" class="area-fill-btn hidden" type="button"></button>
      <div class="service-summary">
        <div class="helper" id="v5ServiceHelper">Сначала выбери услугу.</div>
        <div class="sum" id="v5ServiceSum">0 ₽</div>
      </div>
      <div id="v5Duplicate" class="duplicate-note hidden"></div>
      <div class="service-actions">
        <button id="v5Add" class="btn gold" type="button">Добавить работу в КП</button>
        <button id="v5Custom" class="btn secondary" type="button">Своя услуга</button>
      </div>`;

    const select = card.querySelector('#v5Service');
    const qty = card.querySelector('#v5Qty');
    const price = card.querySelector('#v5Price');
    const qtyLabel = card.querySelector('#v5QtyLabel');
    const priceLabel = card.querySelector('#v5PriceLabel');
    const helper = card.querySelector('#v5ServiceHelper');
    const sum = card.querySelector('#v5ServiceSum');
    const areaBtn = card.querySelector('#v5UseArea');
    const duplicate = card.querySelector('#v5Duplicate');
    const presets = state.bootstrap?.presets || [];
    let selectedPreset = null;

    presets.forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      const suffix = Number(preset.price || 0) > 0 ? ` — ${money(preset.price)}/${preset.unit || 'усл.'}` : '';
      option.textContent = `${preset.name}${suffix}`;
      select.appendChild(option);
    });

    const updatePreview = () => {
      const unit = selectedPreset?.unit || 'усл.';
      qtyLabel.textContent = qtyLabelFor(unit);
      priceLabel.textContent = priceLabelFor(unit);
      const amount = round2(num(qty.value) * num(price.value));
      sum.textContent = money(amount);
      if (!selectedPreset) helper.textContent = 'Сначала выбери услугу.';
      else helper.textContent = `${selectedPreset.name} · ${unit}`;

      const area = fields.area.value;
      if (selectedPreset?.unit === 'м²' && num(area) > 0) {
        areaBtn.textContent = `Подставить площадь объекта: ${area} м²`;
        areaBtn.classList.remove('hidden');
      } else {
        areaBtn.classList.add('hidden');
      }

      const duplicateExists = selectedPreset && state.items.some((item) => String(item.name).trim().toLowerCase() === String(selectedPreset.name).trim().toLowerCase());
      duplicate.classList.toggle('hidden', !duplicateExists);
      duplicate.textContent = duplicateExists ? 'Такая работа уже есть в КП. Можно добавить ещё раз, если это отдельный этап.' : '';
    };

    select.addEventListener('change', () => {
      selectedPreset = select.value === '' ? null : presets[Number(select.value)];
      if (!selectedPreset) {
        qty.value = '';
        price.value = '';
        updatePreview();
        return;
      }
      const unit = selectedPreset.unit || 'усл.';
      price.value = Number(selectedPreset.price || 0) > 0 ? String(selectedPreset.price) : '';
      if (unit === 'усл.') qty.value = '1';
      else if (unit === 'м²' && num(fields.area.value) > 0) qty.value = fields.area.value;
      else qty.value = '';
      updatePreview();
    });

    [qty, price].forEach((el) => el.addEventListener('input', updatePreview));
    fields.area.addEventListener('input', updatePreview);

    areaBtn.addEventListener('click', () => {
      if (num(fields.area.value) <= 0) return;
      qty.value = fields.area.value;
      updatePreview();
      try { tg?.HapticFeedback?.selectionChanged(); } catch {}
    });

    card.querySelector('#v5Add').addEventListener('click', () => {
      if (!selectedPreset) { showToast('Выберите услугу', true); return; }
      if (num(qty.value) <= 0) { showToast('Укажите количество или площадь', true); return; }
      if (num(price.value) <= 0) { showToast('Укажите цену', true); return; }
      state.items.push({
        name: selectedPreset.name,
        unit: selectedPreset.unit || 'усл.',
        quantity: qty.value,
        price: price.value,
      });
      state.lastSaved = null;
      renderItems();
      try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}
      showToast('Работа добавлена в КП');
      select.value = '';
      selectedPreset = null;
      qty.value = '';
      price.value = '';
      updatePreview();
    });

    card.querySelector('#v5Custom').addEventListener('click', () => {
      state.items.push({ name: '', unit: 'усл.', quantity: 1, price: '' });
      state.lastSaved = null;
      renderItems();
      const input = itemsEl.lastElementChild?.querySelector('input[data-k="name"]');
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => input?.focus({ preventScroll: true }), 180);
    });

    const oldAddButton = document.getElementById('addItemBtn');
    if (oldAddButton) {
      const addButton = oldAddButton.cloneNode(true);
      oldAddButton.replaceWith(addButton);
      addButton.textContent = '+ Добавить работу';
      addButton.addEventListener('click', (event) => {
        event.preventDefault();
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    updatePreview();
  }

  function refreshBrandLogo() {
    const img = document.querySelector('.brand-logo-shell img');
    if (img && window.HOUSE_CLEANING_LOGO) img.src = window.HOUSE_CLEANING_LOGO;
  }

  const originalRenderQuotePagesV5 = renderQuotePages;
  renderQuotePages = async function renderQuotePagesWithExactLogo(quote) {
    const pages = await originalRenderQuotePagesV5(quote);
    if (!pages.length || !window.HOUSE_CLEANING_LOGO) return pages;
    try {
      const logo = await loadImage(window.HOUSE_CLEANING_LOGO);
      const first = pages[0];
      const ctx = first.getContext('2d');
      const M = 72;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(M - 4, 46, 390, 214);
      const targetW = 300;
      const targetH = targetW * logo.height / logo.width;
      ctx.drawImage(logo, M, 56, targetW, targetH);
    } catch (error) {
      console.error('Logo render failed', error);
    }
    return pages;
  };

  function stabilizeDateControl() {
    const date = fields.issue_date;
    if (!date) return;
    date.style.width = '100%';
    date.style.maxWidth = '100%';
    date.style.minWidth = '0';
  }

  async function install() {
    injectRegionPicker();
    stabilizeDateControl();
    for (let i = 0; i < 100 && !state.bootstrap; i += 1) await sleep(40);
    for (let i = 0; i < 50 && !document.getElementById('quickServiceCard'); i += 1) await sleep(40);
    injectRegionPicker();
    enhanceServiceBuilder();
    refreshBrandLogo();
    if (fields.address.value) {
      regionSelect.value = detectRegion(fields.address.value);
      fields.address.value = cleanAddress(fields.address.value);
    }
  }

  install().catch((error) => console.error('KP UX v5 failed', error));
})();
