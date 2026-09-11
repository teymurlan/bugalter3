const app = document.querySelector('#app');
let observerQueued = false;
let lastHomeState = false;

function isHome() {
  return Boolean(document.querySelector('.home-hero') && document.querySelector('[data-start]'));
}

function ensureHomeCta() {
  const home = isHome();
  app?.classList.toggle('home-screen', home);

  let cta = document.querySelector('#home-fixed-cta');
  if (!home) {
    cta?.remove();
    lastHomeState = false;
    return;
  }

  if (!lastHomeState) {
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    lastHomeState = true;
  }

  if (!cta) {
    cta = document.createElement('button');
    cta.id = 'home-fixed-cta';
    cta.type = 'button';
    cta.className = 'home-fixed-cta';
    cta.textContent = 'Заказать уборку';
    cta.addEventListener('click', () => document.querySelector('[data-start]')?.click());
    document.body.appendChild(cta);
  }
}

function polishHomeCopy() {
  const hero = document.querySelector('.home-hero');
  if (!hero) return;

  const eyebrow = hero.querySelector('.eyebrow');
  const title = hero.querySelector('.hero-copy h1');
  const text = hero.querySelector('.hero-copy p');

  if (eyebrow) eyebrow.textContent = 'HOUSE CLEANING · ЗАПИСЬ ОНЛАЙН';
  if (title) title.textContent = 'Чистый дом — в удобный для вас день';
  if (text) {
    text.textContent = 'Выберите уборку, укажите площадь, добавьте фото объекта и сразу посмотрите свободные даты. Всё оформление занимает около двух минут.';
  }
}

function polishStartCard() {
  const card = document.querySelector('.start-card');
  if (!card) return;

  const h2 = card.querySelector('h2');
  const p = card.querySelector('p');
  const trigger = card.querySelector('[data-start]');
  const benefits = document.querySelector('.quick-benefits');

  if (h2) h2.textContent = 'Всё понятно на каждом шаге';
  if (p) {
    p.textContent = 'Черновик сохраняется автоматически. До отправки заявки можно вернуться назад и изменить любые данные.';
  }

  if (benefits && benefits.parentElement !== card) {
    card.insertBefore(benefits, trigger || null);
  }

  if (trigger) {
    trigger.classList.add('start-trigger-hidden');
    trigger.setAttribute('aria-hidden', 'true');
    trigger.tabIndex = -1;
  }
}

function addNotificationHint() {
  const success = document.querySelector('.success');
  if (!success || success.classList.contains('success-v2') || success.querySelector('.notification-note')) return;

  const note = document.createElement('div');
  note.className = 'notification-note';
  note.textContent = 'Заявка оформлена. Скоро менеджер свяжется с вами для подтверждения.';
  const card = success.querySelector('.success-order');
  card?.after(note);
}

function run() {
  ensureHomeCta();
  polishHomeCopy();
  polishStartCard();
  addNotificationHint();
}

const observer = new MutationObserver(() => {
  if (observerQueued) return;
  observerQueued = true;
  requestAnimationFrame(() => {
    observerQueued = false;
    run();
  });
});

observer.observe(document.documentElement, { childList: true, subtree: true });
run();