import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v13.js';

export { ConsentStore };

const KP_VERSION = '13';
const DEFAULT_DURATION = '1–2 дня';
const DEFAULT_EQUIPMENT = [
  'Моющий пылесос Karcher WD 3',
  'Пылесос для сухой уборки Karcher WD 6',
  'Пароочиститель Karcher SC 4',
].join('\n');

const COMMERCIAL_PRESETS = Object.freeze([
  { group: 'Основные тарифы', name: 'Коммерческая уборка', unit: 'м²', price: 95 },
  { group: 'Основные тарифы', name: 'Генеральная уборка', unit: 'м²', price: 230 },
  { group: 'Основные тарифы', name: 'Поддерживающая уборка', unit: 'м²', price: 95 },
  { group: 'Основные тарифы', name: 'Уборка после ремонта', unit: 'м²', price: 230 },
  { group: 'Отдельные работы', name: 'Обеспыливание потолков, вентиляционных решёток и коммуникаций', unit: 'м²', price: 0 },
  { group: 'Отдельные работы', name: 'Обеспыливание стен и поверхностей', unit: 'м²', price: 0 },
  { group: 'Отдельные работы', name: 'Мытьё окон', unit: 'шт.', price: 0 },
  { group: 'Отдельные работы', name: 'Мытьё витрин', unit: 'м²', price: 0 },
  { group: 'Отдельные работы', name: 'Мытьё дверей', unit: 'шт.', price: 0 },
  { group: 'Отдельные работы', name: 'Мытьё стеклянных перегородок', unit: 'м²', price: 0 },
  { group: 'Отдельные работы', name: 'Мытьё полов', unit: 'м²', price: 0 },
  { group: 'Отдельные работы', name: 'Мытьё плинтусов', unit: 'пог. м', price: 0 },
  { group: 'Отдельные работы', name: 'Уборка санузлов', unit: 'усл.', price: 0 },
  { group: 'Отдельные работы', name: 'Удаление строительной пыли и загрязнений', unit: 'м²', price: 0 },
  { group: 'Отдельные работы', name: 'Локальная очистка труднодоступных участков', unit: 'усл.', price: 0 },
]);

export class AppStore extends BaseAppStore {
  async saveQuote(raw) {
    const quote = await super.saveQuote(raw);
    const equipment = Object.prototype.hasOwnProperty.call(raw || {}, 'equipment')
      ? String(raw?.equipment || '').trim().slice(0, 1400)
      : String(quote?.equipment || DEFAULT_EQUIPMENT).trim().slice(0, 1400);

    const updated = { ...quote, equipment };
    await this.state.storage.put(`kp:item:${updated.id}`, updated);
    return updated;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/kp') {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = '/kp/';
      redirectUrl.searchParams.set('v', KP_VERSION);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    if (request.method === 'GET' && url.pathname === '/api/kp/bootstrap') {
      const response = await baseWorker.fetch(request, env, ctx);
      return patchBootstrap(response);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};

async function patchBootstrap(response) {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) return response;

  let data;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }

  if (data?.ok) {
    data.presets = COMMERCIAL_PRESETS;
    data.defaults = {
      ...(data.defaults || {}),
      duration: DEFAULT_DURATION,
      equipment: DEFAULT_EQUIPMENT,
      object_type: 'Коммерческое помещение',
      title: 'Коммерческое предложение на оказание клининговых услуг',
    };
  }

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=UTF-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
