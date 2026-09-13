import { renderConciergeHome as renderBaseHome } from './concierge-home-v3.js?v=34';

export async function renderConciergeHome(root, navigate) {
  await renderBaseHome(root, navigate);
  if (!root.querySelector('.cc-home')) return;

  root.querySelector('[data-call]')?.remove();
  const manager = root.querySelector('[data-manager]');
  if (manager) manager.textContent = '✉️ Написать менеджеру';

  const faq = root.querySelector('[data-tool="faq"]');
  if (faq) faq.onclick = () => navigate('profile', { section: 'faq', from: 'home' });

  const contact = root.querySelector('.hc-home-contact');
  if (contact && !root.querySelector('[data-subscription-banner]')) {
    const banner = document.createElement('section');
    banner.className = 'card hc-subscription-banner';
    banner.dataset.subscriptionBanner = '1';
    banner.innerHTML = `<div class="hc-subscription-badge">АБОНЕМЕНТЫ</div><div><h3>Регулярная уборка — проще</h3><p>5 или 10 уборок с заранее согласованным графиком и без повторного оформления каждой заявки.</p></div><button type="button" class="hc-btn hc-btn-gold" data-open-subscriptions>Посмотреть абонементы</button>`;
    contact.insertAdjacentElement('beforebegin', banner);
    banner.querySelector('[data-open-subscriptions]').onclick = () => navigate('profile', { section: 'subscriptions', from: 'home' });
  }
}
