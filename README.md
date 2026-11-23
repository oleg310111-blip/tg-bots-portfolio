# Telegram Bots & Automation Portfolio

Примеры рабочего кода и архитектуры для Telegram-ботов, мини-приложений, серверных API и систем автоматизации на Python (`aiogram 3`, `Telethon`, `SQLite`), JavaScript (`Cloudflare Workers`, `Three.js`) и чистом вебе.

Живой бот для теста: https://t.me/notofiction231_bot

## Состав репозитория

1. [telegram-order-bot](./telegram-order-bot/)
   - Асинхронный бот на `aiogram 3` с пошаговой FSM-анкетой, калькулятором стоимости, SQLite-базой (`db.py`), админ-панелью со сменой статусов и экспортом в CSV.
   - Включает серверный обработчик на Cloudflare Workers (`cloudflare_worker/worker.js`) с пересчетом стоимости на стороне сервера, rate-limit и защитой от XSS/CSV-инъекций.
   - Покрыт `42` автотестами (`pytest`).

2. [lead-filter-pipeline](./lead-filter-pipeline/)
   - Трехступенчатый конвейер отбора целевых сообщений в Telegram (`dedup.py`, `classifier.py`, `ai_verifier.py`, `tg_client.py`).
   - Кросс-чат дедупликация по шинглам, ролевая фильтрация заявок, асинхронная ИИ-верификация с кэшем и безопасный клиент Telethon с кэшированием пиров и защитой от `FloodWait`.

3. [docs](./docs/)
   - Статический веб-портал услуг без сборки и сторонних CDN: WebGL 3D-сцена (`Three.js`), GLSL-шейдер, калькулятор стоимости с полным паритетом логики `calculator.py`, строгая валидация форм и локальные шрифты.

## Контакты

- Telegram: [@SQUZZER_ATELIER](https://t.me/SQUZZER_ATELIER)
