(() => {
  const root = document.querySelector('#app');
  if (!root) return;
  let queued = false;

  function sync() {
    const review = Boolean(root.querySelector('.review-head'));
    document.body.classList.toggle('hc-review-flow', review);
  }

  function queue() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      sync();
    });
  }

  new MutationObserver(queue).observe(root, { childList: true, subtree: false });
  sync();
})();
