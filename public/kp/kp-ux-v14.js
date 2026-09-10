(() => {
  const PAYMENT_OPTIONS = [20, 30, 50, 100];
  const DRAFT_PREFIX = 'hc:kp:draft:v16:';
  let draftReady = false;
  let suspendDraft = false;
  let draftTimer = null;
  let paymentButtons = [];

  function paymentText(percent) {
    if (Number(percent) === 100) return 'Оплата производится по счету в 100% размере.';
    return `Предоплата ${percent}%. Остаток — после выполнения работ.`;
  }

  function currentUserId() {
    return String(tg?.initDataUnsafe?.user?.id || state.bootstrap?.admin?.id || 'admin');
  }

  function draftKey() {
    return `${DRAFT_PREFIX}${currentUserId()}`;
  }

  function cleanNumber(value) {
    const match = String(value || '').match(/\d+/);
    return match ? match[0] : '';
  }

  function configureInterface() {
    const saveButton = document.getElementById('saveBtn');
    if (saveButton) saveButton.remove();

    const addressLabel = fields.address?.closest('label');
    if (addressLabel) addressLabel.remove();
    if (fields.address) fields.address.value = '';

    const notesLabel = fields.notes?.closest('label');
    if (notesLabel) notesLabel.remove();
    if (fields.notes) fields.notes.value = '';

    const paymentLabel = fields.payment_terms?.closest('label');
    if (paymentLabel) paymentLabel.remove();

    const servicesHeading = [...document.querySelectorAll('.section-head h2')]
      .find((node) => /работы и расч/i.test(node.textContent || ''));
    if (servicesHeading) servicesHeading.textContent = 'Услуги и расчёт';

    const addItemButton = document.getElementById('addItemBtn');
    if (addItemButton) addItemButton.textContent = '+ Добавить услугу';

    const builderTitle = document.querySelector('#quickServiceCard .service-builder-title strong');
    if (builderTitle) builderTitle.textContent = 'Добавить услугу в смету';

    installPaymentChooser();
  }

  function installPaymentChooser() {
    const input = fields.prepayment_percent;
    const row = input?.closest('.totals-card > div');
    if (!input || !row || row.dataset.quickPayment === '1') return;
    row.dataset.quickPayment = '1';
    row.classList.add('quick-payment-row');

    const title = row.querySelector('span');
    if (title) title.textContent = 'Условия оплаты';
    input.classList.add('quick-payment-hidden');
    input.setAttribute('aria-hidden', 'true');

    const chooser = document.createElement('div');
    chooser.className = 'quick-payment-chooser';
    chooser.setAttribute('role', 'group');
    chooser.setAttribute('aria-label', 'Выберите процент предоплаты');

    PAYMENT_OPTIONS.forEach((percent) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-payment-button';
      button.dataset.percent = String(percent);
      button.textContent = `${percent}%`;
      button.addEventListener('click', () => setPayment(percent, true));
      chooser.appendChild(button);
      paymentButtons.push(button);
    });

    const amount = row.querySelector('strong');
    row.insertBefore(chooser, amount || null);
    syncPaymentButtons();
  }

  function setPayment(percent, fromUser = false) {
    const normalized = PAYMENT_OPTIONS.includes(Number(percent)) ? Number(percent) : 0;
    fields.prepayment_percent.value = normalized ? String(normalized) : '0';
    fields.payment_terms.value = normalized ? paymentText(normalized) : '';
    state.lastSaved = null;
    syncPaymentButtons();
    updateTotals();
    if (fromUser) scheduleDraftSave();
  }

  function syncPaymentButtons() {
    const selected = Number(fields.prepayment_percent?.value || 0);
    paymentButtons.forEach((button) => button.classList.toggle('active', Number(button.dataset.percent) === selected));
  }

  const previousBuildPayload = buildPayload;
  buildPayload = function buildPayloadV16() {
    const payload = previousBuildPayload();
    const percent = Number(fields.prepayment_percent.value || 0);
    return {
      ...payload,
      address: '',
      notes: '',
      prepayment_percent: percent,
      payment_terms: PAYMENT_OPTIONS.includes(percent) ? paymentText(percent) : '',
    };
  };

  validateClientPayload = function validateClientPayloadV16(payload) {
    if (!Array.isArray(payload.items) || !payload.items.some((item) => item.name && num(item.quantity) >= 0 && num(item.price) >= 0)) {
      throw new Error('Добавьте хотя бы одну услугу');
    }
    if (calcLocal().total <= 0) throw new Error('Итоговая стоимость должна быть больше нуля');
    if (!PAYMENT_OPTIONS.includes(Number(payload.prepayment_percent))) {
      throw new Error('Выберите условия оплаты: 20%, 30%, 50% или 100%');
    }
  };

  const previousResetForm = resetForm;
  resetForm = async function resetFormV16() {
    const result = await previousResetForm();
    fields.address.value = '';
    fields.notes.value = '';
    setPayment(Number(state.bootstrap?.defaults?.prepayment_percent || 0), false);
    return result;
  };

  const previousFillForm = fillForm;
  fillForm = function fillFormV16(quote, options = {}) {
    previousFillForm({ ...quote, address: '', notes: '' }, options);
    fields.address.value = '';
    fields.notes.value = '';
    const percent = PAYMENT_OPTIONS.includes(Number(quote?.prepayment_percent)) ? Number(quote.prepayment_percent) : 0;
    setPayment(percent, false);
    scheduleDraftSave();
  };

  previewCurrent = async function previewCurrentV16() {
    const payload = buildPayload();
    validateClientPayload(payload);
    const data = await api('/api/kp/preview', { method: 'POST', body: JSON.stringify(payload) });
    const quote = { ...data.quote, address: '', notes: '' };
    const pages = await renderQuotePages(quote);
    const first = pages[0];
    previewCanvas.width = first.width;
    previewCanvas.height = first.height;
    previewCanvas.getContext('2d').drawImage(first, 0, 0);
    previewModal.classList.remove('hidden');
    if (pages.length > 1) showToast(`КП занимает ${pages.length} стр. В PDF попадут все страницы.`);
  };

  function buildPdfFileName(quote) {
    const number = cleanNumber(quote?.quote_number) || 'КП';
    const date = dateRu(quote?.issue_date).replace(/\./g, '-');
    const customer = safeFileName(quote?.client_name || quote?.client_company || 'House_Cleaning');
    return `КП_Исх_${number}_${date}_${customer}.pdf`;
  }

  async function sharePdf(file) {
    if (typeof navigator.share !== 'function') return 'fallback';
    try {
      if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) return 'fallback';
      await navigator.share({
        files: [file],
        title: 'Коммерческое предложение House Cleaning',
        text: 'PDF коммерческого предложения House Cleaning',
      });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      console.warn('Native PDF share failed', error);
      return 'fallback';
    }
  }

  downloadCurrentPdf = async function downloadCurrentPdfV16() {
    const payload = buildPayload();
    validateClientPayload(payload);

    // Сначала фиксируем номер и данные, но в историю КП пока не попадает.
    const data = await api('/api/kp/save', { method: 'POST', body: JSON.stringify(payload) });
    const quote = { ...data.quote, address: '', notes: '' };
    state.currentId = quote.id;
    state.currentNumber = quote.quote_number;
    state.lastSaved = quote;
    const badge = document.getElementById('quoteNumberBadge');
    if (badge) badge.textContent = quote.quote_number;
    const outgoing = document.getElementById('outgoingNumber');
    if (outgoing) outgoing.value = cleanNumber(quote.quote_number);

    const pages = await renderQuotePages(quote);
    const blob = canvasesToPdf(pages);
    const fileName = buildPdfFileName(quote);
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const shareResult = await sharePdf(file);

    if (shareResult === 'cancelled') {
      showToast('Сохранение PDF отменено. Данные остались в форме.');
      scheduleDraftSave();
      return;
    }

    if (shareResult === 'fallback') {
      downloadBlob(blob, fileName);
    }

    await api('/api/kp/publish', { method: 'POST', body: JSON.stringify({ id: quote.id }) });
    clearDraft();
    suspendDraft = true;
    try {
      previewModal.classList.add('hidden');
      await resetForm();
    } finally {
      suspendDraft = false;
      clearDraft();
    }
    await loadHistory();
    showToast(`PDF ${quote.quote_number} готов. Начато новое КП.`);
  };

  function collectDraft() {
    const payload = buildPayload();
    return {
      ...payload,
      current_id: state.currentId || null,
      current_number: state.currentNumber || '',
      saved_at: new Date().toISOString(),
    };
  }

  function saveDraftNow() {
    if (!draftReady || suspendDraft) return;
    try {
      const draft = collectDraft();
      const hasContent = Boolean(
        draft.client_name || draft.client_company || draft.area || draft.items?.length ||
        draft.discount_percent || draft.equipment || Number(draft.prepayment_percent || 0)
      );
      if (!hasContent) {
        localStorage.removeItem(draftKey());
        return;
      }
      localStorage.setItem(draftKey(), JSON.stringify(draft));
    } catch (error) {
      console.warn('Draft save failed', error);
    }
  }

  function scheduleDraftSave() {
    if (!draftReady || suspendDraft) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 180);
  }

  function clearDraft() {
    clearTimeout(draftTimer);
    try { localStorage.removeItem(draftKey()); } catch {}
  }

  function readDraft() {
    try {
      const raw = localStorage.getItem(draftKey());
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function restoreDraft(draft) {
    if (!draft || typeof draft !== 'object') return false;
    suspendDraft = true;
    try {
      state.currentId = draft.current_id || null;
      state.currentNumber = draft.current_number || (draft.outgoing_number ? `Исх. № ${draft.outgoing_number}` : state.currentNumber);
      fields.issue_date.value = draft.issue_date || fields.issue_date.value;
      fields.valid_days.value = draft.valid_days || fields.valid_days.value || 14;
      fields.client_name.value = draft.client_name || '';
      fields.client_company.value = draft.client_company || '';
      fields.address.value = '';
      fields.object_type.value = draft.object_type || fields.object_type.value || 'Коммерческое помещение';
      fields.area.value = draft.area ?? '';
      fields.title.value = draft.title || fields.title.value;
      fields.discount_percent.value = draft.discount_percent ?? 0;
      fields.duration.value = draft.duration || fields.duration.value || '1–2 дня';
      fields.vat_label.value = draft.vat_label || fields.vat_label.value || 'Без НДС';
      fields.notes.value = '';
      state.items = Array.isArray(draft.items) ? draft.items.map((item) => ({ ...item })) : [];

      const outgoing = document.getElementById('outgoingNumber');
      if (outgoing && draft.outgoing_number) outgoing.value = cleanNumber(draft.outgoing_number);
      const equipment = document.getElementById('equipment');
      if (equipment && typeof draft.equipment === 'string') equipment.value = draft.equipment;
      setPayment(Number(draft.prepayment_percent || 0), false);
      renderItems();
      updateTotals();
      const badge = document.getElementById('quoteNumberBadge');
      if (badge && outgoing?.value) badge.textContent = `Исх. № ${outgoing.value}`;
      return true;
    } finally {
      suspendDraft = false;
    }
  }

  function hookDraftEvents() {
    document.addEventListener('input', scheduleDraftSave, true);
    document.addEventListener('change', scheduleDraftSave, true);
    document.addEventListener('click', (event) => {
      if (event.target.closest('#items, #presetRow, #quickServiceCard, #addItemBtn')) {
        setTimeout(scheduleDraftSave, 0);
      }
    }, true);
    window.addEventListener('pagehide', saveDraftNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveDraftNow();
    });
  }

  async function install() {
    configureInterface();
    hookDraftEvents();

    for (let i = 0; i < 160 && !state.bootstrap; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    for (let i = 0; i < 80 && !document.getElementById('equipment'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    configureInterface();
    const draft = readDraft();
    if (draft) restoreDraft(draft);
    else setPayment(Number(state.bootstrap?.defaults?.prepayment_percent || 0), false);
    draftReady = true;

    const newQuoteButton = document.getElementById('newQuoteBtn');
    newQuoteButton?.addEventListener('click', () => setTimeout(() => {
      clearDraft();
      saveDraftNow();
    }, 80));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once: true });
  } else {
    install().catch(console.error);
  }
})();
