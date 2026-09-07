# HOUSE CLEANING — Telegram Mini App

Полная новая версия клиентского Mini App для записи на уборку. Старый проект не используется.

## Что уже реализовано

- premium dark UI в стиле HOUSE CLEANING;
- пошаговая запись: услуга → объект → доп. услуги → фото → адрес → дата/время → контакты → проверка;
- обязательная загрузка 1–10 фотографий с клиентским сжатием;
- Telegram Mini App `initData` validation на сервере;
- Cloudflare D1 для пользователей, услуг, заявок и расписания;
- Cloudflare R2 для приватных фотографий;
- защита от IDOR: заявка и фото отдаются только владельцу;
- idempotency key от двойного создания заявки;
- занятые/закрытые слоты времени;
- «Мои заявки», статусы, детали заявки, отмена NEW/REVIEW;
- профиль и редактирование контактных данных;
- уведомление клиента через Telegram Bot API;
- уведомление администраторов с кнопкой «Подтвердить»;
- webhook Telegram для подтверждения заявки администратором.

## Архитектура

- `public/` — Telegram Mini App без тяжёлого frontend-фреймворка.
- `src/` — Cloudflare Worker API.
- `migrations/` — схема D1 и стартовые услуги.
- `R2` — оригиналы/оптимизированные фото объекта.

## 1. Cloudflare

Создайте D1:

```bash
npx wrangler d1 create house-cleaning
```

Создайте R2 bucket:

```bash
npx wrangler r2 bucket create house-cleaning-photos
```

Скопируйте конфигурацию:

```bash
cp wrangler.toml.example wrangler.toml
```

В `wrangler.toml` замените:

- `REPLACE_WITH_D1_DATABASE_ID`
- `REPLACE_WITH_BOT_USERNAME`
- `REPLACE_WITH_ADMIN_TELEGRAM_ID`

## 2. Секреты

Никогда не коммитьте токен бота.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

`TELEGRAM_WEBHOOK_SECRET` придумайте как длинную случайную строку.

## 3. Миграция

```bash
npm install
npm run db:migrate:remote
```

## 4. Deploy

```bash
npm run deploy
```

## 5. Telegram Webhook

После deploy установите webhook бота на:

`https://YOUR_WORKER_DOMAIN/telegram/webhook`

и передайте `secret_token`, совпадающий с `TELEGRAM_WEBHOOK_SECRET`.

## 6. Mini App

В BotFather укажите HTTPS URL развернутого Worker/Mini App как Web App URL кнопки меню.

## Безопасность

- Bot token существует только в Worker Secret.
- Frontend не принимает Telegram ID как источник истины.
- Каждый API request проверяет подпись `initData`.
- Фото R2 не публичные и отдаются через авторизованный API.
- MIME/размер/количество фото проверяются на сервере.
- `order_id` всегда проверяется вместе с `user_id`.

## Следующий этап

После первого deploy нужно добавить административное управление услугами, расписанием и ценами (web admin panel), а также end-to-end проверку на реальном Telegram WebView.
