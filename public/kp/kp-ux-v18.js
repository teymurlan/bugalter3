(() => {
  const DEFAULT_EQUIPMENT = [
    'Моющий пылесос Karcher WD 3',
    'Пылесос для сухой уборки Karcher WD 6',
    'Пароочиститель Karcher SC 4',
  ];

  function fixAllServiceLabels() {
    const replacements = [
      [/Добавить работу в смету/gi, 'Добавить услугу в смету'],
      [/Добавить работу/gi, 'Добавить услугу'],
      [/Выберите работу/gi, 'Выберите услугу'],
      [/Другие работы/gi, 'Другие услуги'],
      [/отдельных работ/gi, 'отдельных услуг'],
    ];
    document.querySelectorAll('button,strong,small,option,optgroup,label,span,h2').forEach((el) => {
      if (el.children.length && !['OPTION','OPTGROUP'].includes(el.tagName)) return;
      let text = el.textContent || '';
      let next = text;
      replacements.forEach(([from,to]) => { next = next.replace(from,to); });
      if (next !== text) el.textContent = next;
    });
    const add = document.getElementById('addItemBtn');
    if (add) add.textContent = '+ Добавить услугу';
  }

  function installEquipmentChooser() {
    const field = document.getElementById('equipment');
    if (!field || document.getElementById('equipmentChooser')) return;
    const card = field.closest('.commercial-equipment-card');
    if (!card) return;
    field.hidden = true;
    field.closest('label')?.querySelector('.commercial-field-title')?.remove();
    card.querySelector('.commercial-field-hint')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'equipmentChooser';
    wrap.className = 'equipment-chooser';
    wrap.innerHTML = `<div class="equipment-title">Используемое оборудование</div>
      <div class="equipment-hint">Отметьте только то оборудование, которое будет использоваться</div>
      <div class="equipment-options"></div>
      <label class="equipment-custom">Дополнительное оборудование
        <textarea id="equipmentCustom" rows="2" placeholder="Например: роторная машина, стремянка…"></textarea>
      </label>`;
    card.prepend(wrap);
    const options = wrap.querySelector('.equipment-options');
    DEFAULT_EQUIPMENT.forEach((name, i) => {
      const label = document.createElement('label');
      label.className = 'equipment-option';
      label.innerHTML = `<input type="checkbox" value="${name}" id="eq${i}"><span class="equipment-check">✓</span><span>${name}</span>`;
      options.appendChild(label);
    });

    const custom = wrap.querySelector('#equipmentCustom');
    const syncFromField = () => {
      const lines = String(field.value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = lines.includes(cb.value); });
      custom.value = lines.filter(x => !DEFAULT_EQUIPMENT.includes(x)).join('\n');
    };
    const syncToField = () => {
      const chosen = [...wrap.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
      const extra = custom.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      field.value = [...chosen, ...extra].join('\n');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    wrap.addEventListener('change', syncToField);
    custom.addEventListener('input', syncToField);
    syncFromField();

    const observer = new MutationObserver(() => {});
    observer.observe(field, { attributes: true });
    window.__hcSyncEquipmentChooser = syncFromField;
  }

  // Предоплата полностью необязательна.
  validateClientPayload = function validateClientPayloadV18(payload) {
    const goodItems = Array.isArray(payload.items) && payload.items.filter(item => item.name && num(item.quantity) >= 0 && num(item.price) >= 0);
    if (!goodItems?.length) {
      const err = new Error('Добавьте хотя бы одну услугу'); err.field = 'services'; throw err;
    }
    if (calcLocal().total <= 0) {
      const err = new Error('Укажите количество и цену услуги. Итоговая стоимость должна быть больше нуля'); err.field = 'services'; throw err;
    }
  };

  const oldBuildPayload = buildPayload;
  buildPayload = function buildPayloadV18() {
    const payload = oldBuildPayload();
    const percent = Number(fields.prepayment_percent?.value || 0);
    if (!percent) {
      payload.prepayment_percent = 0;
      payload.payment_terms = '';
    }
    return payload;
  };

  // Если предоплаты нет, не печатаем строку «Условия оплаты» вообще.
  const previousFinalBlock = drawFinalBlock;
  drawFinalBlock = function drawFinalBlockV18(ctx, quote, M, W, H, y) {
    if (Number(quote?.prepayment_percent || 0) > 0 && quote?.payment_terms) {
      return previousFinalBlock(ctx, quote, M, W, H, y);
    }
    const patched = { ...quote, payment_terms: '' };
    const originalWrap = wrapText;
    let hidden = false;
    wrapText = function(ctx2, text, maxWidth, font) {
      if (String(text).startsWith('Условия оплаты:')) { hidden = true; return []; }
      return originalWrap(ctx2, text, maxWidth, font);
    };
    try { return previousFinalBlock(ctx, patched, M, W, H, y); }
    finally { wrapText = originalWrap; }
  };

  function showValidationError(error) {
    const message = error?.message || 'Проверьте заполнение КП';
    let box = document.getElementById('kpValidationBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'kpValidationBox';
      box.className = 'kp-validation-box hidden';
      box.setAttribute('role', 'alert');
      document.body.appendChild(box);
    }
    box.innerHTML = `<strong>Не хватает данных</strong><span>${message}</span><button type="button">Показать</button>`;
    box.classList.remove('hidden');
    const target = error?.field === 'services' ? (document.getElementById('quickServiceCard') || document.getElementById('items')) : document.querySelector('.editor-panel');
    const go = () => {
      box.classList.add('hidden');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.classList.add('kp-error-focus');
      setTimeout(() => target?.classList.remove('kp-error-focus'), 1800);
    };
    box.querySelector('button').onclick = go;
    go();
    setTimeout(() => box.classList.add('hidden'), 7000);
  }

  function wrapActionButton(id, actionName) {
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.validationV18) return;
    btn.dataset.validationV18 = '1';
    btn.addEventListener('click', () => {
      setTimeout(() => {
        try { validateClientPayload(buildPayload()); }
        catch (e) { showValidationError(e); }
      }, 0);
    }, true);
  }

  function upgradeBottomNav() {
    const nav = document.getElementById('kpBottomNav');
    if (!nav || nav.dataset.v18) return;
    nav.dataset.v18 = '1';
    const resetOld = document.getElementById('resetQuoteBtn');
    if (resetOld) resetOld.remove();
    nav.innerHTML = `
      <button type="button" data-nav="new"><span>＋</span><b>Новое</b></button>
      <button type="button" data-nav="history"><span>▤</span><b>История</b></button>
      <button type="button" data-nav="preview"><span>⌕</span><b>Просмотр</b></button>
      <button type="button" data-nav="reset" class="nav-reset"><span>↺</span><b>Сброс</b></button>`;
    const buttons = [...nav.querySelectorAll('button')];
    const activate = (name) => buttons.forEach(b => b.classList.toggle('active', b.dataset.nav === name));
    nav.querySelector('[data-nav="new"]').onclick = () => { activate('new'); document.getElementById('newQuoteBtn')?.click(); window.scrollTo({top:0,behavior:'smooth'}); };
    nav.querySelector('[data-nav="history"]').onclick = () => { activate('history'); document.querySelector('.history-panel')?.scrollIntoView({behavior:'smooth',block:'start'}); };
    nav.querySelector('[data-nav="preview"]').onclick = () => { activate('preview'); document.getElementById('previewBtn')?.click(); };
    nav.querySelector('[data-nav="reset"]').onclick = () => { activate('reset'); openResetConfirm(); };
    activate('new');

    const sections = [
      ['new', document.querySelector('.editor-panel')],
      ['history', document.querySelector('.history-panel')],
    ];
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        const best = entries.filter(e => e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
        if (!best) return;
        const found = sections.find(([,el]) => el === best.target);
        if (found) activate(found[0]);
      }, { threshold:[0.25,0.55] });
      sections.forEach(([,el]) => el && io.observe(el));
    }
  }

  function openResetConfirm() {
    const modal = document.getElementById('resetQuoteModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.querySelector('[data-reset-no]')?.focus();
  }

  const oldResetForm = resetForm;
  resetForm = async function resetFormV18() {
    const result = await oldResetForm();
    if (fields.prepayment_percent) fields.prepayment_percent.value = '0';
    if (fields.payment_terms) fields.payment_terms.value = '';
    document.querySelectorAll('.quick-payment-button').forEach(b => b.classList.remove('active'));
    setTimeout(() => window.__hcSyncEquipmentChooser?.(), 0);
    updateTotals();
    return result;
  };

  const oldFillForm = fillForm;
  fillForm = function fillFormV18(quote, options = {}) {
    oldFillForm(quote, options);
    setTimeout(() => window.__hcSyncEquipmentChooser?.(), 0);
  };

  async function install() {
    for (let i=0;i<160;i++) {
      fixAllServiceLabels();
      installEquipmentChooser();
      upgradeBottomNav();
      if (document.getElementById('equipmentChooser') && document.getElementById('kpBottomNav')) break;
      await new Promise(r=>setTimeout(r,25));
    }
    fixAllServiceLabels();
    wrapActionButton('previewBtn'); wrapActionButton('pdfBtn'); wrapActionButton('modalPdfBtn');
    const observer = new MutationObserver(() => fixAllServiceLabels());
    observer.observe(document.body,{childList:true,subtree:true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',()=>install().catch(console.error),{once:true});
  else install().catch(console.error);
})();