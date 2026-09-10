(() => {
  const DEFAULT_TITLE = 'Коммерческое предложение на оказание клининговых услуг';
  let repoLogoPromise = null;
  let repoLogoObjectUrl = null;

  async function preferRepositoryLogo() {
    if (repoLogoPromise) return repoLogoPromise;
    repoLogoPromise = (async () => {
      try {
        const response = await fetch('/kp/logo.jpg?v=6', { cache: 'no-store' });
        const type = String(response.headers.get('content-type') || '').toLowerCase();
        if (!response.ok || !type.startsWith('image/')) return false;
        const blob = await response.blob();
        repoLogoObjectUrl = URL.createObjectURL(blob);
        window.HOUSE_CLEANING_LOGO = repoLogoObjectUrl;
        const headerImg = document.querySelector('.brand-logo-shell img');
        if (headerImg) headerImg.src = repoLogoObjectUrl;
        return true;
      } catch {
        return false;
      }
    })();
    return repoLogoPromise;
  }

  function setDirectLabel(control, text) {
    const label = control?.closest('label');
    if (!label) return;
    const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (textNode) textNode.textContent = text;
  }

  function updateWording() {
    setDirectLabel(fields.client_name, 'Заказчик');
    setDirectLabel(fields.client_company, 'Организация заказчика');
    fields.client_name.placeholder = 'ФИО заказчика / контактного лица';
    fields.client_company.placeholder = 'Компания или организация — необязательно';

    if (fields.title.value === 'Коммерческое предложение по уборке' || !fields.title.value.trim()) {
      fields.title.value = DEFAULT_TITLE;
    }
  }

  const previousResetFormV6 = resetForm;
  resetForm = async function resetFormV6() {
    const result = await previousResetFormV6();
    if (fields.title.value === 'Коммерческое предложение по уборке' || !fields.title.value.trim()) {
      fields.title.value = DEFAULT_TITLE;
    }
    updateWording();
    return result;
  };

  validateClientPayload = function validateCustomerPayload(payload) {
    if (!payload.client_name) throw new Error('Укажите заказчика');
    if (!payload.address) throw new Error('Укажите адрес объекта');
    if (!payload.items.some((item) => item.name && num(item.quantity) >= 0 && num(item.price) >= 0)) {
      throw new Error('Добавьте хотя бы одну услугу');
    }
    if (calcLocal().total <= 0) throw new Error('Итоговая стоимость должна быть больше нуля');
  };

  drawClientBlock = function drawCustomerBlock(ctx, quote, M, W, y) {
    const h = 192;
    const cardW = W - M * 2;
    const left = M + 26;
    const dividerX = 612;
    const right = dividerX + 28;

    ctx.fillStyle = '#f6f3eb';
    roundedRect(ctx, M, y, cardW, h, 18, true, false);

    ctx.fillStyle = '#c7a44c';
    roundedRect(ctx, M, y, cardW, 5, 3, true, false);

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

    ctx.fillStyle = '#111';
    ctx.font = '700 23px Arial';
    ctx.fillText(quote.client_company || quote.client_name, left, y + 70);

    let nameY = y + 99;
    if (quote.client_company) {
      ctx.fillStyle = '#555';
      ctx.font = '17px Arial';
      ctx.fillText(`Контакт: ${quote.client_name}`, left, nameY);
      nameY += 30;
    }

    ctx.fillStyle = '#8c6b25';
    ctx.font = '700 13px Arial';
    ctx.fillText('АДРЕС ОБЪЕКТА', left, nameY);
    ctx.fillStyle = '#333';
    ctx.font = '17px Arial';
    const addrWidth = dividerX - left - 26;
    const addrLines = wrapText(ctx, quote.address, addrWidth, '17px Arial');
    addrLines.slice(0, 2).forEach((line, index) => ctx.fillText(line, left, nameY + 25 + index * 22));

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

  drawTableHeader = function drawTableHeaderV6(ctx, M, W, y) {
    const h = 58;
    ctx.fillStyle = '#c8a64f';
    ctx.fillRect(M, y, W - M * 2, 4);
    ctx.fillStyle = '#111214';
    ctx.fillRect(M, y + 4, W - M * 2, h - 4);
    const x = colXs(M);
    ctx.fillStyle = '#e0c477';
    ctx.font = '700 14px Arial';
    ctx.fillText('№', x.n + 18, y + 37);
    ctx.fillText('НАИМЕНОВАНИЕ УСЛУГ', x.name + 14, y + 37);
    ctx.fillText('ЕД.', x.unit + 14, y + 37);
    ctx.fillText('КОЛ-ВО', x.qty + 12, y + 37);
    ctx.fillText('ЦЕНА', x.price + 14, y + 37);
    ctx.fillText('ИТОГО', x.total + 14, y + 37);
    return y + h;
  };

  const previousRenderQuotePagesV6 = renderQuotePages;
  renderQuotePages = async function renderQuotePagesV6(quote) {
    await preferRepositoryLogo();
    return previousRenderQuotePagesV6(quote);
  };

  function install() {
    updateWording();
    preferRepositoryLogo();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
