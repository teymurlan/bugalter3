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
    if (options.copy) {
      outgoingInput.value = parseNumber(state.bootstrap?.defaults?.quote_number) || '';
    } else {
      outgoingInput.value = parseNumber(quote?.quote_number) || '';
    }
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
  css.href = '/kp/kp-ux-v14.css?v=16';
  document.head.appendChild(css);

  const firstFiveCss = document.createElement('link');
  firstFiveCss.rel = 'stylesheet';
  firstFiveCss.href = '/kp/kp-first5-v1.css?v=1';
  document.head.appendChild(firstFiveCss);

  const stepsCss = document.createElement('link');
  stepsCss.rel = 'stylesheet';
  stepsCss.href = '/kp/kp-steps7-9-v1.css?v=1';
  document.head.appendChild(stepsCss);

  const flowCss = document.createElement('link');
  flowCss.rel = 'stylesheet';
  flowCss.href = '/kp/kp-flow-v2.css?v=2';
  document.head.appendChild(flowCss);

  const polishCss = document.createElement('link');
  polishCss.rel = 'stylesheet';
  polishCss.href = '/kp/kp-polish-v3.css?v=3';
  document.head.appendChild(polishCss);

  const combinedCss = document.createElement('link');
  combinedCss.rel = 'stylesheet';
  combinedCss.href = '/kp/kp-service-combined-v1.css?v=1';
  document.head.appendChild(combinedCss);

  const mobileFixCss = document.createElement('link');
  mobileFixCss.rel = 'stylesheet';
  mobileFixCss.href = '/kp/kp-mobile-fixes-v4.css?v=1';
  document.head.appendChild(mobileFixCss);

  const script = document.createElement('script');
  script.src = '/kp/kp-ux-v14.js?v=16';
  script.onload = () => {
    const firstFive = document.createElement('script');
    firstFive.src = '/kp/kp-first5-v1.js?v=1';
    firstFive.onload = () => {
      const step6 = document.createElement('script');
      step6.src = '/kp/kp-step6-v1.js?v=1';
      step6.onload = () => {
        const steps79 = document.createElement('script');
        steps79.src = '/kp/kp-steps7-9-v1.js?v=1';
        steps79.onload = () => {
          const flow = document.createElement('script');
          flow.src = '/kp/kp-flow-v2.js?v=2';
          flow.onload = () => {
            const guard = document.createElement('script');
            guard.src = '/kp/kp-flow-guard-v2.js?v=2';
            guard.onload = () => {
              const polish = document.createElement('script');
              polish.src = '/kp/kp-polish-v3.js?v=3';
              polish.onload = () => {
                const combined = document.createElement('script');
                combined.src = '/kp/kp-service-combined-v1.js?v=1';
                combined.onload = () => {
                  const mobileFix = document.createElement('script');
                  mobileFix.src = '/kp/kp-mobile-fixes-v4.js?v=1';
                  document.head.appendChild(mobileFix);
                };
                document.head.appendChild(combined);
              };
              document.head.appendChild(polish);
            };
            document.head.appendChild(guard);
          };
          document.head.appendChild(flow);
        };
        document.head.appendChild(steps79);
      };
      document.head.appendChild(step6);
    };
    document.head.appendChild(firstFive);
  };
  document.head.appendChild(script);
})();
