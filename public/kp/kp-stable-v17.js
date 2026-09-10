(() => {
  let nav = null;
  let resetModal = null;

  function clearPaymentSelection() {
    if (fields?.prepayment_percent) fields.prepayment_percent.value = '0';
    if (fields?.payment_terms) fields.payment_terms.value = '';
    document.querySelectorAll('.quick-payment-button.active').forEach((button) => button.classList.remove('active'));
    state.lastSaved = null;
    try { updateTotals(); } catch {}
  }

  function fixServiceWording(root = document) {
    const add = document.getElementById('addItemBtn');
    if (add) add.textContent = '+ Добавить услугу';

    root.querySelectorAll?.('.section-head h2').forEach((node) => {
      if (/работы и расч/i.test(node.textContent || '')) node.textContent = 'Услуги и расчёт';
    });

    const builderTitle = document.querySelector('#quickServiceCard .service-builder-title strong');
    if (builderTitle && /работ/i.test(builderTitle.textContent || '')) builderTitle.textContent = 'Добавить услугу в смету';

    const serviceSelect = document.getElementById('v5Service');
    if (serviceSelect?.options?.[0] && /работ/i.test(serviceSelect.options[0].textContent || '')) {
      serviceSelect.options[0].textContent = 'Выберите услугу';
    }

    document.querySelectorAll('#items input[placeholder="Наименование работ"]').forEach((input) => {
      input.placeholder = 'Наименование услуги';
    });
  }

  drawClientBlock = function drawClientBlockStable(ctx, quote, M, W, y) {
    const height = 132;
    ctx.fillStyle = '#f5f3ed';
    roundedRect(ctx, M, y, W - M * 2, height, 18, true, false);
    const left = M + 24;
    const mid = 620;
    const customer = String(quote.client_company || quote.client_name || '').trim();

    ctx.fillStyle = '#8c6b25';
    ctx.font = '700 15px Arial';
    ctx.fillText('ЗАКАЗЧИК', left, y + 32);
    ctx.fillText('ОБЪЕКТ', mid, y + 32);

    ctx.fillStyle = '#111';
    ctx.font = '700 22px Arial';
    if (customer) ctx.fillText(customer, left, y + 66);
    ctx.fillText(quote.object_type || 'Объект', mid, y + 66);

    ctx.font = '18px Arial';
    ctx.fillStyle = '#555';
    if (quote.client_company && quote.client_name) ctx.fillText(quote.client_name, left, y + 95);
    if (quote.area) ctx.fillText(`Площадь: ${quote.area} м²`, mid, y + 95);
    return y + height;
  };

  const previousResetFormStable = resetForm;
  resetForm = async function resetFormStable() {
    const result = await previousResetFormStable();
    if (fields?.address) fields.address.value = '';
    clearPaymentSelection();
    fixServiceWording();
    return result;
  };

  function installResetModal() {
    if (document.getElementById('hcResetModal')) return;
    const modal = document.createElement('div');
    modal.id = 'hcResetModal';
    modal.className = 'hc-reset-modal hidden';
    modal.innerHTML = `
      <div class="hc-reset-backdrop" data-reset-no></div>
      <div class="hc-reset-card" role="dialog" aria-modal="true" aria-labelledby="hcResetTitle">
        <h3 id="hcResetTitle">Сбросить данные КП?</h3>
        <p>Все введённые данные текущего КП будут очищены. Это действие нельзя отменить.</p>
        <div class="hc-reset-actions">
          <button type="button" class="hc-reset-no" data-reset-no>Нет, оставить</button>
          <button type="button" class="hc-reset-yes" data-reset-yes>Да, сбросить</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    resetModal = modal;

    modal.querySelectorAll('[data-reset-no]').forEach((button) => button.addEventListener('click', closeResetModal));
    modal.querySelector('[data-reset-yes]').addEventListener('click', async () => {
      const yes = modal.querySelector('[data-reset-yes]');
      yes.disabled = true;
      try {
        await resetForm();
        closeResetModal();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setActive('new');
        showToast('Данные КП сброшены');
      } catch (error) {
        showToast(error?.message || 'Не удалось сбросить данные', true);
      } finally {
        yes.disabled = false;
      }
    });
  }

  function openResetModal() {
    installResetModal();
    resetModal.classList.remove('hidden');
    resetModal.querySelector('[data-reset-no]')?.focus();
  }

  function closeResetModal() {
    resetModal?.classList.add('hidden');
  }

  function setActive(key) {
    if (!nav) return;
    nav.querySelectorAll('button[data-nav]').forEach((button) => {
      button.classList.toggle('active', button.dataset.nav === key);
    });
  }

  function installBottomNav() {
    if (document.getElementById('hcBottomNav')) return;
    nav = document.createElement('nav');
    nav.id = 'hcBottomNav';
    nav.className = 'hc-bottom-nav';
    nav.setAttribute('aria-label', 'Навигация КП');
    nav.innerHTML = `
      <button type="button" data-nav="new" class="active"><span class="icon">＋</span><span>Новое КП</span></button>
      <button type="button" data-nav="history"><span class="icon">▤</span><span>История</span></button>
      <button type="button" data-nav="preview"><span class="icon">⌕</span><span>Просмотр</span></button>
      <button type="button" data-nav="reset" class="reset"><span class="icon">↶</span><span>Сброс</span></button>`;
    document.body.appendChild(nav);

    nav.querySelector('[data-nav="new"]').addEventListener('click', () => {
      setActive('new');
      const topButton = document.getElementById('newQuoteBtn');
      if (topButton) topButton.click();
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    nav.querySelector('[data-nav="history"]').addEventListener('click', () => {
      setActive('history');
      document.querySelector('.history-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    nav.querySelector('[data-nav="preview"]').addEventListener('click', () => {
      setActive('preview');
      document.getElementById('previewBtn')?.click();
    });

    nav.querySelector('[data-nav="reset"]').addEventListener('click', openResetModal);

    document.addEventListener('focusin', (event) => {
      if (event.target?.matches?.('input, textarea, select, [contenteditable="true"]')) nav.classList.add('keyboard-hidden');
    }, true);
    document.addEventListener('focusout', () => setTimeout(() => {
      const active = document.activeElement;
      if (!active?.matches?.('input, textarea, select, [contenteditable="true"]')) nav.classList.remove('keyboard-hidden');
    }, 120), true);

    if (window.visualViewport) {
      const baseHeight = window.visualViewport.height;
      window.visualViewport.addEventListener('resize', () => {
        const keyboardOpen = window.visualViewport.height < baseHeight * 0.78;
        nav.classList.toggle('keyboard-hidden', keyboardOpen);
      });
    }

    const history = document.querySelector('.history-panel');
    if (history && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.35);
        if (visible && document.getElementById('previewModal')?.classList.contains('hidden')) setActive('history');
      }, { threshold: [0.35] });
      observer.observe(history);
    }

    const preview = document.getElementById('previewModal');
    if (preview && 'MutationObserver' in window) {
      new MutationObserver(() => {
        if (!preview.classList.contains('hidden')) setActive('preview');
      }).observe(preview, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function installWordingObserver() {
    if (!('MutationObserver' in window)) return;
    const observer = new MutationObserver(() => fixServiceWording());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function install() {
    if (fields?.address) fields.address.value = '';
    fixServiceWording();
    installResetModal();
    installBottomNav();
    installWordingObserver();

    for (let i = 0; i < 120 && !state.bootstrap; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    fixServiceWording();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once: true });
  } else {
    install().catch(console.error);
  }
})();
