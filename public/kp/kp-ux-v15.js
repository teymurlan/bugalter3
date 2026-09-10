(() => {
  function installPdfObjectBlock() {
    drawClientBlock = function drawClientBlockV17(ctx, quote, M, W, y) {
      const h = 138;
      ctx.fillStyle = '#f5f3ed';
      roundedRect(ctx, M, y, W - M * 2, h, 18, true, false);
      const left = M + 24;
      ctx.fillStyle = '#8c6b25';
      ctx.font = '700 15px Arial';
      ctx.fillText('ОБЪЕКТ', left, y + 32);
      ctx.fillStyle = '#111';
      ctx.font = '700 24px Arial';
      ctx.fillText(quote.object_type || 'Объект', left, y + 68);
      ctx.fillStyle = '#555';
      ctx.font = '18px Arial';
      if (quote.area) ctx.fillText(`Площадь: ${quote.area} м²`, left, y + 101);
      return y + h;
    };
  }

  function clearPaymentSelection() {
    if (fields.prepayment_percent) fields.prepayment_percent.value = '0';
    if (fields.payment_terms) fields.payment_terms.value = '';
    document.querySelectorAll('.quick-payment-button').forEach((button) => button.classList.remove('active'));
    state.lastSaved = null;
    updateTotals();
  }

  function hasFormData() {
    return Boolean(
      fields.client_name?.value || fields.client_company?.value || fields.area?.value ||
      Number(fields.discount_percent?.value || 0) || state.items?.length ||
      Number(fields.prepayment_percent?.value || 0)
    );
  }

  function installResetDialog() {
    if (document.getElementById('resetQuoteBtn')) return;
    const actions = document.querySelector('.sticky-actions');
    if (!actions) return;

    const reset = document.createElement('button');
    reset.id = 'resetQuoteBtn';
    reset.type = 'button';
    reset.className = 'kp-reset-button';
    reset.textContent = 'Сбросить данные КП';
    reset.setAttribute('aria-label', 'Сбросить все введённые данные коммерческого предложения');
    actions.before(reset);

    const modal = document.createElement('div');
    modal.id = 'resetQuoteModal';
    modal.className = 'kp-confirm hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'resetQuoteTitle');
    modal.innerHTML = `
      <div class="kp-confirm-backdrop"></div>
      <div class="kp-confirm-card">
        <strong id="resetQuoteTitle">Сбросить данные КП?</strong>
        <p>Все введённые данные текущего КП будут очищены. Это действие нельзя отменить.</p>
        <div class="kp-confirm-actions">
          <button type="button" data-reset-no>Нет, оставить</button>
          <button type="button" class="danger" data-reset-yes>Да, сбросить</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.classList.add('hidden');
    reset.addEventListener('click', () => {
      if (!hasFormData()) { showToast('Данные КП уже пустые'); return; }
      modal.classList.remove('hidden');
      modal.querySelector('[data-reset-no]')?.focus();
    });
    modal.querySelector('[data-reset-no]')?.addEventListener('click', close);
    modal.querySelector('.kp-confirm-backdrop')?.addEventListener('click', close);
    modal.querySelector('[data-reset-yes]')?.addEventListener('click', async () => {
      try {
        close();
        try { localStorage.removeItem(`hc:kp:draft:v16:${String(tg?.initDataUnsafe?.user?.id || state.bootstrap?.admin?.id || 'admin')}`); } catch {}
        await resetForm();
        clearPaymentSelection();
        showToast('Данные КП сброшены');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) { showToast(error.message, true); }
    });
  }

  function installBottomNav() {
    if (document.getElementById('kpBottomNav')) return;
    const nav = document.createElement('nav');
    nav.id = 'kpBottomNav';
    nav.className = 'kp-bottom-nav';
    nav.setAttribute('aria-label', 'Навигация коммерческих предложений');
    nav.innerHTML = `
      <button type="button" data-nav="new"><span>＋</span><b>Новое КП</b></button>
      <button type="button" data-nav="history"><span>▤</span><b>История</b></button>
      <button type="button" data-nav="preview"><span>⌕</span><b>Просмотр</b></button>`;
    document.body.appendChild(nav);

    nav.querySelector('[data-nav="new"]').addEventListener('click', () => document.getElementById('newQuoteBtn')?.click());
    nav.querySelector('[data-nav="history"]').addEventListener('click', () => {
      document.querySelector('.history-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    nav.querySelector('[data-nav="preview"]').addEventListener('click', () => document.getElementById('previewBtn')?.click());

    const setKeyboardState = () => {
      const active = document.activeElement;
      const typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
      nav.classList.toggle('keyboard-hidden', Boolean(typing));
    };
    document.addEventListener('focusin', setKeyboardState, true);
    document.addEventListener('focusout', () => setTimeout(setKeyboardState, 120), true);
    if (window.visualViewport) {
      const initialHeight = window.visualViewport.height;
      window.visualViewport.addEventListener('resize', () => {
        nav.classList.toggle('keyboard-hidden', window.visualViewport.height < initialHeight * 0.78);
      });
    }
  }

  function fixLabels() {
    const address = document.getElementById('address');
    address?.closest('label')?.remove();
    if (address) address.value = '';
    document.querySelectorAll('.section-head h2').forEach((h) => {
      if (/работы и расч/i.test(h.textContent || '')) h.textContent = 'Услуги и расчёт';
    });
    const add = document.getElementById('addItemBtn');
    if (add) add.textContent = '+ Добавить услугу';
    const builder = document.querySelector('#quickServiceCard .service-builder-title strong');
    if (builder) builder.textContent = 'Добавить услугу в смету';
    const select = document.getElementById('v5Service');
    if (select?.options?.[0]) select.options[0].textContent = 'Выберите услугу';
  }

  async function install() {
    installPdfObjectBlock();
    fixLabels();
    installResetDialog();
    installBottomNav();
    for (let i = 0; i < 120; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      fixLabels();
      if (state.bootstrap) break;
    }
    clearPaymentSelection();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once: true });
  else install().catch(console.error);
})();