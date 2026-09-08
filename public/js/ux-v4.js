const app = document.querySelector('#app');
let observerQueued = false;

function isHome() {
  return Boolean(document.querySelector('.home-hero') && document.querySelector('[data-start]'));
}

function ensureHomeCta() {
  const home = isHome();
  app?.classList.toggle('home-screen', home);
  let cta = document.querySelector('#home-fixed-cta');
  if (!home) {
    cta?.remove();
    return;
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
  if (title) title.textContent = 'Уборка в удобный день — без лишних звонков';
  if (text) text.textContent = 'Выберите формат уборки, укажите площадь, добавьте фото и сразу посмотрите доступные даты. Заявка займёт около двух минут.';
}

function polishStartCard() {
  const card = document.querySelector('.start-card');
  if (!card) return;
  const h2 = card.querySelector('h2');
  const p = card.querySelector('p');
  const button = card.querySelector('[data-start]');
  if (h2) h2.textContent = 'Всё понятно на каждом шаге';
  if (p) p.textContent = 'Черновик сохраняется автоматически. До отправки заявки можно вернуться назад и изменить любые данные.';
  if (button) button.textContent = 'Начать оформление';
}

function addNotificationHint() {
  const success = document.querySelector('.success');
  if (!success || success.querySelector('.notification-note')) return;
  const note = document.createElement('div');
  note.className = 'notification-note';
  note.textContent = 'После отправки бот сразу пришлёт сообщение о получении заявки. Затем уведомит о подтверждении, завершении и отмене.';
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
