# PWA Budget

Учёт доходов и расходов с офлайн‑режимом, аналитикой и синхронизацией через локальный API.

**Возможности**
- CRUD транзакций с атрибутами (категория, участник, источник, дата, комментарий, сумма).
- Фильтрация по периодам и метаданным; сводные итоги (доход/расход/баланс).
- Аналитика на Chart.js: месячная динамика, расходы по категориям, распределение по измерению.
- Импорт/экспорт данных (JSON, CSV), экспорт графиков (PNG).
- Два режима: локальный (IndexedDB, PWA) и серверный (REST + SSE) с бюджетами и приглашениями.
- Информационный тикер с автообновлением данных криптовалют через локальный прокси CoinGecko.

**Технологии**
- Фронтенд: Vanilla JS (ES‑modules), IndexedDB, Chart.js, PWA (Service Worker + Web Manifest).
- Бэкенд: Node.js + Express, хранение в JSON‑файлах, REST API, Server‑Sent Events, CoinGecko‑прокси.
- Синхронизация: bulk‑операции, идемпотентность по хэшу содержимого и параметрам сделки, авто‑push.

**Установка и запуск**
- Windows/PowerShell:
  - API: `PowerShell ./projects/pwa-budget/server/run.ps1 -Port 8050`
  - Статика: `PowerShell ./projects/pwa-budget/dev-server.ps1 -Port 9090`
  - Открыть `http://127.0.0.1:9090/projects/pwa-budget/`
- Node.js:
  - API: `cd projects/pwa-budget/server && npm install && npm start`
  - Статика: `node projects/pwa-budget/dev-server.js` или `npx http-server -p 9090 -c-1 -a 127.0.0.1 projects/pwa-budget`
- PWA: Service Worker регистрируется (в проде); ассеты кешируются, данные — в IndexedDB.

**Архитектура**
- `src/app.js` — бизнес‑логика, фильтрация, итоги, интеграция графиков и синхронизации.
- `src/ui.js` — рендер списка транзакций и итогов.
- `src/charts.js` — построение графиков (Chart.js).
- `src/db.js` — IndexedDB: CRUD и хранение метаданных.
- `src/sync.js` — клиент REST/SSE: авторизация, бюджеты, транзакции, события.
- `src/extra.js` — фильтры аналитики, экспорт, тикер.
- `service-worker.js` — кеширование ассетов и офлайн‑режим.
- `server/index.js` — Express API: бюджеты, пользователи, транзакции, SSE, CoinGecko‑прокси.

**API**
- Авторизация: `POST /api/register`, `POST /api/login`, `GET /api/me`.
- Бюджеты: `GET/POST/PUT/DELETE /api/budgets`, приглашения: `POST /api/budgets/:id/members`, `POST /api/invitations/:token/accept`.
- Транзакции (bulk): `POST /api/transactions/bulk` (идемпотентность, дедупликация, маппинг идентификаторов).
- События (SSE): `GET /api/events?budgetId=...&token=...`.
- Крипто‑прокси: `GET /api/crypto/coins-list`, `GET /api/crypto/simple-price?...`.

**Лицензия**
MIT