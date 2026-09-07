export const STATUS_LABELS = {
  NEW: 'Новая',
  REVIEW: 'На подтверждении',
  CONFIRMED: 'Подтверждена',
  CLEANER_ASSIGNED: 'Клинер назначен',
  IN_PROGRESS: 'В процессе',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
};

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

export function money(value) {
  return new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
}

export function showToast(message, error = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 2600);
}
showToast.timer = null;

export function modal({ title, text, confirmText = 'Подтвердить', danger = false }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'modal-backdrop';
    root.innerHTML = `
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
        <div class="modal-actions">
          <button class="secondary-btn" data-cancel>Назад</button>
          <button class="${danger ? 'danger-btn' : 'primary-btn'}" data-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.append(root);
    const finish = (value) => { root.remove(); resolve(value); };
    root.querySelector('[data-cancel]').onclick = () => finish(false);
    root.querySelector('[data-confirm]').onclick = () => finish(true);
    root.addEventListener('click', (event) => { if (event.target === root) finish(false); });
  });
}

export async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Выберите фотографию');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= 8 * 1024 * 1024) return file;
    throw new Error('Не удалось обработать это фото. Выберите другое изображение');
  }
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Не удалось обработать фото')), 'image/jpeg', .84));
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
}
