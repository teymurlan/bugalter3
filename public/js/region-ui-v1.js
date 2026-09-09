(() => {
  const root = document.querySelector('#app');
  if (!root) return;

  function fireInput(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function addHomeZone() {
    const hero = root.querySelector('.home-hero');
    if (!hero || root.querySelector('.hc-service-zone')) return;
    const zone = document.createElement('div');
    zone.className = 'hc-service-zone';
    zone.innerHTML = '<span class="pin">⌖</span><div><strong>Работаем рядом с вами</strong><small>Только Санкт-Петербург и Ленинградская область</small></div>';
    hero.insertAdjacentElement('afterend', zone);
  }

  function addRegionSelector() {
    const city = root.querySelector('[data-field="city"]');
    if (!city || root.querySelector('.hc-region-selector')) return;
    const field = city.closest('.field');
    if (!field) return;

    const current = String(city.value || '').trim().toLowerCase();
    const region = document.createElement('div');
    region.className = 'hc-region-selector';
    region.innerHTML = `
      <span>Зона обслуживания</span>
      <div class="hc-region-chips">
        <button type="button" class="hc-region-chip ${current.startsWith('ленинградская область') ? '' : 'active'}" data-region="spb">Санкт-Петербург</button>
        <button type="button" class="hc-region-chip ${current.startsWith('ленинградская область') ? 'active' : ''}" data-region="lo">Ленинградская область</button>
      </div>
      <div class="hc-region-note">За пределами Санкт-Петербурга и Ленинградской области заявки не принимаем.</div>`;
    field.parentElement.insertBefore(region, field);

    region.querySelectorAll('[data-region]').forEach((button) => button.onclick = () => {
      const isLo = button.dataset.region === 'lo';
      region.querySelectorAll('[data-region]').forEach((item) => item.classList.toggle('active', item === button));
      city.value = isLo ? 'Ленинградская область, ' : 'Санкт-Петербург';
      fireInput(city);
      city.focus();
      if (isLo) city.setSelectionRange(city.value.length, city.value.length);
    });
  }

  function showRegionError(text) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    toast.textContent = text;
    toast.className = 'toast show error';
    clearTimeout(showRegionError.timer);
    showRegionError.timer = setTimeout(() => { toast.className = 'toast'; }, 2800);
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('error'); } catch {}
  }

  document.addEventListener('click', (event) => {
    const next = event.target.closest?.('[data-next]');
    if (!next) return;
    const city = root.querySelector('[data-field="city"]');
    if (!city) return;

    const raw = String(city.value || '').trim();
    const lower = raw.toLowerCase();
    const isSpb = lower === 'санкт-петербург' || lower === 'спб';
    const isLo = lower.startsWith('ленинградская область,') && lower.replace('ленинградская область,', '').trim().length >= 2;

    if (!isSpb && !isLo) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showRegionError('Выберите Санкт-Петербург или укажите населённый пункт Ленинградской области');
      city.focus();
    }
  }, true);

  function enhance() {
    addHomeZone();
    addRegionSelector();
  }

  new MutationObserver(enhance).observe(root, { childList: true, subtree: true });
  enhance();
})();