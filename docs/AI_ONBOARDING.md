# AI Onboarding — RSHU Dashboards (санитизированная копия)

Санитизированная копия проекта: код без секретов (вместо реальных значений — `REPLACE_WITH_*`),
без данных Битрикса (`data-service/cache/`), без `.env`, `users.json`, сессий, `node_modules`.
Для запуска нужен собственный `.env` (см. `.env.example`).

## Слои

```
data-service/   слой данных: выгрузка из B24 → cache/*.json → агрегация
clover-web/     оболочка: логин, монтирование дашбордов (порт 3000)
dashboards/<name>/  каждый дашборд = отдельное Express sub-app
```

Поток: `npm run fetch` → `cache/*.json` → `analyze()` → `agg-cache` (TTL 5 мин) → `getAgg()`.

## Карта «показатель → файл → функция → поля B24»

### Единые бизнес-правила — `data-service/lib/deal-rules.js`
| Правило | Функция/константа | Поля B24 |
|---|---|---|
| КОМ-сделка | `isKomDeal()` | CATEGORY_ID=19 (CAT_KOM), UF_CRM_1683882427069 (КОМ да/нет), направление 1906 |
| Оплата | `isPaid()` (в analyze) / MIN_OPP=11 | UF_DATE_PAY_1C + OPPORTUNITY > 11 |
| MQL/SQL стадии | `MQL_SALE_STAGES`, `NOT_MQL_SALE`, `isMql*` | STAGE_ID, STAGE_SEMANTIC_ID |
| Формат | `detectFormat(title, UF_FORMAT)` | TITLE, UF_FORMAT (Очный/Онлайн/Видеокурс/СДО) |
| B2B/B2C | `detectB2b()` | COMPANY_ID / UF_CRM_1477555902 (участник) |
| Источник | `isInternalSource()` | SOURCE_ID (внутренняя база vs маркетинг), REG_SRC_ID |
| Тип обучения | `EDU_TYPE_MAP` | UF_CRM_1765896709800 (ПК/ПП/КО) |
| Воронки | CAT_SALE=0, CAT_PRESALE=8, CAT_POSTSALE=9, CAT_KOM=19 | CATEGORY_ID |
| Словарь UF-полей | `UF` (объект) | все коды полей сделки |
| Полный справочник полей | `data-service/docs/CRM_FIELDS_REFERENCE.md` | COMPANY/CONTACT/DEAL UF-поля |

### Агрегация метрик — `data-service/analyze.js`
- `parseDt/dateOnly` — парсинг дат; `isoCalendar` — ISO-недели
- `metrics(subset)` — KPI блока (поступления, WON, чек, цикл, конверсия)
- `isQualLead/isAllLead/isMql1/isMql2/isSql1/isSql2` — лиды/MQL/SQL по неделям создания
- `getEffectiveStage/stack2Seg` — воронка лидов по стадиям
- `calcRegFunnel` — воронка источников «Регистрация» когортами
- `detectMbaType/hasMbaInTitle` — тип MBA по TITLE
- Возвращает: `ytd/prev/cur`, `weeks[]`, `prev_weeks[]`, `reg_ytd/reg_all`, разрезы по форматам/ООМ/КОМ/B2B-B2C/источникам

### KPI за произвольный период — `data-service/lib/period-kpi.js`
- `enrichForKpi(dealsRaw)` — обогащение сделок (OPP, SEM, CAT, PAY_DT, IS_KOM/IS_OOM, FORMAT, EDU_TYPE, BTYPE, IS_INTERNAL_SRC, MGR_ID)
- `calcPeriodKpi()` — поступления/чек/цикл по дате оплаты, лиды/MQL по дате создания
- Используется управленческим и ДРОП дашбордами (`/api/kpi?from&to`)

### KPI менеджеров — `data-service/lib/managers-kpi.js`
- `calcManagers()` — таблицы по менеджерам: стадии/ранги, переходы, отказы, оплаты за год
- Группы: `data-service/lib/mgr-groups.js` (`getMgrGroup`, MGR_GROUPS: main/autopay/ozk/bond/afanasyev/tech/other)
- Общий для drop-dashboard (`/api/managers-sales`, `/api/managers-report`) и manager-report-dev

### План-факт — `dashboards/plan-fact-dashboard/server.js`
- `/api/data` — план/факт выручки по годам/неделям (автоматизация ручной Google-таблицы)
- Источники: `data-service/cache/deals.json` + `participants-dashboard/cache/modules.json`

