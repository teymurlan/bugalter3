const viewport = window.visualViewport;
let activeField = null;
let timer = null;

function isTextControl(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function currentDoneButton() {
  return document.querySelector('#keyboard-done');
}

function positionDoneButton() {
  const button = currentDoneButton();
  if (!button || !document.body.classList.contains('keyboard-open')) return;
  const visibleTop = viewport?.offsetTop || 0;
  const visibleHeight = viewport?.height || window.innerHeight;
  const top = Math.max(74, visibleTop + visibleHeight - 58);
  document.documentElement.style.setProperty('--keyboard-done-top', `${Math.round(top)}px`);
  button.textContent = 'Готово ✓';
}

function keepFieldVisible() {
  if (!activeField || !document.body.contains(activeField)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const field = activeField.closest('.field') || activeField;
    field.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    positionDoneButton();
  }, 220);
}

document.addEventListener('focusin', (event) => {
  const target = event.target;
  if (!isTextControl(target)) return;
  if (target.type === 'file' || target.type === 'range' || target.type === 'date') return;
  activeField = target;
  document.body.classList.add('keyboard-open');
  keepFieldVisible();
  setTimeout(positionDoneButton, 60);
});

document.addEventListener('focusout', () => {
  setTimeout(() => {
    const current = document.activeElement;
    if (isTextControl(current) && current.type !== 'file' && current.type !== 'range' && current.type !== 'date') {
      activeField = current;
      keepFieldVisible();
      return;
    }
    activeField = null;
  }, 220);
});

viewport?.addEventListener('resize', () => {
  positionDoneButton();
  keepFieldVisible();
});
viewport?.addEventListener('scroll', positionDoneButton);
window.addEventListener('resize', positionDoneButton);
