(() => {
  const DRAFT_PREFIX = 'hc:kp:draft:v16:';

  function currentUserId() {
    return String(tg?.initDataUnsafe?.user?.id || state.bootstrap?.admin?.id || 'admin');
  }

  function draftKey() {
    return `${DRAFT_PREFIX}${currentUserId()}`;
  }

  function clearLocalDraft() {
    try { localStorage.removeItem(draftKey()); } catch {}
  }

  function clearPaymentSelection() {
    if (fields.prepayment_percent) fields.prepayment_percent.value = '0';
    if (fields.payment_terms) fields.payment_terms.value = '';
    document.querySelectorAll('.quick-payment-button').forEach((button) => button.classList.remove('active'));
    state.lastSaved = null;
    updateTotals();
  }

  function removeAddressFromInterface() {
    const addressLabel = fields.address?.closest('label');
    if (addressLabel) addressLabel.remove();
    if (fields.address) {
      fields.address.value = '';
      fields.address.setAttribute('aria-hidden', 'true');
    }
  }

  // Адрес полностью убираем и из PDF. Сохраняем только заказчика/объект.
  drawClientBlock = function drawClientBlockWithoutAddress(ctx, quote, M, W, y) {
    const hasCustomer = Boolean(String(quote.client_name || '').trim() || String(quote.client_company || '').trim());
    const h = 150;
    const cardW = W - M * 2;

    ctx.fillStyle = '#f6f3eb';
    roundedRect(ctx, M, y, cardW, h, 18, true, false);
    ctx.fillStyle = '#c7a44c';
    roundedRect(ctx, M, y, cardW, 5, 3, true, false);

    if (!hasCustomer) {
      const left = M + 28;
      ctx.fillStyle = '#8c6b25';
      ctx.font = '700 14px Arial';
      ctx.fillText('ОБЪЕКТ', left, y + 36);
      ctx.fillStyle = '#111';
      ctx.font = '700 23px Arial';
      ctx.fillText(quote.object_type || 'Объект', left, y + 72);
      ctx.fillStyle = '#555';
      ctx.font = '17px Arial';
      if (quote.area) ctx.fillText(`Площадь объекта: ${quote.area} м²`, left, y + 104);
      ctx.fillStyle = '#777';
      ctx.font = '15px Arial';
      ctx.fillText('Профессиональные клининговые услуги', left, y + 132);
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

    const customerTitle = quote.client_company || quote.client_name || 'Заказчик';
    ctx.fillStyle = '#111';
    ctx.font = '700 23px Arial';
    ctx.fillText(customerTitle, left, y + 70);
    if (quote.client_company && quote.client_name) {
      ctx.fillStyle = '#555';
      ctx.font = '17px Arial';
      ctx.fillText(`Контакт: ${quote.client_name}`, left, y + 103);
    }

    ctx.fillStyle = '#111';
    ctx.font = '700 22px Arial';
    ctx.fillText(quote.object_type || 'Объект', right, y + 70);
    ctx.fillStyle = '#555';
    ctx.font = '17px Arial';
    if (quote.area) ctx.fillText(`Площадь объекта: ${quote.area} м²`, right, y + 103);
    ctx.fillStyle = '#777';
    ctx.font = '15px Arial';
    ctx.fillText('Профессиональные клининговые услуги', right, y + 132);
    return y + h;
  };

  // Предоплата теперь необязательна. Остальные проверки стабильной версии сохраняем.
  validateClientPayload = function validateFirstFivePayload(payload) {
    if (!Array.isArray(payload.items) || !payload.items.some((item) => item.name && num(item.quantity) >= 0 && num(item.price) >= 0)) {
      throw new Error('Добавьте хотя бы одну услугу');
    }
    if (calcLocal().total <= 0) throw new Error('Итоговая стоимость должна быть больше нуля');
  };

  const previousResetForm = resetForm;
  resetForm = async function resetFirstFiveForm() {
    const result = await previousResetForm();
    removeAddressFromInterface();
    clearPaymentSelection();
    return result;
  };

  function closeResetDialog() {
    document.getElementById('kpFirst5ResetModal')?.classList.add('hidden');
  }

  function installResetControl() {
    if (document.getElementById('kpFirst5ResetButton')) return;
    const actions = document.querySelector('.sticky-actions');
    if (!actions) return;

    const zone = document.createElement('div');
    zone.className = 'kp-first5-reset-zone';
    zone.innerHTML = '<button id="kpFirst5ResetButton" class="kp-first5-reset-button" type="button">Сбросить данные КП</button>';
    actions.insertAdjacentElement('afterend', zone);

    const modal = document.createElement('div');
    modal.id = 'kpFirst5ResetModal';
    modal.className = 'kp-first5-reset-modal hidden';
    modal.innerHTML = `
      <div class="kp-first5-reset-backdrop" data-reset-no></div>
      <div class="kp-first5-reset-card" role="dialog" aria-modal="true" aria-labelledby="kpFirst5ResetTitle">
        <h3 id="kpFirst5ResetTitle">Точно хотите сбросить данные КП?</h3>
        <p>Все введённые данные текущего КП будут очищены.</p>
        <div class="kp-first5-reset-actions">
          <button type="button" class="kp-first5-reset-no" data-reset-no>Нет, оставить</button>
          <button type="button" class="kp-first5-reset-yes" data-reset-yes>Да, сбросить</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    zone.querySelector('#kpFirst5ResetButton').addEventListener('click', () => {
      modal.classList.remove('hidden');
    });
    modal.querySelectorAll('[data-reset-no]').forEach((node) => node.addEventListener('click', closeResetDialog));
    modal.querySelector('[data-reset-yes]').addEventListener('click', async () => {
      const yes = modal.querySelector('[data-reset-yes]');
      yes.disabled = true;
      try {
        clearLocalDraft();
        previewModal?.classList.add('hidden');
        await resetForm();
        clearLocalDraft();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        closeResetDialog();
        showToast('Данные КП сброшены');
      } catch (error) {
        showToast(error?.message || 'Не удалось сбросить данные', true);
      } finally {
        yes.disabled = false;
      }
    });
  }

  function install() {
    removeAddressFromInterface();
    installResetControl();

    // Если открыто новое пустое КП, ни один процент не должен быть выбран.
    if (!state.currentId && !state.items.length) clearPaymentSelection();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
