(() => {
  const root = document.querySelector('#app');
  if (!root) return;

  function enhanceBookingBack() {
    const bookingTop = root.querySelector('.booking-top');
    if (!bookingTop) return;
    const original = root.querySelector('.wizard-actions [data-back]');
    if (!original) return;
    original.classList.add('hc-original-back-hidden');
    if (root.querySelector('[data-global-booking-back]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.globalBookingBack = '1';
    button.className = 'cc-back hc-booking-back';
    button.textContent = '← Назад';
    button.onclick = () => original.click();
    bookingTop.insertAdjacentElement('beforebegin', button);
  }

  new MutationObserver(enhanceBookingBack).observe(root, { childList: true, subtree: true });
  enhanceBookingBack();
})();
