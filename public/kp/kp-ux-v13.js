(() => {
  const outgoingInput = document.getElementById('outgoingNumber');
  if (!outgoingInput) return;

  function parseNumber(value) {
    const match = String(value ?? '').match(/\d+/);
    return match ? Math.max(1, Math.floor(Number(match[0]) || 0)) : '';
  }

  function syncBadge() {
    const value = parseNumber(outgoingInput.value);
    const badge = document.getElementById('quoteNumberBadge');
    if (badge) badge.textContent = value ? `Исх. № ${value}` : 'Исх. № —';
  }

  const previousBuildPayload = buildPayload;
  buildPayload = function buildPayloadWithOutgoingNumber() {
    return {
      ...previousBuildPayload(),
      outgoing_number: parseNumber(outgoingInput.value),
    };
  };

  const previousResetForm = resetForm;
  resetForm = async function resetFormWithOutgoingNumber() {
    const result = await previousResetForm();
    outgoingInput.value = parseNumber(state.bootstrap?.defaults?.quote_number) || '';
    syncBadge();
    return result;
  };

  const previousFillForm = fillForm;
  fillForm = function fillFormWithOutgoingNumber(quote, options = {}) {
    previousFillForm(quote, options);
    if (options.copy) outgoingInput.value = parseNumber(state.bootstrap?.defaults?.quote_number) || '';
    else outgoingInput.value = parseNumber(quote?.quote_number) || '';
    syncBadge();
  };

  const previousSaveQuote = saveQuote;
  saveQuote = async function saveQuoteWithOutgoingNumber(silent = false) {
    const quote = await previousSaveQuote(silent);
    outgoingInput.value = parseNumber(quote?.quote_number) || outgoingInput.value;
    syncBadge();
    return quote;
  };

  outgoingInput.addEventListener('input', () => {
    outgoingInput.value = String(outgoingInput.value || '').replace(/[^0-9]/g, '').slice(0, 6);
    state.lastSaved = null;
    syncBadge();
  });

  outgoingInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      outgoingInput.blur();
    }
  });

  syncBadge();

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/kp/kp-ux-v14.css?v=18';
  document.head.appendChild(css);

  const script = document.createElement('script');
  script.src = '/kp/kp-ux-v14.js?v=18';
  script.onload = () => {
    const stable = document.createElement('script');
    stable.src = '/kp/kp-stable-v17.js?v=18';
    stable.onload = () => {
      const mobile = document.createElement('script');
      mobile.src = '/kp/kp-mobile-v18.js?v=18';
      document.head.appendChild(mobile);
    };
    document.head.appendChild(stable);
  };
  document.head.appendChild(script);
})();
