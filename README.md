# RSHU AI Dashboard — технические заметки

Внутренний инструмент: набор веб-дашбордов по продажам РШУ на данных из Bitrix24.
Это шпаргалка для нас самих (архитектура, договорённости, грабли), а не презентация.

## Три слоя

```
data-service/   ← слой данных (без веб-сервера)
  index.js        npm run fetch: тянет из Б24 → cache/*.json (deals, dicts, contacts, companies, invoices, modules)
  analyze.js      RUNTIME-агрегация всех метрик из cache/ (YTD, недели, разрезы). Тяжёлая (~28k сделок).
  agg-cache.js    getAgg(): кэш результата analyze() в памяти, TTL 5 мин. При ошибке отдаёт старый кэш.
  lib/deal-rules.js  ЕДИНЫЙ источник бизнес-правил (см. ниже)
  docs/CRM_FIELDS_REFERENCE.md  расшифровка UF-полей Битрикса

clover-web/     ← оболочка (порт 3000)
  server.js       логин (сессии+bcrypt), админка, список дашбордов, МОНТАЖ дашбордов как sub-app
  data/users.json     пользователи (gitignored, plaintext-чувствительно)
  data/dashboards.json меты дашбордов (label, icon)
  public/shared.js    общие фронт-хелперы: api(), fmt(), escapeHtml(), initTableSort(), shortCompany(), BASE_PATH
  public/shared.css   общие стили + .btn-guide/.btn-excel/.rc-input
  public/vendor/      bootstrap, range-calendar (кастомный виджет периода)

dashboards/<name>/  ← каждый дашборд = отдельное Express-приложение
  server.js  импортирует getAgg()/deal-rules, отдаёт /api/*, статику, catch-all
  public/    index.html + app.js + styles.css (+ guide.pdf — инструкция)
```

Поток данных: `npm run fetch` → `cache/*.json` → `analyze()` → `agg-cache` (5 мин) → `getAgg()` в дашбордах.
Важно: правки в `analyze.js`/`deal-rules.js` на живом дашборде проявляются в течение 5 минут (кэш) или после рестарта.

## Как добавить новый дашборд

Единый источник правды — `clover-web/data/dashboards.json`. Нужно 2 шага:

1. **Положить папку** `dashboards/my-dashboard/` с `server.js` (экспорт `default` app/Router).
2. **Добавить запись** в `clover-web/data/dashboards.json`:
   `"my-dashboard": { "label": "...", "icon": "..." }`

Всё остальное автоматически: `clover-web/server.js` по ключам `dashboards.json`
монтирует sub-app (`requireDashboardAccess` + `lazyApp`) и строит список для пользователей.
Имя ключа = имя папки = префикс URL (`/my-dashboard/`). Папки без записи в
`dashboards.json` не монтируются и не показываются (никакого неконтролируемого доступа).

## Права доступа (текущее состояние)

- `requireAuth` — есть сессия, иначе → `/login`.
- `requireAdmin` — роль `admin`, иначе → `/dashboards`.
- Гость с непустым `user.dashboards[]` видит в СПИСКЕ только свои; админ — все.

✅ Доступ по прямой ссылке закрыт: каждый дашборд смонтирован через
`requireDashboardAccess(name)` (server.js) — админ видит все, гость получает только
дашборды из своего `user.dashboards[]`, иначе редирект на `/dashboards`. Пустой список = нет доступа.

Пароли сейчас — bcrypt-хэш (необратимо): показываются один раз при создании, потом админ может
только сбросить (не «посмотреть»). Пересмотр CRUD паролей — в работе.

## Договорённости и грабли (важно)

- **deal-rules.js — единственный источник** бизнес-правил (isKomDeal, isPaidDeal, MIN_OPP, YEAR,
  UF-коды полей, MQL/SQL-стадии). Раньше правила были скопированы в 6 мест и разошлись. Меняем только здесь.

- **Каналы/форматы в коде**: `fmt_oom`=Очный, `fmt_om`=Онлайн, `fmt_sdo`=Видеокурс/СДО, `kom`=Корпоратив.
  «ОМ» в коде = **Онлайн** (не «открытое обучение вообще»). Для компаний «ОМ» = всё, кроме КОМ (`!IS_KOM`).

- **Рейтинги считают таблицы НА КЛИЕНТЕ** (`buildFilteredData` из недельных `weeks[].by_prod/by_src/by_company`),
  а не из серверных YTD-полей `top_products`/`src_funnel`. ⇒ любые фильтры (исключить КОМ, ILP-конструктор
  и т.п.) надо применять и в НЕДЕЛЬНОЙ агрегации `analyze.js`, иначе на дашборде они не сработают.
  Серверные `top_products`/`src_funnel` в рейтингах фактически не отображаются (только `type` источника берётся оттуда).

- **Воронка источников — когорты как в управленческом**: Лиды/MQL/SQL по дате СОЗДАНИЯ, Счёт по дате СЧЁТА,
  Сделки/Поступления по дате ОПЛАТЫ. Если считать этапы разными когортами вперемешку — получаются конверсии >100%.

- **Сортировка таблиц** (`initTableSort` из shared.js): вешается на `thead th.sort`. Поэтому таблица должна иметь
  `<thead>`, а вызывать `initTableSort()` нужно ПОСЛЕ отрисовки ВСЕХ таблиц. Итоговые строки, которые должны
  оставаться статичными, кладём в `<thead>` (верхний ИТОГО) и `<tfoot>` (нижние Остальные/ИТОГО), не в `<tbody>`.

- **shared.js / shared.css грузят не все**: participants и plan-fact — Bootstrap + свой styles.css (без shared.css);
  ratings — только shared.css (без Bootstrap, у него кастомная вёрстка — Bootstrap-reboot её ломает);
  management — и Bootstrap, и shared.css. 5 «сырых» дашбордов (drop, kom, rshu, test, manager-report-dev) — в разработке.
  НЕ форсить shared.js/shared.css в дашборды со своими хелперами/вёрсткой — конфликтует.

- **catch-all** в каждом `server.js`: `app.get(/(.*)/)` отдаёт `index.html` только для путей БЕЗ расширения.
  Путь с расширением (`.pdf`, `.js`…) → 404, иначе браузер качает HTML-заглушку вместо реального файла.

- **guide.pdf** — инструкция, лежит в `public/` каждого дашборда (заливаем вручную). Кнопка «Инструкция» = `.btn-guide`.

- **Кастомный календарь периода**: виджет `/vendor/range-calendar/`, `RangeCalendar.attach(el, {mode:'range', onApply})`,
  видимое поле `#periodDisplay` + скрытые `#dateFrom`/`#dateTo` (их читает фильтр). Используют management и ratings.

- **Windows/git**: включён `core.fileMode=false` (не отслеживать бит исполняемости). Предупреждения LF→CRLF — норма.

## Кэши и что gitignored

- `data-service/cache/` — выгрузка из Б24 (генерируется, не в git).
- `dashboards/*/cache/`, `*/output/` — runtime-кэш дашбордов.
- `clover-web/data/sessions/`, `clover-web/data/users.json` — сессии и пользователи (не в git).
- Служебка автономных агентов (`memory/`, `sessions/`, `projects/` и т.п.) вычищена и в .gitignore.
</content>
