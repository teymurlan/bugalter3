(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function fixPresetGroupLabels() {
    document.querySelectorAll('.kp-flow-preset-group-title').forEach((node) => {
      const text = String(node.textContent || '').trim();
      if (/^Отдельные\s+услугы$/i.test(text)) node.textContent = 'Отдельные услуги';
      if (/^Другие\s+услугы$/i.test(text)) node.textContent = 'Другие услуги';
    });
  }

  async function install() {
    for (let i = 0; i < 120 && !document.getElementById('kpFlowRoot'); i += 1) await sleep(25);
    fixPresetGroupLabels();

    if (window.__kpFlowPdfGuardInstalled) return;
    window.__kpFlowPdfGuardInstalled = true;
    const originalDownload = downloadCurrentPdf;

    downloadCurrentPdf = async function guardedDownloadCurrentPdf(...args) {
      const result = await originalDownload(...args);

      // Стабильный v16 при отмене нативного Share оставляет текущий документ
      // в форме, а при успешном сохранении вызывает resetForm() и currentId становится null.
      // Превращаем отмену в контролируемое исключение, чтобы экран «Проверка» не
      // перескакивал на начало и введённые данные оставались на месте.
      if (state.currentId && state.lastSaved?.id === state.currentId) {
        const error = new Error('Сохранение PDF отменено. Данные остались без изменений.');
        error.code = 'KP_PDF_CANCELLED';
        throw error;
      }
      return result;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once: true });
  } else {
    install().catch(console.error);
  }
})();
