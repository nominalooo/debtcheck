# DebtCheck — проверка долгов по базе ФССП

Telegram бот для проверки исполнительных производств через открытое API ФССП России. Находит долги МФО, банков, ЖКХ, штрафы ГИБДД — всё что дошло до судебных приставов.

## Тарифы

| | Бесплатно | Разовая | Подписка |
|--|-----------|---------|----------|
| Цена | 0 ₽ | 99 ₽ | 199 ₽/мес |
| Проверок | 1 | 1 | Безлимит |
| Мониторинг | ❌ | ❌ | ✅ |

**До 100k/мес:** ~500 подписчиков или ~1000 разовых проверок

## Стек

- Telegraf (Node.js 20)
- ФССП открытое API (бесплатный токен)
- Supabase (PostgreSQL)
- YooKassa
- Railway.app

## Быстрый старт

```bash
git clone https://github.com/nominalooo/debtcheck.git
cd debtcheck
npm install
cp .env.example .env
```

Выполнить `src/db/schema.sql` в Supabase SQL Editor.

```bash
npm run dev
```

## Переменные окружения

| Переменная | Где взять |
|-----------|-----------|
| `BOT_TOKEN` | @BotFather → /newbot |
| `FSSP_TOKEN` | fssp.gov.ru/api → регистрация (бесплатно) |
| `SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role |
| `YOOKASSA_SHOP_ID` | yookassa.ru |
| `APP_URL` | Railway URL после деплоя |

## Структура

```
src/
├── index.js              # Express + bot + cron мониторинг
├── bot/index.js          # Telegram бот (ФИО → ФССП → результат)
├── fssp/index.js         # ФССП API клиент + парсер
├── payments/index.js     # YooKassa интеграция
├── notifications/        # Мониторинг изменений (каждые 6 часов)
├── db/                   # Supabase: схема, запросы
└── api/routes/webhook.js # YooKassa webhook
```
