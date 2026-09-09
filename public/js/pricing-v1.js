import { state } from './state.js';

const RATE_BY_CODE = {
  general: 230,
  maintenance: 95,
  post_renovation: 230,
  'post-renovation': 230,
  commercial: 95,
};

const RATE_BY_ID = {
  1: 230,
  2: 95,
  3: 230,
  4: 95,
};

const rub = new Intl.NumberFormat('ru-RU');

function rateFor(service) {
  if (!service) return 0;
  const configured = Number(service.price_per_m2 || 0);
  if (configured > 0) return configured;
  return RATE_BY_CODE[String(service.code || '')] || RATE_BY_ID[Number(service.id)] || 0;
}

function applyRatesToState() {
  const services = state.bootstrap?.services;
  if (!Array.isArray(services)) return;
  services.forEach((service) => {
    if (service.kind !== 'primary') return;
    const rate = rateFor(service);
    if (rate > 0) service.price_per_m2 = rate;
  });
}

function primaryService() {
  const services = state.bootstrap?.services || [];
  return services.find((service) => Number(service.id) === Number(state.draft?.serviceId));
}

function estimateFor(areaValue) {
  const service = primaryService();
  const rate = rateFor(service);
  const area = Math.max(0, Number(areaValue ?? state.draft?.area ?? 0));
  const addons = (state.bootstrap?.services || []).filter((item) => (state.draft?.addonIds || []).includes(item.id));
  const addonTotal = addons.reduce((sum, item) => sum + Number(item.fixed_price || 0), 0);
  return {
    service,
    rate,
    area,
    total: rate > 0 && area > 0 ? Math.round(rate * area + addonTotal) : 0,
  };
}

function decorateServiceCards() {
  const cards = document.querySelectorAll('.service-card[data-service]');
  if (!cards.length) return;
  const services = state.bootstrap?.services || [];

  cards.forEach((card) => {
    const service = services.find((item) => Number(item.id) === Number(card.dataset.service));
    const rate = rateFor(service);
    if (!rate) return;
    let price = card.querySelector('.hc-service-rate');
    if (!price) {
      price = document.createElement('span');
      price.className = 'hc-service-rate';
      card.appendChild(price);
    }
    price.textContent = `от ${rub.format(rate)} ₽/м²`;
  });

  const grid = document.querySelector('.service-grid');
  if (grid && !document.querySelector('.hc-pricing-explainer')) {
    const note = document.createElement('div');
    note.className = 'hc-pricing-explainer';
    note.innerHTML = '<strong>Стоимость рассчитывается по площади</strong><span>Ставка зависит от выбранного вида уборки. Итоговая сумма на этапе оформления — предварительная. Точную стоимость рассчитает менеджер после оценки объекта и фотографий.</span>';
    grid.insertAdjacentElement('afterend', note);
  }
}

function decorateAreaEstimate() {
  const areaPanel = document.querySelector('.area-panel');
  if (!areaPanel) return;
  const input = document.querySelector('[data-area-input]');
  const area = input ? Number(input.value || 0) : Number(state.draft?.area || 0);
  const { service, rate, total } = estimateFor(area);
  if (!service || !rate) return;

  let card = document.querySelector('[data-hc-estimate]');
  if (!card) {
    card = document.createElement('div');
    card.className = 'hc-estimate-card';
    card.dataset.hcEstimate = '1';
    areaPanel.insertAdjacentElement('afterend', card);
  }

  const signature = `${service.id}:${area}:${rate}:${total}`;
  if (card.dataset.signature !== signature) {
    card.dataset.signature = signature;
    card.innerHTML = `
      <div class="hc-estimate-top">
        <div><span>Предварительная стоимость</span><strong>${total > 0 ? `от ${rub.format(total)} ₽` : 'Укажите площадь'}</strong></div>
        <div class="hc-rate-pill">${rub.format(rate)} ₽/м²</div>
      </div>
      <div class="hc-estimate-formula">${area > 0 ? `${rub.format(area)} м² × ${rub.format(rate)} ₽/м²` : 'Расчёт появится после ввода площади'}</div>
      <div class="hc-estimate-note">Это ориентировочный расчёт по площади. <b>Точную стоимость рассчитает менеджер</b> после оценки состояния объекта, фотографий и дополнительных работ.</div>`;
  }

  if (input && !input.dataset.hcPriceBound) {
    input.dataset.hcPriceBound = '1';
    input.addEventListener('input', () => setTimeout(decorateAreaEstimate, 0));
  }
  const range = document.querySelector('[data-area-range]');
  if (range && !range.dataset.hcPriceBound) {
    range.dataset.hcPriceBound = '1';
    range.addEventListener('input', () => setTimeout(decorateAreaEstimate, 0));
  }
}

function decorateReviewPrice() {
  const card = document.querySelector('.price-card');
  if (!card) return;
  const { rate, area, total } = estimateFor();
  if (!rate || !area) return;

  const price = card.querySelector('.price');
  if (price) price.textContent = `от ${rub.format(total)} ₽`;

  let details = card.querySelector('.hc-review-price-details');
  if (!details) {
    details = document.createElement('div');
    details.className = 'hc-review-price-details';
    card.appendChild(details);
  }
  details.innerHTML = `<span>${rub.format(area)} м² × ${rub.format(rate)} ₽/м²</span><p>Предварительный расчёт. <b>Точную стоимость рассчитает менеджер</b> после просмотра фотографий и оценки объекта.</p>`;
}

function decorate() {
  applyRatesToState();
  decorateServiceCards();
  decorateAreaEstimate();
  decorateReviewPrice();
}

const observer = new MutationObserver(() => decorate());
const root = document.querySelector('#app');
if (root) observer.observe(root, { childList: true, subtree: true });

document.addEventListener('DOMContentLoaded', decorate, { once: true });
setTimeout(decorate, 250);
setTimeout(decorate, 900);