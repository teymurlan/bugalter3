export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  BOT_USERNAME: string;
  ADMIN_TELEGRAM_IDS: string;
  ENVIRONMENT?: string;
}

export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
};

export type AuthContext = {
  telegramUser: TelegramUser;
  dbUserId: number;
};

export type OrderPayload = {
  serviceId: number;
  propertyType: string;
  area: number;
  rooms: number;
  bathrooms: number;
  pets: boolean;
  addonIds: number[];
  city: string;
  address: string;
  apartment?: string;
  entrance?: string;
  floor?: string;
  addressComment?: string;
  date: string;
  time: string;
  customerName: string;
  phone: string;
  comment?: string;
  idempotencyKey: string;
};
