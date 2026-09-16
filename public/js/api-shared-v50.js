import { api, isDemoMode } from './api.js';

const tg = window.Telegram?.WebApp;

function authHeaders(extra = {}) {
  return { 'X-Telegram-Init-Data': tg?.initData || '', ...extra };
}

async function readJson(response, fallback) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || fallback);
  return data;
}

export async function sharedAvailability(date) {
  const value = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Некорректная дата');
  const response = await fetch(`/api/demo-availability?date=${encodeURIComponent(value)}&v=50`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  return readJson(response, 'Не удалось получить актуальную занятость. Попробуйте ещё раз.');
}

export async function sharedKnownAddress({ city = '', address = '', apartment = '' } = {}) {
  const response = await fetch('/api/demo-known-address?v=50', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ city, address, apartment }),
    cache: 'no-store',
  });
  const data = await readJson(response, 'Не удалось проверить историю адреса');
  return Boolean(data?.known);
}

if (isDemoMode && api && typeof api === 'object') {
  api.availability = sharedAvailability;
}
