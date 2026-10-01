(() => {
  const root = document.querySelector('#app');
  if (!root) return;

  function shareText() {
    const head = root.querySelector('.cc-detail-head');
    if (!head) return '';
    const title = head.querySelector('h1')?.textContent?.trim() || 'Заявка HOUSE CLEANING';
    const blocks = [...root.querySelectorAll('.hc-detail-block')]
      .map((block) => {
        const label = block.querySelector('small')?.textContent?.trim();
        const value = block.querySelector('strong')?.textContent?.trim();
        return label && value ? `${label}: ${value}` : '';
      })
      .filter(Boolean)
      .slice(0, 6);
    return [title, ...blocks].join('\n');
  }

  async function shareOrder() {
    const text = shareText();
    if (!text) return;
    try {
      if (navigator.share) {
        await navigator.share({ title:'HOUSE CLEANING', text });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        window.dispatchEvent(new CustomEvent('hc:toast', { detail:{ message:'Детали заявки скопированы' } }));
        return;
      }
      throw new Error('Share unavailable');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      const copy = root.querySelector('[data-copy-order]');
      copy?.click();
    }
  }

  function decorateHome() {
    const resume = root.querySelector('.u7-home-draft-resume-v66');
    resume?.querySelector('b')?.remove();
    const manager = root.querySelector('.u7-home-help-v3 [data-manager]');
    if (manager && manager.dataset.hcV68 !== '1') {
      manager.dataset.hcV68 = '1';
      manager.textContent = '✉ Написать менеджеру';
    }
  }

  function ensureBookingSpacer() {
    const dock = root.querySelector('.wizard-actions');
    if (!dock) {
      root.querySelector('.hc-booking-bottom-spacer-v68')?.remove();
      return;
    }
    let spacer = root.querySelector('.hc-booking-bottom-spacer-v68');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'hc-booking-bottom-spacer-v68';
      spacer.setAttribute('aria-hidden', 'true');
      dock.insertAdjacentElement('afterend', spacer);
    } else if (spacer.previousElementSibling !== dock) {
      dock.insertAdjacentElement('afterend', spacer);
    }
  }

  function decorateOrder() {
    const actions = root.querySelector('.hc-order-actions');
    if (!actions || actions.querySelector('[data-share-order]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hc-btn hc-share-order-v68';
    button.dataset.shareOrder = '1';
    button.textContent = '↗ Поделиться заявкой';
    button.addEventListener('click', shareOrder);
    const copy = actions.querySelector('[data-copy-order]');
    if (copy) actions.insertBefore(button, copy);
    else actions.appendChild(button);
  }

  function compactCalendarError() {
    root.querySelectorAll('.hc-calendar-v2 .empty-inline').forEach((node) => {
      const text = node.textContent || '';
      if (!/предстартовую очистку|не удалось загрузить|повторите через/i.test(text)) return;
      if (node.dataset.hcRetryV68 === '1') return;
      node.dataset.hcRetryV68 = '1';
      node.innerHTML = '<div class="hc-calendar-error-v68"><strong>Не удалось обновить расписание</strong><small>Проверьте соединение и повторите загрузку.</small><button type="button">Обновить</button></div>';
      node.querySelector('button').onclick = () => location.reload();
    });
  }

  function scan() {
    decorateHome();
    ensureBookingSpacer();
    decorateOrder();
    compactCalendarError();
  }

  new MutationObserver(() => requestAnimationFrame(scan)).observe(root, { childList:true, subtree:true });
  window.addEventListener('hc:route-rendered', scan);
  window.addEventListener('hc:booking-rendered', scan);
  scan();
})();
