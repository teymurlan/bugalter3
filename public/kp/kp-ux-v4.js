(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  renderItems = function renderItemsV4() {
    itemsEl.innerHTML = '';
    if (!state.items.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.innerHTML = '<strong style="color:#ddd">Пока нет работ</strong><br>Выберите услугу выше — площадь и цена подставятся автоматически.';
      itemsEl.appendChild(empty);
      updateTotals();
      return;
    }

    state.items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `
        <div class="item-card-head">
          <span class="item-index">Позиция ${index + 1}</span>
          <button class="item-remove-text" type="button">Удалить</button>
        </div>
        <label class="item-field item-name-row"><span>Наименование услуги</span><input data-k="name" enterkeyhint="done" value="${escapeAttr(item.name)}" placeholder="Например, уборка после ремонта" /></label>
        <div class="item-grid">
          <label class="item-field"><span>Ед.</span><input data-k="unit" enterkeyhint="done" value="${escapeAttr(item.unit)}" /></label>
          <label class="item-field"><span>Кол-во</span><input data-k="quantity" enterkeyhint="done" inputmode="decimal" value="${escapeAttr(item.quantity)}" placeholder="0" /></label>
          <label class="item-field"><span>Цена, ₽</span><input data-k="price" enterkeyhint="done" inputmode="decimal" value="${escapeAttr(item.price)}" placeholder="0" /></label>
        </div>
        <div class="item-card-total"><span>Сумма позиции</span><strong class="item-total">0 ₽</strong></div>`;

      row.querySelectorAll('input[data-k]').forEach((input) => {
        input.addEventListener('input', () => {
          state.items[index][input.dataset.k] = input.value;
          state.lastSaved = null;
          updateTotals();
        });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          }
        });
      });

      row.querySelector('.item-remove-text').addEventListener('click', () => {
        state.items.splice(index, 1);
        state.lastSaved = null;
        renderItems();
      });
      itemsEl.appendChild(row);
    });
    updateTotals();
  };

  function injectBrandHeader() {
    const topbar = document.querySelector('.topbar');
    if (!topbar || topbar.querySelector('.brand-lockup')) return;
    const original = topbar.firstElementChild;
    if (!original) return;
    const wrap = document.createElement('div');
    wrap.className = 'brand-lockup';
    wrap.innerHTML = `
      <div class="brand-logo-shell"><img alt="House Cleaning" /></div>
      <div class="brand-copy"><div class="eyebrow">HOUSE CLEANING</div><h1>Коммерческие предложения</h1></div>`;
    const img = wrap.querySelector('img');
    if (window.HOUSE_CLEANING_LOGO) img.src = window.HOUSE_CLEANING_LOGO;
    original.replaceWith(wrap);
  }

  function injectKeyboardDone() {
    if (document.getElementById('keyboardDoneBar')) return;
    const bar = document.createElement('div');
    bar.id = 'keyboardDoneBar';
    bar.className = 'keyboard-bar hidden';
    bar.innerHTML = '<span>Ввод данных</span><button type="button">Готово</button>';
    document.body.appendChild(bar);
    const done = bar.querySelector('button');

    const isTypingField = (el) => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'date' && el.type !== 'checkbox' && el.type !== 'radio');
    let hideTimer = null;
    document.addEventListener('focusin', (event) => {
      if (!isTypingField(event.target)) return;
      clearTimeout(hideTimer);
      bar.classList.remove('hidden');
      document.body.classList.add('keyboard-open');
    });
    document.addEventListener('focusout', () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (isTypingField(document.activeElement)) return;
        bar.classList.add('hidden');
        document.body.classList.remove('keyboard-open');
      }, 120);
    });
    done.addEventListener('pointerdown', (event) => event.preventDefault());
    done.addEventListener('click', () => {
      const active = document.activeElement;
      if (active && typeof active.blur === 'function') active.blur();
      bar.classList.add('hidden');
      document.body.classList.remove('keyboard-open');
    });
  }

  function injectQuickService() {
    if (document.getElementById('quickServiceCard')) return;
    const anchor = document.getElementById('presetRow');
    if (!anchor) return;
    const card = document.createElement('div');
    card.id = 'quickServiceCard';
    card.className = 'quick-service-card';
    card.innerHTML = `
      <div class="quick-service-title"><strong>Быстро добавить работу</strong><span>1 шаг</span></div>
      <div class="quick-service-grid">
        <label class="quick-service-select-wrap"><span>Услуга</span><select id="quickServiceSelect"><option value="">Выберите услугу</option></select></label>
        <label><span>Ед.</span><input id="quickUnit" value="м²" readonly /></label>
        <label><span>Кол-во</span><input id="quickQty" inputmode="decimal" enterkeyhint="done" placeholder="0" /></label>
        <label><span>Цена, ₽</span><input id="quickPrice" inputmode="decimal" enterkeyhint="done" placeholder="0" /></label>
      </div>
      <div class="quick-service-actions">
        <button id="quickAddService" class="btn gold quick-service-add" type="button">Добавить в КП</button>
        <button id="quickCustomService" class="btn secondary quick-service-custom" type="button">Своя услуга</button>
      </div>`;
    anchor.before(card);

    const select = card.querySelector('#quickServiceSelect');
    const unit = card.querySelector('#quickUnit');
    const qty = card.querySelector('#quickQty');
    const price = card.querySelector('#quickPrice');
    const presets = state.bootstrap?.presets || [];
    presets.forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = preset.name;
      select.appendChild(option);
    });

    select.addEventListener('change', () => {
      if (select.value === '') return;
      const preset = presets[Number(select.value)];
      if (!preset) return;
      unit.value = preset.unit || 'усл.';
      price.value = Number(preset.price || 0) > 0 ? String(preset.price) : '';
      if (preset.unit === 'усл.') qty.value = '1';
      else if (preset.unit === 'м²' && fields.area.value) qty.value = fields.area.value;
      else qty.value = '';
      setTimeout(() => (qty.value ? price : qty).focus(), 30);
    });

    card.querySelector('#quickAddService').addEventListener('click', () => {
      if (select.value === '') {
        showToast('Сначала выберите услугу', true);
        select.focus();
        return;
      }
      const preset = presets[Number(select.value)];
      const q = num(qty.value);
      const p = num(price.value);
      if (q <= 0) { showToast('Укажите количество', true); qty.focus(); return; }
      if (p <= 0) { showToast('Укажите цену', true); price.focus(); return; }
      state.items.push({ name: preset.name, unit: unit.value || preset.unit || 'усл.', quantity: qty.value, price: price.value });
      state.lastSaved = null;
      renderItems();
      const last = itemsEl.lastElementChild;
      if (last) { last.classList.add('service-flash'); last.scrollIntoView({ behavior:'smooth', block:'nearest' }); }
      select.value = '';
      unit.value = 'м²'; qty.value = ''; price.value = '';
      showToast('Услуга добавлена');
    });

    card.querySelector('#quickCustomService').addEventListener('click', () => {
      state.items.push({ name:'', unit:'усл.', quantity:1, price:'' });
      state.lastSaved = null;
      renderItems();
      const input = itemsEl.lastElementChild?.querySelector('input[data-k="name"]');
      input?.scrollIntoView({ behavior:'smooth', block:'center' });
      setTimeout(() => input?.focus(), 220);
    });

    const legacyAdd = document.getElementById('addItemBtn');
    if (legacyAdd) {
      legacyAdd.textContent = '+ Добавить работу';
      legacyAdd.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        card.scrollIntoView({ behavior:'smooth', block:'center' });
        setTimeout(() => select.focus(), 250);
      }, true);
    }
  }

  function stabilizeMobileInputs() {
    document.querySelectorAll('input:not([type="date"]), textarea').forEach((el) => {
      if (!el.getAttribute('enterkeyhint')) el.setAttribute('enterkeyhint', 'done');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type !== 'date') {
        event.preventDefault();
        target.blur();
      }
    });
  }

  const originalRenderQuotePages = renderQuotePages;
  renderQuotePages = async function renderQuotePagesV4(quote) {
    const pages = await originalRenderQuotePages(quote);
    if (!pages.length) return pages;
    const page = pages[pages.length - 1];
    const ctx = page.getContext('2d');
    const W = page.width;
    const H = page.height;
    const M = 72;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(M - 3, H - 144, 405, 68);
    ctx.fillRect(W - M - 360, H - 136, 360, 34);

    try {
      const logo = await loadImage(window.HOUSE_CLEANING_LOGO);
      if (logo) {
        const targetW = 190;
        const targetH = Math.min(108, targetW * logo.height / logo.width);
        ctx.drawImage(logo, M, H - 143, targetW, targetH);
      }
    } catch {}

    ctx.fillStyle = '#666';
    ctx.font = '15px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(quote.company?.email || '', W - M, H - 84);
    ctx.textAlign = 'left';
    return pages;
  };

  async function installWhenReady() {
    injectKeyboardDone();
    stabilizeMobileInputs();
    for (let i = 0; i < 80 && !state.bootstrap; i += 1) await sleep(50);
    injectBrandHeader();
    injectQuickService();
    renderItems();
  }

  installWhenReady().catch((error) => console.error('KP UX enhancement failed', error));
})();
