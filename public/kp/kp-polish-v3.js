(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const CATEGORIES = [
    'Коммерческое помещение',
    'Квартира',
    'Загородный дом',
    'После ремонта',
    'Окна и остекление',
    'Полы',
    'Санузлы',
    'Стены и поверхности',
    'Дополнительные услуги',
  ];

  const CATEGORY_ALIASES = {
    'Коммерческое помещение': 'ком коммерция коммерческий офис бизнес магазин торговое кафе ресторан склад помещение',
    'Квартира': 'квартира квартир жилое жилье',
    'Загородный дом': 'дом коттедж загородный таунхаус',
    'После ремонта': 'рем ремонт стройка строительный послестрой',
    'Окна и остекление': 'окно окна окон стекло витрина витрины остекление рама подоконник перегородка',
    'Полы': 'пол пола полы плитка швы плинтус линолеум паркет ковролин',
    'Санузлы': 'санузел туалет ванна сантехника душ кафель известковый налет',
    'Стены и поверхности': 'стена стены поверхность двери мебель пыль коммуникации потолок',
    'Дополнительные услуги': 'доп дополнительно локальная выезд клинер индивидуальная услуга труднодоступ',
  };

  const EXTRA_SERVICES = [
    { name: 'Уборка офиса', category: 'Коммерческое помещение', unit: 'м²' },
    { name: 'Уборка торгового помещения', category: 'Коммерческое помещение', unit: 'м²' },
    { name: 'Уборка ресторана или кафе', category: 'Коммерческое помещение', unit: 'м²' },
    { name: 'Уборка склада', category: 'Коммерческое помещение', unit: 'м²' },
    { name: 'Уборка после мероприятия', category: 'Коммерческое помещение', unit: 'усл. ед.' },
    { name: 'Уборка входной группы', category: 'Коммерческое помещение', unit: 'м²' },
    { name: 'Комплексная уборка квартиры', category: 'Квартира', unit: 'м²' },
    { name: 'Уборка кухни', category: 'Квартира', unit: 'усл. ед.' },
    { name: 'Уборка балкона или лоджии', category: 'Квартира', unit: 'усл. ед.' },
    { name: 'Генеральная уборка загородного дома', category: 'Загородный дом', unit: 'м²' },
    { name: 'Поддерживающая уборка загородного дома', category: 'Загородный дом', unit: 'м²' },
    { name: 'Удаление строительной пыли', category: 'После ремонта', unit: 'м²' },
    { name: 'Очистка поверхностей после ремонта', category: 'После ремонта', unit: 'м²' },
    { name: 'Удаление следов строительных материалов', category: 'После ремонта', unit: 'усл. ед.' },
    { name: 'Мытьё окон после ремонта', category: 'После ремонта', unit: 'шт.' },
    { name: 'Очистка дверей после ремонта', category: 'После ремонта', unit: 'шт.' },
    { name: 'Очистка потолков и коммуникаций', category: 'После ремонта', unit: 'м²' },
    { name: 'Мойка витрин', category: 'Окна и остекление', unit: 'м²' },
    { name: 'Мойка стеклянных перегородок', category: 'Окна и остекление', unit: 'м²' },
    { name: 'Мойка зеркал', category: 'Окна и остекление', unit: 'м²' },
    { name: 'Очистка рам', category: 'Окна и остекление', unit: 'шт.' },
    { name: 'Очистка подоконников', category: 'Окна и остекление', unit: 'шт.' },
    { name: 'Удаление загрязнений со стекла', category: 'Окна и остекление', unit: 'м²' },
    { name: 'Мытьё пола', category: 'Полы', unit: 'м²' },
    { name: 'Глубокая очистка пола', category: 'Полы', unit: 'м²' },
    { name: 'Очистка плитки', category: 'Полы', unit: 'м²' },
    { name: 'Очистка межплиточных швов', category: 'Полы', unit: 'м²' },
    { name: 'Мытьё плинтусов', category: 'Полы', unit: 'м.п.' },
    { name: 'Удаление строительной пыли с пола', category: 'Полы', unit: 'м²' },
    { name: 'Генеральная уборка санузла', category: 'Санузлы', unit: 'усл. ед.' },
    { name: 'Мытьё сантехники', category: 'Санузлы', unit: 'шт.' },
    { name: 'Очистка душевых кабин', category: 'Санузлы', unit: 'шт.' },
    { name: 'Очистка кафеля', category: 'Санузлы', unit: 'м²' },
    { name: 'Удаление известкового налёта', category: 'Санузлы', unit: 'усл. ед.' },
    { name: 'Очистка стен', category: 'Стены и поверхности', unit: 'м²' },
    { name: 'Очистка дверей', category: 'Стены и поверхности', unit: 'шт.' },
    { name: 'Очистка мебели снаружи', category: 'Стены и поверхности', unit: 'усл. ед.' },
    { name: 'Очистка горизонтальных поверхностей', category: 'Стены и поверхности', unit: 'м²' },
    { name: 'Удаление пыли с коммуникаций', category: 'Стены и поверхности', unit: 'усл. ед.' },
    { name: 'Очистка труднодоступных мест', category: 'Стены и поверхности', unit: 'усл. ед.' },
    { name: 'Локальная уборка', category: 'Дополнительные услуги', unit: 'усл. ед.' },
    { name: 'Выезд клинера', category: 'Дополнительные услуги', unit: 'усл. ед.' },
    { name: 'Дополнительный клинер', category: 'Дополнительные услуги', unit: 'усл. ед.' },
    { name: 'Индивидуальная услуга', category: 'Дополнительные услуги', unit: 'усл. ед.' },
  ];

  let activeCategory = '';
  let searchInput = null;
  let presetOptions = null;
  let historyPanel = null;
  let editorPanel = null;
  let nav = null;
  let lifecycleWrapped = false;

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9²]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function categoryFor(preset) {
    const explicit = String(preset?.category || '').trim();
    if (CATEGORIES.includes(explicit)) return explicit;
    const text = normalize(`${preset?.group || ''} ${preset?.name || ''}`);
    if (/коммер|офис|торгов|магазин|склад|ресторан|кафе/.test(text)) return 'Коммерческое помещение';
    if (/квартир|жил/.test(text)) return 'Квартира';
    if (/дом|коттедж|загород/.test(text)) return 'Загородный дом';
    if (/ремонт|строител/.test(text)) return 'После ремонта';
    if (/окн|стекл|витрин|зеркал|перегород|рам|подокон/.test(text)) return 'Окна и остекление';
    if (/пол|плитк|шв|плинтус|линолеум|паркет|коврол/.test(text)) return 'Полы';
    if (/сануз|сантех|душ|унитаз|раков|ванн|извест/.test(text)) return 'Санузлы';
    if (/стен|двер|мебел|поверхност|коммуникац|потол/.test(text)) return 'Стены и поверхности';
    return 'Дополнительные услуги';
  }

  function aliasesFor(preset) {
    const category = categoryFor(preset);
    const name = normalize(preset?.name);
    let aliases = CATEGORY_ALIASES[category] || '';
    if (/генерал/.test(name)) aliases += ' ген генеральная глубокая';
    if (/поддерж/.test(name)) aliases += ' поддерж ежедневная регулярная';
    if (/окн|стекл/.test(name)) aliases += ' окно окна окон стекло стекла';
    if (/ремонт|строител/.test(name)) aliases += ' рем ремонт стройка после ремонта';
    return `${aliases} ${preset?.keywords || ''}`;
  }

  function ensureExpandedCatalog() {
    const presets = state?.bootstrap?.presets;
    if (!Array.isArray(presets)) return false;
    const existing = new Set(presets.map((item) => normalize(item?.name)));
    for (const item of EXTRA_SERVICES) {
      if (existing.has(normalize(item.name))) continue;
      presets.push({
        name: item.name,
        unit: item.unit,
        price: 0,
        group: item.category,
        category: item.category,
        keywords: CATEGORY_ALIASES[item.category] || '',
        added_client_side: true,
      });
      existing.add(normalize(item.name));
    }
    return true;
  }

  function matchesPreset(preset, query) {
    if (activeCategory && categoryFor(preset) !== activeCategory) return false;
    const q = normalize(query);
    if (!q) return true;
    const haystack = normalize(`${preset?.name || ''} ${preset?.group || ''} ${categoryFor(preset)} ${aliasesFor(preset)}`);
    return q.split(' ').every((word) => haystack.includes(word));
  }

  function categorySuggestion(query) {
    const q = normalize(query);
    if (!q || q.length < 2) return '';
    return CATEGORIES.find((category) => normalize(`${category} ${CATEGORY_ALIASES[category] || ''}`).includes(q)) || '';
  }

  function renderCategories() {
    const root = document.getElementById('kpCategoryRow');
    if (!root) return;
    root.innerHTML = [
      `<button type="button" class="kp-category-chip${activeCategory ? '' : ' active'}" data-category="">Все</button>`,
      ...CATEGORIES.map((category) => `<button type="button" class="kp-category-chip${activeCategory === category ? ' active' : ''}" data-category="${category}">${category}</button>`),
    ].join('');
  }

  function renderSearchResults() {
    if (!presetOptions) return;
    const presets = state?.bootstrap?.presets || [];
    const query = searchInput?.value || '';
    const filtered = presets
      .map((preset, index) => ({ preset, index }))
      .filter(({ preset }) => matchesPreset(preset, query));

    const grouped = new Map();
    for (const row of filtered) {
      const category = categoryFor(row.preset);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(row);
    }

    presetOptions.innerHTML = grouped.size
      ? [...grouped.entries()].map(([category, rows]) => `
          <div class="kp-flow-preset-group">
            <div class="kp-flow-preset-group-title">${category}</div>
            ${rows.map(({ preset, index }) => `
              <button type="button" class="kp-flow-preset-option" data-preset-index="${index}">
                <span>${escapeHtmlLocal(preset.name)}<small class="kp-service-result-meta">${category}</small></span>
                <small>${Number(preset.price || 0) > 0 ? `${money(preset.price)} / ${escapeHtmlLocal(preset.unit || 'усл. ед.')}` : 'Цена вручную'}</small>
              </button>`).join('')}
          </div>`).join('')
      : '<div class="kp-flow-empty-small">Ничего не найдено. Попробуйте другое слово или выберите «Своя услуга».</div>';

    const suggestionRoot = document.getElementById('kpCategorySuggestion');
    if (suggestionRoot) {
      const suggestion = categorySuggestion(query);
      suggestionRoot.innerHTML = suggestion
        ? `<span>Категория: <strong>${suggestion}</strong></span><button type="button" data-suggest-category="${suggestion}">Показать</button>`
        : '';
      suggestionRoot.classList.toggle('hidden', !suggestion);
    }
  }

  function escapeHtmlLocal(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function openResults() {
    if (!presetOptions) return;
    presetOptions.classList.remove('hidden');
    document.getElementById('kpFlowPresetPicker')?.setAttribute('aria-expanded', 'true');
  }

  function installServiceDiscovery() {
    const listBlock = document.getElementById('kpFlowListBlock');
    presetOptions = document.getElementById('kpFlowPresetOptions');
    if (!listBlock || !presetOptions) return false;
    ensureExpandedCatalog();

    let discovery = document.getElementById('kpServiceDiscovery');
    if (!discovery) {
      discovery = document.createElement('div');
      discovery.id = 'kpServiceDiscovery';
      discovery.className = 'kp-service-discovery';
      discovery.innerHTML = `
        <label class="kp-service-search-wrap">
          <span>Найти услугу</span>
          <input id="kpServiceSearch" type="search" inputmode="search" autocomplete="off" autocapitalize="none" placeholder="Например: ком, окно, ремонт, пол" />
        </label>
        <div id="kpCategoryRow" class="kp-category-row" aria-label="Категории услуг"></div>
        <div id="kpCategorySuggestion" class="kp-category-suggestion hidden"></div>`;
      listBlock.insertBefore(discovery, listBlock.firstChild);
    }

    searchInput = document.getElementById('kpServiceSearch');
    renderCategories();
    renderSearchResults();

    if (discovery.dataset.bound !== '1') {
      discovery.dataset.bound = '1';
      searchInput?.addEventListener('focus', () => {
        renderSearchResults();
        openResults();
      });
      searchInput?.addEventListener('input', () => {
        activeCategory = '';
        renderCategories();
        renderSearchResults();
        openResults();
      });
      document.getElementById('kpCategoryRow')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-category]');
        if (!button) return;
        activeCategory = button.dataset.category || '';
        if (searchInput) searchInput.value = '';
        renderCategories();
        renderSearchResults();
        openResults();
      });
      document.getElementById('kpCategorySuggestion')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-suggest-category]');
        if (!button) return;
        activeCategory = button.dataset.suggestCategory || '';
        if (searchInput) searchInput.value = '';
        renderCategories();
        renderSearchResults();
        openResults();
      });
      presetOptions.addEventListener('click', (event) => {
        if (!event.target.closest('[data-preset-index]')) return;
        if (searchInput) searchInput.value = '';
        setTimeout(() => {
          activeCategory = '';
          renderCategories();
        }, 0);
      });
    }

    const pickerLabel = document.getElementById('kpFlowPresetLabel');
    if (pickerLabel && !pickerLabel.textContent.trim()) pickerLabel.textContent = 'Показать все услуги';
    return true;
  }

  function setNavActive(name) {
    if (!nav) return;
    nav.querySelectorAll('[data-nav]').forEach((button) => {
      const active = button.dataset.nav === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function showEditor() {
    document.body.classList.remove('kp-view-history');
    document.body.classList.add('kp-view-editor');
    setNavActive('new');
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  function showHistory() {
    document.body.classList.remove('kp-view-editor');
    document.body.classList.add('kp-view-history');
    setNavActive('history');
    loadHistory().catch((error) => showToast(error?.message || 'Не удалось загрузить историю', true));
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  function installSeparatedHistory() {
    historyPanel = document.querySelector('.history-panel');
    editorPanel = document.querySelector('.editor-panel');
    nav = document.getElementById('kpBottomNav');
    if (!historyPanel || !editorPanel) return false;

    document.body.classList.add('kp-view-editor');
    document.body.classList.remove('kp-view-history');

    const head = historyPanel.querySelector('.section-head');
    if (head && !document.getElementById('kpHistoryBack')) {
      const refresh = document.getElementById('refreshHistoryBtn');
      const actions = document.createElement('div');
      actions.className = 'kp-history-head-actions';
      const back = document.createElement('button');
      back.id = 'kpHistoryBack';
      back.type = 'button';
      back.className = 'kp-history-back';
      back.textContent = '← К конструктору';
      back.addEventListener('click', showEditor);
      actions.appendChild(back);
      if (refresh) actions.appendChild(refresh);
      head.appendChild(actions);
    }

    if (!historyPanel.querySelector('.kp-history-panel-note')) {
      const note = document.createElement('p');
      note.className = 'kp-history-panel-note';
      note.textContent = 'Здесь находятся только созданные коммерческие предложения.';
      const history = document.getElementById('history');
      history?.before(note);
    }

    if (nav && nav.dataset.polishHistoryBound !== '1') {
      nav.dataset.polishHistoryBound = '1';
      nav.addEventListener('click', (event) => {
        const button = event.target.closest('[data-nav]');
        if (!button) return;
        if (button.dataset.nav === 'history') {
          event.preventDefault();
          event.stopImmediatePropagation();
          showHistory();
        } else if (button.dataset.nav === 'new') {
          showEditor();
        }
      }, true);
    }
    return true;
  }

  function installPreviewAction() {
    const createButton = document.getElementById('kpFlowCreateQuote');
    const actions = createButton?.closest('.kp-flow-step-actions');
    if (!createButton || !actions) return false;

    if (!document.getElementById('kpPolishPreviewButton')) {
      const button = document.createElement('button');
      button.id = 'kpPolishPreviewButton';
      button.type = 'button';
      button.className = 'kp-polish-preview';
      button.textContent = 'Предпросмотр';
      button.addEventListener('click', async () => {
        const old = button.textContent;
        button.disabled = true;
        button.textContent = 'Открываем…';
        try {
          await previewCurrent();
        } catch (error) {
          showToast(error?.message || 'Не удалось открыть предпросмотр', true);
        } finally {
          button.disabled = false;
          button.textContent = old;
        }
      });
      actions.insertBefore(button, createButton);
    }

    const modalPdf = document.getElementById('modalPdfBtn');
    if (modalPdf) modalPdf.textContent = 'Создать / Скачать КП';
    const modalTitle = document.querySelector('#previewModal .modal-head strong');
    if (modalTitle) modalTitle.textContent = 'Предпросмотр КП';
    return true;
  }

  function installNoZoomSafeguards() {
    document.querySelectorAll('input, select, textarea').forEach((element) => {
      element.style.fontSize = '16px';
    });
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.('input, select, textarea')) node.style.fontSize = '16px';
          node.querySelectorAll?.('input, select, textarea').forEach((element) => { element.style.fontSize = '16px'; });
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function wrapLifecycle() {
    if (lifecycleWrapped) return;
    lifecycleWrapped = true;
    const oldReset = resetForm;
    resetForm = async function polishResetForm(...args) {
      const result = await oldReset(...args);
      ensureExpandedCatalog();
      setTimeout(() => {
        installServiceDiscovery();
        installPreviewAction();
        showEditor();
      }, 0);
      return result;
    };
  }

  async function install() {
    for (let i = 0; i < 160 && !document.getElementById('kpFlowRoot'); i += 1) await sleep(25);
    for (let i = 0; i < 80 && !document.getElementById('kpBottomNav'); i += 1) await sleep(25);

    ensureExpandedCatalog();
    installServiceDiscovery();
    installSeparatedHistory();
    installPreviewAction();
    installNoZoomSafeguards();
    wrapLifecycle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => install().catch((error) => console.error('KP polish v3 failed', error)), { once: true });
  } else {
    install().catch((error) => console.error('KP polish v3 failed', error));
  }
})();
