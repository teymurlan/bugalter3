function enhanceHomeV4() {
  const hero = document.querySelector('.home-hero');
  if (!hero || hero.dataset.v4 === '1') return;
  hero.dataset.v4 = '1';
  const copy = hero.querySelector('.hero-copy');
  const original = document.querySelector('.start-card [data-start]');
  if (!copy || !original) return;

  const title = copy.querySelector('h1');
  const text = copy.querySelector('p');
  if (title) title.textContent = 'Профессиональная уборка — в удобный для вас день';
  if (text) text.textContent = 'Оформите заявку за несколько минут. Мы увидим фото объекта, проверим дату и подтвердим заказ в Telegram.';

  if (!copy.querySelector('.hero-primary-cta')) {
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'hero-primary-cta';
    cta.textContent = 'Заказать уборку';
    cta.onclick = () => original.click();
    copy.appendChild(cta);
  }

  const card = document.querySelector('.start-card');
  if (card && !card.querySelector('.notification-note')) {
    const note = document.createElement('div');
    note.className = 'notification-note';
    note.textContent = 'После отправки заявки подтверждения и изменения статуса будут приходить вам сообщениями в Telegram.';
    card.appendChild(note);
  }
}

let timer;
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(enhanceHomeV4, 20);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceHomeV4();
