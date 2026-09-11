(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') !== '1') return;

  document.addEventListener('click', (event) => {
    const refresh = event.target.closest?.('[data-refresh]');
    if (!refresh) return;
    const activeExtra = document.querySelector('.ops-nav [data-admin-extra].active');
    if (!activeExtra) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    activeExtra.click();
  }, true);
})();
