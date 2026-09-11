(() => {
  const DEFAULT_EQUIPMENT = [
    'Моющий пылесос Karcher WD 3',
    'Пылесос для сухой уборки Karcher WD 6',
    'Пароочиститель Karcher SC 4',
  ].join('\n');
  const DEFAULT_DURATION = '1–2 дня';
  let equipmentField = null;

  function ensureEquipmentField() {
    equipmentField = document.getElementById('equipment');
    if (equipmentField) return equipmentField;

    const durationGrid = fields?.duration?.closest('.grid');
    if (!durationGrid) return null;

    const card = document.createElement('div');
    card.className = 'commercial-equipment-card';
    card.innerHTML = `
      <label>
        <span class="commercial-field-title">Используемое оборудование</span>
        <textarea id="equipment" rows="4" enterkeyhint="done" placeholder="Каждая позиция с новой строки"></textarea>
      </label>
      <div class="commercial-field-hint">Этот список автоматически попадёт в коммерческое предложение. Его можно изменить для любого объекта.</div>`;
    durationGrid.after(card);
    equipmentField = card.querySelector('#equipment');
    equipmentField.addEventListener('input', () => { state.lastSaved = null; });
    return equipmentField;
  }

  const previousBuildPayloadV12 = buildPayload;
  buildPayload = function buildPayloadCommercial() {
    const payload = previousBuildPayloadV12();
    const field = ensureEquipmentField();
    payload.equipment = String(field?.value || '').trim();
    return payload;
  };

  const previousFillFormV12 = fillForm;
  fillForm = function fillFormCommercial(quote, options = {}) {
    previousFillFormV12(quote, options);
    const field = ensureEquipmentField();
    if (field) field.value = String(quote?.equipment || state.bootstrap?.defaults?.equipment || DEFAULT_EQUIPMENT);
  };

  const previousResetFormV12 = resetForm;
  resetForm = async function resetFormCommercial() {
    const result = await previousResetFormV12();
    const defaults = state.bootstrap?.defaults || {};
    const field = ensureEquipmentField();
    if (field) field.value = defaults.equipment || DEFAULT_EQUIPMENT;
    fields.duration.value = defaults.duration || DEFAULT_DURATION;
    if (defaults.object_type && [...fields.object_type.options].some((option) => option.value === defaults.object_type)) {
      fields.object_type.value = defaults.object_type;
    }
    if (defaults.title) fields.title.value = defaults.title;
    return result;
  };

  function groupCommercialServices() {
    const select = document.getElementById('v5Service');
    const presets = state.bootstrap?.presets || [];
    if (!select || !presets.length || select.dataset.commercialGrouped === '1') return false;

    select.dataset.commercialGrouped = '1';
    select.innerHTML = '<option value="">Выберите работу</option>';
    const groups = new Map();

    presets.forEach((preset, index) => {
      const groupName = preset.group || 'Другие работы';
      if (!groups.has(groupName)) {
        const group = document.createElement('optgroup');
        group.label = groupName;
        groups.set(groupName, group);
        select.appendChild(group);
      }
      const option = document.createElement('option');
      option.value = String(index);
      const suffix = Number(preset.price || 0) > 0 ? ` — ${money(preset.price)}/${preset.unit || 'усл.'}` : '';
      option.textContent = `${preset.name}${suffix}`;
      groups.get(groupName).appendChild(option);
    });

    const card = document.getElementById('quickServiceCard');
    const title = card?.querySelector('.service-builder-title strong');
    const subtitle = card?.querySelector('.service-builder-title small');
    const badge = card?.querySelector('.service-step-badge');
    if (title) title.textContent = 'Добавить работу в смету';
    if (subtitle) subtitle.textContent = 'Основные тарифы уже с ценой. Для отдельных работ укажи цену вручную.';
    if (badge) badge.textContent = 'КОММЕРЦИЯ';
    return true;
  }

  function equipmentLines(quote) {
    return String(quote?.equipment || DEFAULT_EQUIPMENT)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[•\-–—]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  function rub(value) {
    return money(value).replace(/\s*₽$/, ' руб.');
  }

  estimateFinalBlockHeight = function estimateCommercialFinalBlock(quote) {
    const equipment = equipmentLines(quote);
    const notesExtra = quote?.notes ? 90 : 0;
    return 500 + equipment.length * 28 + notesExtra;
  };

  drawFinalBlock = function drawCommercialFinalBlock(ctx, quote, M, W, H, y) {
    const width = W - M * 2;
    let cursor = y + 18;

    const totalH = 66;
    ctx.fillStyle = '#faf6e9';
    ctx.strokeStyle = '#c9a23f';
    ctx.lineWidth = 2;
    ctx.fillRect(M, cursor, width, totalH);
    ctx.strokeRect(M, cursor, width, totalH);
    ctx.fillStyle = '#2c2923';
    ctx.font = '19px Arial';
    ctx.fillText('Общая стоимость работ:', M + 18, cursor + 42);
    ctx.fillStyle = '#111';
    ctx.font = '700 27px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(rub(quote.total), W - M - 18, cursor + 43);
    ctx.textAlign = 'left';
    cursor += totalH + 20;

    ctx.fillStyle = '#222';
    ctx.font = '17px Arial';
    const vatText = String(quote.vat_label || '').toLowerCase().includes('без')
      ? 'Стоимость указана без НДС.'
      : String(quote.vat_label || '').trim();
    const words = `${quote.total_words || ''}${vatText ? ` ${vatText}` : ''}`.trim();
    const wordLines = wrapText(ctx, `Итого прописью: ${words}`, width - 24, '17px Arial');
    wordLines.forEach((line, index) => ctx.fillText(line, M + 12, cursor + index * 23));
    cursor += wordLines.length * 23 + 22;

    const equipment = equipmentLines(quote);
    if (equipment.length) {
      ctx.fillStyle = '#222';
      ctx.font = '700 18px Arial';
      ctx.fillText('Используемое оборудование для данных видов работ:', M + 12, cursor);
      cursor += 30;
      ctx.font = '17px Arial';
      for (const item of equipment) {
        const lines = wrapText(ctx, item, width - 54, '17px Arial');
        ctx.fillText('•', M + 14, cursor);
        lines.forEach((line, index) => ctx.fillText(line, M + 34, cursor + index * 22));
        cursor += Math.max(1, lines.length) * 22 + 3;
      }
      cursor += 12;
    }

    // При предоплате 0% не выводим строку об оплате вообще.
    const conditions = [
      ['Срок выполнения работ:', quote.duration || DEFAULT_DURATION],
      ...(Number(quote.prepayment_percent || 0) > 0 && String(quote.payment_terms || '').trim()
        ? [['Условия оплаты:', String(quote.payment_terms).trim()]]
        : []),
      ['Срок действия коммерческого предложения:', `до ${dateRu(quote.valid_until)} включительно.`],
    ];
    const conditionLines = conditions.map(([label, value]) => {
      ctx.font = '17px Arial';
      return wrapText(ctx, `${label} ${value}`, width - 48, '17px Arial');
    });
    const conditionH = 26 + conditionLines.reduce((sum, lines) => sum + Math.max(1, lines.length) * 25, 0) + 18;

    ctx.fillStyle = '#f7f7f7';
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 1;
    ctx.fillRect(M, cursor, width, conditionH);
    ctx.strokeRect(M, cursor, width, conditionH);
    let lineY = cursor + 31;
    ctx.fillStyle = '#333';
    ctx.font = '17px Arial';
    conditionLines.forEach((lines) => {
      lines.forEach((line, index) => ctx.fillText(line, M + 18, lineY + index * 25));
      lineY += Math.max(1, lines.length) * 25;
    });
    cursor += conditionH + 24;

    if (quote.notes) {
      ctx.fillStyle = '#8f6e2b';
      ctx.font = '700 14px Arial';
      ctx.fillText('ПРИМЕЧАНИЕ', M + 12, cursor);
      ctx.fillStyle = '#444';
      ctx.font = '16px Arial';
      const noteLines = wrapText(ctx, quote.notes, width - 24, '16px Arial').slice(0, 4);
      noteLines.forEach((line, index) => ctx.fillText(line, M + 12, cursor + 25 + index * 21));
      cursor += 30 + noteLines.length * 21 + 18;
    }

    ctx.fillStyle = '#333';
    ctx.font = '17px Arial';
    ctx.fillText('С уважением,', M + 12, cursor);
    cursor += 28;
    ctx.font = '700 17px Arial';
    ctx.fillText(quote.company?.name || 'HOUSE CLEANING', M + 12, cursor);
    cursor += 42;
    ctx.fillStyle = '#777';
    ctx.font = '15px Arial';
    ctx.fillText('HOUSE CLEANING — профессиональная уборка квартир, домов и коммерческих помещений.', M + 12, cursor);
  };

  const previousRenderQuotePagesV12 = renderQuotePages;
  renderQuotePages = async function renderCommercialQuotePages(quote) {
    const pages = await previousRenderQuotePagesV12(quote);
    pages.forEach((page) => {
      const ctx = page.getContext('2d');
      const W = page.width;
      const H = page.height;
      const M = 72;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(M - 4, H - 148, W - M * 2 + 8, 126);
      ctx.strokeStyle = '#c9a23f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(M, H - 126);
      ctx.lineTo(W - M, H - 126);
      ctx.stroke();
      ctx.fillStyle = '#666';
      ctx.font = '14px Arial';
      ctx.fillText('HOUSE CLEANING', M, H - 91);
      ctx.textAlign = 'right';
      ctx.fillText('housecleaningspb.ru', W - M, H - 91);
      ctx.textAlign = 'left';
    });
    return pages;
  };

  async function install() {
    ensureEquipmentField();
    for (let i = 0; i < 120 && !state.bootstrap; i += 1) await new Promise((resolve) => setTimeout(resolve, 35));
    for (let i = 0; i < 120 && !document.getElementById('v5Service'); i += 1) await new Promise((resolve) => setTimeout(resolve, 35));
    groupCommercialServices();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once: true });
  else install().catch(console.error);
})();
