const tg = window.Telegram?.WebApp;

function authHeaders(extra = {}) {
  return {
    'X-Telegram-Init-Data': tg?.initData || '',
    ...extra,
  };
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Ошибка ${response.status}`);
  return data;
}

export const api = {
  bootstrap: () => request('/api/bootstrap'),
  orders: () => request('/api/orders'),
  order: (id) => request(`/api/orders/${id}`),
  availability: (date) => request(`/api/availability?date=${encodeURIComponent(date)}`),
  updateMe: (payload) => request('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  cancelOrder: (id) => request(`/api/orders/${id}/cancel`, { method: 'POST' }),
  createOrder: async (payload, photos) => {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    photos.forEach((photo, index) => form.append('photos', photo, `object-${index + 1}.jpg`));
    return request('/api/orders', { method: 'POST', body: form });
  },
  photoUrl: (orderId, photoId) => `/api/orders/${orderId}/photos/${photoId}`,
};
