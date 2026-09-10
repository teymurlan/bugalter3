(() => {
  const originalDownloadCurrentPdf = downloadCurrentPdf;

  function cleanNumber(value) {
    const match = String(value || '').match(/(\d+)/);
    return match ? match[1] : 'КП';
  }

  function buildPdfFileName(quote) {
    const number = cleanNumber(quote?.quote_number);
    const date = dateRu(quote?.issue_date).replace(/\./g, '-');
    const customer = safeFileName(quote?.client_name || quote?.client_company || 'House_Cleaning');
    return `КП_Исх_${number}_${date}_${customer}.pdf`;
  }

  async function sharePdfFile(file, quote) {
    if (typeof navigator.share !== 'function') return false;

    try {
      if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
        return false;
      }

      await navigator.share({
        files: [file],
        title: `Коммерческое предложение ${quote.quote_number || ''}`.trim(),
        text: 'PDF коммерческого предложения House Cleaning',
      });
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return true;
      console.warn('Native PDF share failed', error);
      return false;
    }
  }

  downloadCurrentPdf = async function downloadCurrentPdfV11() {
    const quote = await ensureSaved();
    const pages = await renderQuotePages(quote);
    const blob = canvasesToPdf(pages);
    const fileName = buildPdfFileName(quote);
    const file = new File([blob], fileName, { type: 'application/pdf' });

    // На iPhone/WKWebView используем системное меню iOS.
    // В нём доступна команда «Сохранить в Файлы», в отличие от обычного открытия PDF в браузере.
    const shared = await sharePdfFile(file, quote);
    if (shared) {
      showToast('PDF готов. В меню выберите «Сохранить в Файлы».');
      return;
    }

    // Для браузеров без Web Share оставляем обычное скачивание.
    try {
      downloadBlob(blob, fileName);
      showToast(`PDF ${quote.quote_number || ''} подготовлен`);
    } catch (error) {
      console.warn('Fallback PDF download failed', error);
      return originalDownloadCurrentPdf();
    }
  };
})();
