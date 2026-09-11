import baseWorker, { ConsentStore, AppStore as BaseAppStore } from './demo-worker-v19-kp-flow.js';

export { ConsentStore };

const OUTGOING_COUNTER_KEY = 'kp:outgoing-counter:v2';
const RESET_MARKER = 'kp:outgoing-reset-to-15:first5-v1';
const OUTGOING_START = 15;

// Дополнительная совместимая защита для номеров, которые могли быть удалены
// ещё до появления постоянного реестра v3. Высший достигнутый счётчик считаем
// границей уже использованных номеров: новый документ не может вручную взять
// номер ниже или равный этой границе. Редактирование текущего КП сохраняет его номер.
export class AppStore extends BaseAppStore {
  async saveQuote(raw) {
    const existingId = cleanId(raw?.id);
    const existing = existingId ? await this.state.storage.get(`kp:item:${existingId}`) : null;
    const requested = parseOutgoingNumber(raw?.outgoing_number);
    const existingSequence = parseOutgoingNumber(existing?.quote_number);

    if (requested && existingSequence !== requested) {
      const resetDone = await this.state.storage.get(RESET_MARKER);
      if (resetDone) {
        const highWater = Math.max(
          OUTGOING_START - 1,
          Number(await this.state.storage.get(OUTGOING_COUNTER_KEY) || (OUTGOING_START - 1)),
        );
        if (requested <= highWater) {
          throw new Error(`Исх. № ${requested} уже использовался ранее`);
        }
      }
    }

    return super.saveQuote(raw);
  }
}

export default baseWorker;

function parseOutgoingNumber(value) {
  const match = String(value ?? '').match(/\d+/);
  if (!match) return 0;
  const number = Math.floor(Number(match[0]));
  return Number.isFinite(number) && number > 0 && number <= 999999 ? number : 0;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : '';
}
