(() => {
  const LOGO_CANDIDATES = [
    '/kp/logo.jpg.png?v=7',
    '/kp/logo.png?v=7',
    '/kp/logo.jpg?v=7',
  ];
  let logoPromise = null;
  let logoObjectUrl = null;

  async function loadUploadedLogo() {
    if (logoPromise) return logoPromise;
    logoPromise = (async () => {
      for (const src of LOGO_CANDIDATES) {
        try {
          const response = await fetch(src, { cache: 'no-store' });
          if (!response.ok) continue;
          const blob = await response.blob();
          if (!blob.size) continue;
          if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl);
          logoObjectUrl = URL.createObjectURL(blob);
          window.HOUSE_CLEANING_LOGO = logoObjectUrl;
          const headerImg = document.querySelector('.brand-logo-shell img');
          if (headerImg) headerImg.src = logoObjectUrl;
          return true;
        } catch {}
      }
      return false;
    })();
    return logoPromise;
  }

  function setDirectLabel(control, text) {
    const label = control?.closest('label');
    if (!label) return;
    const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (textNode) textNode.textContent = text;
  }

  function updateOptionalCustomerLabels() {
    setDirectLabel(fields.client_name, 'Заказчик — необязательно');
    setDirectLabel(fields.client_company, 'Организация заказчика — необязательно');
    fields.client_name.placeholder = 'Можно оставить пустым';
    fields.client_company.placeholder = 'Можно оставить пустым';
  }

  validateClientPayload = function validateOptionalCustomerPayload(payload) {
    if (!payload.address) throw new Error('Укажите адрес объекта');
    if (!payload.items.some((item) => item.name && num(item.quantity) >= 0 && num(item.price) >= 0)) {
      throw new Error('Добавьте хотя бы одну услугу');
    }
    if (calcLocal().total <= 0) throw new Error('Итоговая стоимость должна быть больше нуля');
  };

  const previousResetFormV7 = resetForm;
  resetForm = async function resetFormV7() {
    const result = await previousResetFormV7();
    updateOptionalCustomerLabels();
    return result;
  };

  drawClientBlock = function drawOptionalCustomerBlock(ctx, quote, M, W, y) {
    const hasCustomer = Boolean(String(quote.client_name || '').trim() || String(quote.client_company || '').trim());
    const h = hasCustomer ? 192 : 170;
    const cardW = W - M * 2;

    ctx.fillStyle = '#f6f3eb';
    roundedRect(ctx, M, y, cardW, h, 18, true, false);
    ctx.fillStyle = '#c7a44c';
    roundedRect(ctx, M, y, cardW, 5, 3, true, false);

    if (!hasCustomer) {
      const dividerX = 620;
      const left = M + 28;
      const right = dividerX + 28;

      ctx.strokeStyle = '#e1ddd2';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dividerX, y + 24);
      ctx.lineTo(dividerX, y + h - 24);
      ctx.stroke();

      ctx.fillStyle = '#8c6b25';
      ctx.font = '700 14px Arial';
      ctx.fillText('ОБЪЕКТ', left, y + 36);
      ctx.fillText('АДРЕС ОБЪЕКТА', right, y + 36);

      ctx.fillStyle = '#111';
      ctx.font = '700 23px Arial';
      ctx.fillText(quote.object_type || 'Объект', left, y + 72);

      ctx.fillStyle = '#555';
      ctx.font = '17px Arial';
      if (quote.area) ctx.fillText(`Площадь объекта: ${quote.area} м²`, left, y + 104);
      ctx.fillStyle = '#777';
      ctx.font = '15px Arial';
      ctx.fillText('Профессиональные клининговые услуги', left, y + 138);

      ctx.fillStyle = '#333';
      ctx.font = '17px Arial';
      const addrLines = wrapText(ctx, quote.address, W - M - right - 24, '17px Arial');
      addrLines.slice(0, 4).forEach((line, index) => ctx.fillText(line, right, y + 72 + index * 24));
      return y + h;
    }

    const left = M + 26;
    const dividerX = 612;
    const right = dividerX + 28;

    ctx.strokeStyle = '#e1ddd2';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dividerX, y + 24);
    ctx.lineTo(dividerX, y + h - 24);
    ctx.stroke();

    ctx.fillStyle = '#8c6b25';
    ctx.font = '700 14px Arial';
    ctx.fillText('ЗАКАЗЧИК', left, y + 35);
    ctx.fillText('ОБЪЕКТ', right, y + 35);

    const customerTitle = quote.client_company || quote.client_name;
    ctx.fillStyle = '#111';
    ctx.font = '700 23px Arial';
    ctx.fillText(customerTitle, left, y + 70);

    let detailY = y + 99;
    if (quote.client_company && quote.client_name) {
      ctx.fillStyle = '#555';
      ctx.font = '17px Arial';
      ctx.fillText(`Контакт: ${quote.client_name}`, left, detailY);
      detailY += 30;
    }

    ctx.fillStyle = '#8c6b25';
    ctx.font = '700 13px Arial';
    ctx.fillText('АДРЕС ОБЪЕКТА', left, detailY);
    ctx.fillStyle = '#333';
    ctx.font = '17px Arial';
    const addrWidth = dividerX - left - 26;
    const addrLines = wrapText(ctx, quote.address, addrWidth, '17px Arial');
    addrLines.slice(0, 2).forEach((line, index) => ctx.fillText(line, left, detailY + 25 + index * 22));

    ctx.fillStyle = '#111';
    ctx.font = '700 22px Arial';
    ctx.fillText(quote.object_type || 'Объект', right, y + 70);
    ctx.fillStyle = '#555';
    ctx.font = '17px Arial';
    if (quote.area) ctx.fillText(`Площадь объекта: ${quote.area} м²`, right, y + 102);
    ctx.fillStyle = '#777';
    ctx.font = '15px Arial';
    ctx.fillText('Профессиональные клининговые услуги', right, y + 137);

    return y + h;
  };

  const previousRenderQuotePagesV7 = renderQuotePages;
  renderQuotePages = async function renderQuotePagesV7(quote) {
    await loadUploadedLogo();
    return previousRenderQuotePagesV7(quote);
  };

  const previousLoadHistoryV7 = loadHistory;
  loadHistory = async function loadHistoryV7() {
    const result = await previousLoadHistoryV7();
    historyEl.querySelectorAll('.history-card h3').forEach((title) => {
      if (!title.textContent.trim()) title.textContent = 'Без указания заказчика';
    });
    return result;
  };

  safeFileName = function safeFileNameV7(value) {
    const text = String(value || '').trim() || 'без_заказчика';
    return text.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_').slice(0, 60);
  };

  async function install() {
    updateOptionalCustomerLabels();
    await loadUploadedLogo();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
