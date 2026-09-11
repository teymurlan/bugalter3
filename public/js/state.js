const STORAGE_KEY = 'hc-booking-draft-v1';
const DB_NAME = 'house-cleaning-mini-app';
const DB_VERSION = 1;
const PHOTO_STORE = 'draft_photos';

function defaultDraft() {
  return {
    step: 0,
    serviceId: null,
    propertyType: 'apartment',
    area: 50,
    rooms: 2,
    bathrooms: 1,
    pets: false,
    addonIds: [],
    serviceArea: 'spb',
    city: 'Санкт-Петербург',
    address: '',
    apartment: '',
    entrance: '',
    floor: '',
    addressComment: '',
    date: '',
    time: '',
    customerName: '',
    phone: '',
    contactMethod: 'telegram',
    comment: '',
    idempotencyKey: crypto.randomUUID(),
  };
}

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return { ...defaultDraft(), ...(saved || {}) };
  } catch {
    return defaultDraft();
  }
}

function openPhotoDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB error'));
  });
}

async function withStore(mode, callback) {
  const db = await openPhotoDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, mode);
      const store = tx.objectStore(PHOTO_STORE);
      callback(store, resolve, reject);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction error'));
    });
  } finally {
    db.close();
  }
}

export const state = {
  bootstrap: null,
  route: 'booking',
  draft: loadDraft(),
  photos: [],
  saveDraft() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.draft));
  },
  async persistPhotos() {
    try {
      const files = this.photos.map((item) => item.file);
      await withStore('readwrite', (store, resolve) => {
        store.clear();
        files.forEach((file, index) => store.put({ id: index, file }));
        store.transaction.oncomplete = () => resolve();
      });
    } catch (error) {
      console.warn('Unable to persist draft photos', error);
    }
  },
  async restorePhotos() {
    try {
      const rows = await withStore('readonly', (store, resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      this.photos.forEach((item) => URL.revokeObjectURL(item.url));
      this.photos = rows.sort((a, b) => a.id - b.id).slice(0, 10).map((row) => ({ file: row.file, url: URL.createObjectURL(row.file) }));
    } catch (error) {
      console.warn('Unable to restore draft photos', error);
    }
  },
  async resetDraft() {
    this.draft = defaultDraft();
    this.photos.forEach((item) => URL.revokeObjectURL(item.url));
    this.photos = [];
    this.saveDraft();
    try {
      await withStore('readwrite', (store, resolve) => {
        store.clear();
        store.transaction.oncomplete = () => resolve();
      });
    } catch (error) {
      console.warn('Unable to clear draft photos', error);
    }
  },
};