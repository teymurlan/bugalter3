const boundInputs = new WeakSet();
const boundGroups = new WeakSet();

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function apply(root, query = '', filter = 'all') {
  const q = normalize(query);
  root.querySelectorAll('.hc-staff-card').forEach((card) => {
    const text = normalize(card.textContent);
    const status = normalize(card.querySelector('.hc-state')?.textContent);
    const queryOk = !q || text.includes(q);
    const filterOk = filter === 'all'
      || (filter === 'active' && status.includes('на смене'))
      || (filter === 'free' && status.includes('свобод'))
      || (filter === 'off' && (status.includes('выходн') || status.includes('не актив')));
    card.hidden = !(queryOk && filterOk);
  });
}

function bindStaffTools(root) {
  const input = root.querySelector('[data-staff-search]');
  const group = input?.closest('.hc-mobile-shell')?.querySelector('.hc-m-pills');
  if (!input || !group) return;

  if (!boundInputs.has(input)) {
    boundInputs.add(input);
    input.addEventListener('input', () => {
      const current = group.querySelector('button.active')?.dataset.staffFilter || 'all';
      apply(root, input.value, current);
    });
  }

  if (!boundGroups.has(group)) {
    boundGroups.add(group);
    const buttons = [...group.querySelectorAll('button')];
    const filters = ['all', 'active', 'free', 'off'];
    buttons.slice(0, 4).forEach((button, index) => {
      button.dataset.staffFilter = filters[index];
      button.addEventListener('click', () => {
        buttons.forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        apply(root, input.value, button.dataset.staffFilter);
        try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.(); } catch {}
      });
    });
  }
}

export function installAdminPolish(root) {
  if (!root) return;
  bindStaffTools(root);
  const observer = new MutationObserver(() => bindStaffTools(root));
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
