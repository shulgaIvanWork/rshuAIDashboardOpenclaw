## Tools

## GitHub

- **Token:** github…oLc5
- **Username:** shulgaIvanWork
- **Repo:** https://github.com/shulgaIvanWork/rshuAIDashboardOpenclaw

## VPS

- Полный доступ, VPS
- Дашборды в /root/.openclaw/workspace/projects/

## Web Interface (Клевер) — npm workspaces монолит

- **URL:** https://uprav.tech/
- **Порт:** 3000 (единственный, всё через него)
- **Логины:** ivan, olga, anastasia
- **Пароли:** {логин}123 (ivan123, olga123, anastasia123)
- **Стек:** Express.js, npm workspaces
- **Лог:** tail -f /root/.pm2/logs/clover-web-out.log
- **Ошибки:** tail -f /root/.pm2/logs/clover-web-error.log
- **Процесс:** PM2, имя `clover-web`
- **Корень:** `projects/clover-web/server.js`
- **Данные:** `projects/data-service/`

**Важно:** Весь проект — npm workspaces монолит на одном порту 3000.
- Дашборды загружаются лениво (lazyApp) при первом обращении
- Данные централизованы через `data-service/`
- `cd data-service && npm run fetch` — обновление данных
- `pm2 restart clover-web` — перезапуск после правок

## OpenClaw Web

- **URL:** https://openclaw.uprav.tech/
- **Порт:** 18789 (loopback, через nginx)
- **Токен:** bd63edb75f52b23bae4a82bdbf4b8bc9f266be3af400e8b8
- **Процесс:** systemd user (openclaw-gateway.service)

## Коллеги

- **olga** → Ольга
- **anastasia** → Анастасия

## Актуальные дашборды (все через uprav.tech)

| Путь | Папка | Назначение |
|------|-------|------------|
| `/rshu-management-dashboard` | `dashboards/rshu-management-dashboard/` | Управленческий (ООМ+КОМ, осн. работа) |
| `/drop-dashboard` | `dashboards/drop-dashboard/` | ДРОП дашборд продаж |
| `/rshu-dashboard` | `dashboards/rshu-dashboard/` | РШУ дашборд |
| `/kom-dashboard` | `dashboards/kom-dashboard/` | КОМ дашборд |
| `/ratings-dashboard` | `dashboards/ratings-dashboard/` | Рейтинги |
| `/participants-dashboard` | `dashboards/participants-dashboard/` | Участники |
| `/test-dashboard` | `dashboards/test-dashboard/` | Тестовый (прогноз мотивации) |
| `/manager-report-dev` | `dashboards/manager-report-dev/` | Отчёт для менеджеров |

## Проект

### Структура (npm workspaces)
- **data-service/** — единый слой выгрузки и аналитики B24
  - `npm run fetch` — 5 шагов: REST + Export + справочники + контакты/компании + модули
  - `analyze.js` (956 строк) — вся аналитика, включает `prev_weeks` (прошлый год для сравнения)
  - `agg-cache.js` — общий кэш для дашбордов (TTL 60с)
  - `fetch-modules.js` — даты модулей для participants-dashboard
  - `cache/` — результаты (deals.json, dicts.json, contacts.json, companies.json, fetched_at.json)
- **clover-web/** — Express.js сервер на порту 3000
  - `pm2 restart clover-web` — перезапуск
- **dashboards/** — 8 под-приложений

### Обновление данных
```bash
cd /root/.openclaw/workspace/projects/data-service && npm run fetch
```
Данные обновляются централизованно, дашборды читают через `@rshu/data-service/agg-cache.js`.

## Источники данных

### 🔵 1. Bitrix24 REST API (через data-service)
- **Webhook:** `https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/` (в `.env`)
- Лимиты: batch API до 50 команд
- Используется `lib/bitrix-rest.js`

### 🟢 2. Bitrix24 CRM Export (через data-service)
- **Эндпоинт:** `https://24.uprav.ru/web_services/crm/export.php`
- **Secret key:** `14b0fc053c141e47a5974b3859f5753f`
- **Ограничения:** limit ≤ 50, offset ≤ 5000
- Используется `lib/bitrix-export.js`
- SELECT с UF_полями зашит в коде

### 🟡 3. Яндекс Метрика API
- **Токен OAuth:** `y0__wgBELrbs5oCGKr3QiDt4u3iF6ydZv9PW4NDN8I-iaAaFC-A6UfL`
- **ClientID:** `78b1e8c8046f4b08837f3d007ac983b4`
- **Client secret:** `055582f270bc4443984e42e6020d68f0`
- **Статус:** не подключён


