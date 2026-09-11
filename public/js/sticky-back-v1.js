(() => {
  const root = document.querySelector('#app');
  if (!root) return;
  let queued = false;

  function enhanceBookingBack() {
    const bookingTop = root.querySelector('.booking-top');
    const existing = root.querySelector('[data-global-booking-back]');
    if (!bookingTop) {
      existing?.remove();
      return;
    }
    const original = root.querySelector('.wizard-actions [data-back]');
    if (!original) return;
    original.classList.add('hc-original-back-hidden');
    if (existing) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.globalBookingBack = '1';
    button.className = 'cc-back hc-booking-back hc-fixed-back';
    button.textContent = '← Назад';
    button.onclick = () => original.click();
    root.appendChild(button);
  }

  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhanceBookingBack();
    });
  }).observe(root, { childList: true, subtree: false });

  enhanceBookingBack();
})();
