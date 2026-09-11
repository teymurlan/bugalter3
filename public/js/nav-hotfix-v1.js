import { navigate } from './app.js?v=26';

const nav = document.querySelector('#bottom-nav');
const focusContext = document.querySelector('#focus-context');
const params = new URLSearchParams(window.location.search);
const adminMode = params.get('admin') === '1';

if (nav && !adminMode) {
  let lastRoute = '';
  let lastAt = 0;

  const cleanupInputState = () => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
      try { active.blur(); } catch {}
    }
    document.body.classList.remove('keyboard-open');
    document.querySelector('#keyboard-done')?.classList.add('hidden');
    focusContext?.classList.remove('show');
    focusContext?.classList.add('hidden');
  };

  const routeButton = (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-route]') : null;
    return target && nav.contains(target) ? target : null;
  };

  const go = (button, event) => {
    const route = String(button?.dataset?.route || '');
    if (!['home', 'orders', 'profile'].includes(route)) return false;

    event?.preventDefault?.();
    event?.stopPropagation?.();
    cleanupInputState();

    lastRoute = route;
    lastAt = Date.now();

    try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.(); } catch {}
    navigate(route);
    return true;
  };

  nav.addEventListener('pointerup', (event) => {
    const button = routeButton(event);
    if (!button) return;
    go(button, event);
  }, true);

  nav.addEventListener('click', (event) => {
    const button = routeButton(event);
    if (!button) return;
    const route = String(button.dataset.route || '');

    event.preventDefault();
    event.stopImmediatePropagation();

    if (route === lastRoute && Date.now() - lastAt < 700) return;
    go(button, event);
  }, true);
}
