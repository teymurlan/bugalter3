import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v44-production.js';

export { ConsentStore };

const MAX_DEFECT_BYTES = 12 * 1024 * 1024;

export class AppStore extends BaseAppStore {
  constructor(state, env) {
    super(state, env);
    this.hcState = state;
    this.hcEnv = env;
  }

  async notifyClientDefect(payload = {}) {
    const orderNumber = cleanOrderNumber(payload.order_number);
    const defectId = cleanId(payload.defect_id);
    const note = clean(payload.note, 500);
    const bytes = toBytes(payload.bytes);
    const mime = imageMime(payload.mime_type);
    if (!orderNumber || !defectId || !bytes || !bytes.byteLength) return { ok:false, error:'Некорректные данные дефекта' };
    if (bytes.byteLength > MAX_DEFECT_BYTES) return { ok:false, error:'Фото дефекта слишком большое для уведомления' };

    const sentKey = `staff:defect:client:${orderNumber}:${defectId}`;
    const existing = await this.hcState.storage.get(sentKey);
    if (existing) return { ok:true, already_sent:true, ...existing };

    const ordersResponse = await super.fetch(new Request('https://app.internal/orders'));
    if (!ordersResponse?.ok) return { ok:false, error:'Заказ клиента не найден' };
    const data = await ordersResponse.json().catch(() => ({}));
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    const order = orders.find((row) => String(row?.order_number || '') === orderNumber);
    if (!order) return { ok:false, error:'Заказ клиента не найден' };

    const chatId = positiveInt(order.client_telegram_id || order.telegram_id || order.client_id);
    if (!chatId) return { ok:false, skipped:true, reason:'У заказа нет Telegram ID клиента' };
    const token = String(this.hcEnv?.TELEGRAM_BOT_TOKEN || '');
    if (!token) return { ok:false, error:'Клиентский бот не настроен' };

    const introKey = `staff:defect:intro:${orderNumber}`;
    if (!(await this.hcState.storage.get(introKey))) {
      const address = [order.city, order.address, order.apartment ? `кв./офис ${order.apartment}` : ''].filter(Boolean).join(', ');
      const intro = [
        '⚠️ <b>На объекте зафиксирован дефект до начала уборки</b>',
        '',
        `Заказ: <b>${esc(orderNumber)}</b>`,
        address ? `Адрес: ${esc(address)}` : '',
        '',
        'Клинер отметил существующее повреждение до начала работ. Ниже отправляем только фотографии отмеченных дефектов.',
      ].filter(Boolean).join('\n');
      await telegramJson(token, 'sendMessage', { chat_id:chatId, text:intro, parse_mode:'HTML' });
      await this.hcState.storage.put(introKey, { at:Date.now(), chat_id:chatId });
    }

    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([bytes], { type:mime }), `defect-${defectId}.jpg`);
    form.append('caption', note ? `⚠️ Дефект до уборки\n${note}` : '⚠️ Дефект до уборки');
    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method:'POST', body:form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) return { ok:false, error:result?.description || 'Не удалось отправить дефект клиенту' };

    const saved = { at:Date.now(), chat_id:chatId, message_id:Number(result?.result?.message_id || 0) };
    await this.hcState.storage.put(sentKey, saved);
    return { ok:true, ...saved };
  }
}

export default baseWorker;

function toBytes(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return null;
}
function imageMime(value) {
  const v=String(value||'').toLowerCase();
  return ['image/jpeg','image/png','image/webp'].includes(v) ? v : 'image/jpeg';
}
function cleanOrderNumber(value) {
  const raw=String(value||'').trim();
  return /^[A-Za-z0-9._-]{3,120}$/.test(raw) ? raw : '';
}
function cleanId(value) {
  const raw=String(value||'').trim();
  return /^[A-Za-z0-9._:-]{3,180}$/.test(raw) ? raw : '';
}
function clean(value,n=500) { return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n); }
function positiveInt(value) { const n=Number(value); return Number.isSafeInteger(n)&&n>0?n:0; }
function esc(value) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c)); }
async function telegramJson(token,method,payload) {
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const x=await r.json().catch(()=>({}));
  if(!r.ok||!x?.ok) throw new Error(x?.description||`Telegram ${method} failed`);
  return x.result;
}
