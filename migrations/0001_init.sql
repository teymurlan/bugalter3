PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT,
  name TEXT,
  phone TEXT,
  photo_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('primary', 'addon')),
  name TEXT NOT NULL,
  description TEXT,
  price_per_m2 INTEGER,
  fixed_price INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  property_type TEXT NOT NULL,
  area REAL NOT NULL,
  rooms INTEGER NOT NULL DEFAULT 0,
  bathrooms INTEGER NOT NULL DEFAULT 0,
  pets INTEGER NOT NULL DEFAULT 0,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  apartment TEXT,
  entrance TEXT,
  floor TEXT,
  address_comment TEXT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','REVIEW','CONFIRMED','CLEANER_ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  estimated_price INTEGER,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_date_time ON orders(date, time, status);

CREATE TABLE IF NOT EXISTS order_services (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  PRIMARY KEY(order_id, service_id)
);

CREATE TABLE IF NOT EXISTS order_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_photos_order ON order_photos(order_id, sort_order);

CREATE TABLE IF NOT EXISTS date_blocks (
  date TEXT PRIMARY KEY,
  is_closed INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS slot_blocks (
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(date, time)
);

INSERT OR IGNORE INTO services (code, kind, name, description, price_per_m2, sort_order) VALUES
('general', 'primary', 'Генеральная уборка', 'Глубокая уборка квартиры или дома', NULL, 10),
('maintenance', 'primary', 'Поддерживающая уборка', 'Регулярное поддержание чистоты', NULL, 20),
('post-renovation', 'primary', 'После ремонта', 'Строительная пыль и сложные загрязнения', NULL, 30),
('commercial', 'primary', 'Коммерческая уборка', 'Офисы и коммерческие помещения', NULL, 40);

INSERT OR IGNORE INTO services (code, kind, name, description, fixed_price, sort_order) VALUES
('windows', 'addon', 'Мытьё окон', 'Окна и стеклянные поверхности', NULL, 10),
('fridge', 'addon', 'Холодильник внутри', 'Очистка внутренних поверхностей холодильника', NULL, 20),
('oven', 'addon', 'Духовка внутри', 'Очистка духовки изнутри', NULL, 30),
('cabinets', 'addon', 'Кухонные шкафы внутри', 'Очистка внутренних поверхностей шкафов', NULL, 40),
('balcony', 'addon', 'Балкон', 'Дополнительная уборка балкона', NULL, 50),
('ironing', 'addon', 'Глажка', 'Дополнительная глажка вещей', NULL, 60);
