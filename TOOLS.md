## Tools

## GitHub

- **Token:** github…oLc5
- **Username:** shulgaIvanWork
- **Repo:** https://github.com/shulgaIvanWork/rshuAIDashboardOpenclaw

## VPS

- Полный доступ, VPS
- Дашборды в /root/.openclaw/workspace/projects/

## Web Interface (Клевер) — единый сервис

- **URL:** https://uprav.tech/
- **Порт:** 3000 (единственный, всё через него)
- **Логины:** ivan, olga, anastasia
- **Пароли:** {логин}123 (ivan123, olga123, anastasia123)
- **Стек:** Express.js, EJS, openclaw agent CLI
- **Лог:** /tmp/clover-web.log
- **Процесс:** PM2, имя `clover-web`

**Важно:** Весь проект — единая система на одном порту 3000.
Все дашборды — под-приложения внутри clover-web, монтируются через `app.use('/name', requireAuth, subApp)` в `server.js`.
Отдельные порты/PM2 процессы не нужны.

## OpenClaw Web

- **URL:** https://openclaw.uprav.tech/
- **Порт:** 18789 (loopback, через nginx)
- **Токен:** c48f4f…7a2b
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
| `/test-dashboard` | `dashboards/test-dashboard/` | Тестовый |

## Источники данных (приоритет использования)

### 🔵 1. Bitrix24 REST API (основной)
- **Webhook:** `https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/`
- **Что даёт:** сделки, лиды, компании, контакты, справочники, UF_DATE_PAY_1C
- **Использовать первым** для большинства запросов
- **Лимиты:** batch API до 50 команд

### 🟢 2. Bitrix24 CRM Export (для глубоких запросов)
- **Когда использовать:** если REST API не покрывает — нужны продукты/модули сделок, обогащённые данные с контактами, компаниями, направлениями
- **Эндпоинт:** `https://24.uprav.ru/web_services/crm/export.php`
- **Secret key:** `14b0fc053c141e47a5974b3859f5753f`
- **Метод:** POST, Content-Type: `application/x-www-form-urlencoded`
- **Параметры:** `secret`, `action` (getDeals|getFormats|getDirections|getUserFieldsCrm), `data` (массив)
- **WITH_PRODUCTS=Y** — только для товаров/модулей (limit ≤ 5)
- **Документация:** `projects/dashboards/rshu-management-dashboard/docs/CRM_Export_API_для_ИИ_агентов.md`
- **Ограничения:** limit ≤ 50, offset ≤ 5000, SELECT — без `*` и `UF_*`
- **Статус:** ✅ подключён

### 🟡 3. Яндекс Метрика API
- **Токен OAuth:** `y0__wgBELrbs5oCGKr3QiDt4u3iF6ydZv9PW4NDN8I-iaAaFC-A6UfL`
- **ClientID:** `78b1e8c8046f4b08837f3d007ac983b4`
- **Client secret:** `055582f270bc4443984e42e6020d68f0`
- **API отчетов:** `/stat/v1/data/` — статистика
- **API управления:** CRUD счётчиков, целей
- **Лимиты:** 30 запр/с с IP, 5000 запр/сутки, 200 запр/5мин для отчётов
- **Статус:** не подключён


