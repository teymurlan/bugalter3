(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function installCombinedServicePicker() {
    const listBlock = document.getElementById('kpFlowListBlock');
    const search = document.getElementById('kpServiceSearch');
    const options = document.getElementById('kpFlowPresetOptions');
    const picker = document.getElementById('kpFlowPresetPicker');
    if (!listBlock || !search || !options || !picker) return false;
    if (listBlock.dataset.combinedServicePicker === '1') return true;
    listBlock.dataset.combinedServicePicker = '1';

    const searchWrap = search.closest('.kp-service-search-wrap');
    const searchTitle = searchWrap?.querySelector('span');
    if (searchTitle) searchTitle.textContent = 'Найти и выбрать услугу';
    search.placeholder = 'Начните вводить: ком, окно, ремонт, пол…';
    search.setAttribute('aria-label', 'Найти и выбрать услугу');
    search.setAttribute('aria-controls', 'kpFlowPresetOptions');
    search.setAttribute('aria-autocomplete', 'list');

    // Старое отдельное поле «Выберите услугу» оставляем в DOM только для
    // совместимости с рабочим flow, но визуально оно больше не дублирует поиск.
    picker.setAttribute('tabindex', '-1');
    picker.setAttribute('aria-hidden', 'true');

    options.addEventListener('click', (event) => {
      const option = event.target.closest('[data-preset-index]');
      if (!option) return;
      const index = Number(option.dataset.presetIndex);
      const preset = state?.bootstrap?.presets?.[index];
      if (!preset) return;

      // Базовый обработчик уже выбирает услугу и подставляет цену/единицу.
      // После него используем это же поле как отображение выбранной услуги.
      setTimeout(() => {
        search.value = String(preset.name || '');
        search.dataset.selectedService = '1';
        options.classList.add('hidden');
        search.setAttribute('aria-expanded', 'false');
      }, 0);
    });

    search.addEventListener('focus', () => {
      search.setAttribute('aria-expanded', 'true');
      if (search.dataset.selectedService === '1') {
        requestAnimationFrame(() => {
          try { search.select(); } catch {}
        });
      }
    });

    search.addEventListener('input', () => {
      search.dataset.selectedService = '0';
      search.setAttribute('aria-expanded', 'true');
    });

    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        options.classList.add('hidden');
        search.setAttribute('aria-expanded', 'false');
        search.blur();
      }
    });

    return true;
  }

  async function install() {
    for (let i = 0; i < 160 && !document.getElementById('kpServiceSearch'); i += 1) {
      await sleep(25);
    }
    installCombinedServicePicker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install().catch(console.error), { once: true });
  } else {
    install().catch(console.error);
  }
})();