### Выгрузка из B24 — `data-service/lib/`
- `bitrix-rest.js` — crm.deal.list через batch API (вебхук из `.env` → BITRIX_BASE)
- `bitrix-export.js` — CRM Export API (secret → REPLACE_WITH_EXPORT_SECRET), старые сделки
- `bitrix-dicts.js` — справочники (воронки, стадии, пользователи, форматы, направления)
- `bitrix-contacts.js` — контакты/компании по ID из сделок
- `fetch-invoices.js` — счета (invoices.json)
- `fetch-modules.js` — даты модулей программ (participants-dashboard)
- Оркестрация: `data-service/index.js` (`npm run fetch`, 5+ шагов, атомарная запись)

### Дашборды: точки входа и API

| Дашборд | server.js | API |
|---|---|---|
| Управленческий | `dashboards/rshu-management-dashboard/server.js` | `/api/data`, `/api/kpi`, `/api/reg-funnel`, `/api/artifacts` |
| ДРОП | `dashboards/drop-dashboard/server.js` | `/api/data`, `/api/kpi`, `/api/managers-sales`, `/api/managers-report`, `/api/manager-weeks`, `/api/day-series`, `/api/reg-funnel`, `/api/artifacts` |
| План-факт | `dashboards/plan-fact-dashboard/server.js` | `/api/data` |
| Прочие | kom, rshu, ratings, participants, manager-report-dev, nps, test | свои /api/* |

Фронтенд: `public/index.html` + `app-boot.js`/`app-core.js`/`app-data.js`/`app-render.js` (или `app.js`),
общие хелперы `clover-web/public/shared.js` (api, fmt, escapeHtml, initTableSort, BASE_PATH), стили `shared.css`.

### Пример JSON `/api/kpi` (управленческий, август 2026)
```json
{
  "period": {"from": "2026-08-01", "to": "2026-08-31"},
  "prev_period": {"from": "2026-07-01", "to": "2026-07-31"},
  "current": {
    "total": {"postupleniya": 11543940, "won_relevant_cnt": 111, "avg_check": 103999, "avg_close_days_won": 49.2, "leads": 841, "mql": 546, "created_in_period": 919, "paid_same_period": 45, "paid_created_same_pct": 40.5},
    "oom": {...}, "kom": {...},
    "splits": {
      "fmt": {"Видеокурс": {"cnt": 36, "sum": 1762800}, "Очный": {...}, "Онлайн": {...}, "Корпоративное обучение": {...}},
      "edu": {"Повышение квалификации": {...}, "Проф. переподготовка": {...}, "Корпоративное обучение": {...}},
      "btype": {"B2B": {"cnt": 87, "sum": 10261789.83}, "B2C": {...}},
      "src": {"internal": {...}, "marketing": {...}}
    }
  },
  "previous": { ... }
}
```

## Обновление данных (на проде)
- Crontab: `30 6 * * * npm --prefix /root/.openclaw/workspace/projects/rshu-dashboards/data-service run fetch` (ежедневно 06:30 UTC)
- Ручной запуск: `cd data-service && npm run fetch` (~20–40 мин)
- Кэш агрегатов in-memory TTL 5 мин (`agg-cache.js`), при ошибке отдаёт старый кэш
- Дашборды читают `cache/deals.json` напрямую там, где нужны свежие/сырые данные

## Отличия Управленческий vs ДРОП
- Общее: те же `/api/data`, `/api/kpi`, `/api/reg-funnel`, `/api/artifacts`, period-kpi.js, deal-rules.js, agg-cache.js
- ДРОП дополнительно: менеджерские таблицы (`managers-sales`, `managers-report`, `manager-weeks` — managers-kpi.js + mgr-groups.js) и дневной ряд поступлений (`day-series`)
- Фронтенд ДРОП разбит на app-boot/app-core/app-data/app-render (модульнее, чем единый app.js управленческого)

## Запуск локально
```bash
npm install            # корень workspaces
cp .env.example .env   # вписать BITRIX_BASE (свой вебхук B24), SESSION_SECRET
cd data-service && npm run fetch   # выгрузка данных (нужен доступ к B24)
cd clover-web && npm start         # порт 3000, логин: пользователь из users.json
```
Без выгрузки дашборды покажут 503 (нет cache/*.json). Тесты бизнес-правил: `cd data-service && npm test`.
