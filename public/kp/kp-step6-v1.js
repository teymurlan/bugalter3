(() => {
  function applyWording() {
    const servicesHeading = [...document.querySelectorAll('.section-head h2')]
      .find((node) => /работы\s+и\s+расч[её]т/i.test(node.textContent || ''));
    if (servicesHeading) servicesHeading.textContent = 'Услуги и расчёт';

    const addItemButton = document.getElementById('addItemBtn');
    if (addItemButton) addItemButton.textContent = '+ Добавить услугу';

    const card = document.getElementById('quickServiceCard');
    const title = card?.querySelector('.service-builder-title strong');
    if (title) title.textContent = 'Добавить услугу в смету';

    const select = document.getElementById('v5Service');
    if (select?.options?.length) {
      const first = select.options[0];
      if (first && !first.value) first.textContent = 'Выберите услугу';
      [...select.querySelectorAll('optgroup')].forEach((group) => {
        if (/^Отдельные работы$/i.test(group.label)) group.label = 'Отдельные услуги';
        if (/^Другие работы$/i.test(group.label)) group.label = 'Другие услуги';
      });
    }

    const addServiceButton = document.getElementById('v5Add');
    if (addServiceButton) addServiceButton.textContent = 'Добавить услугу в КП';

    const duplicate = document.getElementById('v5Duplicate');
    if (duplicate && /Такая работа уже есть/i.test(duplicate.textContent || '')) {
      duplicate.textContent = duplicate.textContent.replace(/Такая работа уже есть/i, 'Такая услуга уже есть');
    }

    document.querySelectorAll('.item-field.name input').forEach((input) => {
      if (input.placeholder === 'Наименование работ') input.placeholder = 'Наименование услуги';
    });
  }

  function install() {
    applyWording();

    const select = document.getElementById('v5Service');
    if (select && select.dataset.step6Bound !== '1') {
      select.dataset.step6Bound = '1';
      select.addEventListener('change', () => setTimeout(applyWording, 0));
    }

    const items = document.getElementById('items');
    if (items && items.dataset.step6Bound !== '1') {
      items.dataset.step6Bound = '1';
      const observer = new MutationObserver(applyWording);
      observer.observe(items, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }

  // Старые слои создают блок выбора услуги после загрузки bootstrap.
  // Несколько коротких повторов меняют только текст и не трогают layout/scroll.
  let attempts = 0;
  const timer = setInterval(() => {
    install();
    attempts += 1;
    if (attempts >= 20) clearInterval(timer);
  }, 150);
})();
