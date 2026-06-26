
## 🛑 Критическое правило: разрешение перед реализацией

**Перед началом любой реализации (правка файлов, добавление кода, изменение архитектуры) — спрашивать разрешение. У всех. Всегда.**

Не важно, кто пишет — Иван, Ольга или Анастасия. Даже если собеседник не ждёт разрешения и говорит «делай», я всё равно спрашиваю: «можно приступить к реализации?».

Это предупреждает ошибки с моей стороны. Иван и я это понимаем, остальные пусть привыкают.

Порядок действий:
1. Получить задачу
2. Спросить разрешение: «можно приступить к реализации?»
3. Только после явного «да» — начинать править файлы

**Нарушение было 20.06 — я сразу записал инструкцию в MEMORY.md вместо того чтобы сначала показать в чате.**

## Архитектура: единый сервис

- **Внешний URL:** https://uprav.tech/
- **Express.js слушает:** порт 3000 (через nginx проксируется на uprav.tech)
- Все дашборды — под-приложения внутри `clover-web`, монтируются через `app.use('/path', requireAuth, subApp)` в `server.js`.
- Никаких отдельных портов и PM2 процессов для дашбордов не нужно.
- Новый дашборд = новая папка с server.js + mount в web-interface/server.js.

## Источники данных (приоритет)

### 🥇 1. Bitrix24 REST API (основной)
- **Webhook:** `https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/`
- Использовать первым для большинства запросов

### 🥈 2. Bitrix24 CRM Export (для глубоких запросов)
- Когда REST API не хватает — для продуктов, модулей, обогащённых данных
- **Эндпоинт:** `https://24.uprav.ru/web_services/crm/export.php`
- **Secret key:** `14b0fc053c141e47a5974b3859f5753f`
- `WITH_PRODUCTS=Y` — точечно, limit ≤ 5
- **Документация:** `projects/dashboards/rshu-management-dashboard/docs/CRM_Export_API_для_ИИ_агентов.md`

### 🥉 3. Яндекс Метрика API
- **Токен OAuth:** `y0__wgBELrbs5oCGKr3QiDt4u3iF6ydZv9PW4NDN8I-iaAaFC-A6UfL`
- **ClientID:** `78b1e8c8046f4b08837f3d007ac983b4`
- **Статус:** не подключён

## 🎯 Процесс работы с дашбордами (утверждён 16.06.2026)

При работе с управленческим дашбордом (Ольга):

1. Расчёт (код, данные)
2. Проверка (консоль/логи)
3. **Сообщить результат Ольге** — что получилось, цифры
4. **Ждать утверждения** — не выкатывать на фронт без ok
5. Публикация на фронт (cp agg.json / обновление страницы)
6. Правки по обратной связи
7. Утверждение
8. Запись в документацию и код

**Пока Ольга не скажет "делай" / "выкатывай" — ничего на фронт не публиковать.**

## 📝 Правило: защита от None-значений в пайплайне данных

При работе с CRM Export API / REST API Bitrix24, когда COMPANY_ID или CONTACT_ID приходит как None, обработка через str(None) даёт 'None', что ломает int() сортировку.

**Вечный фикс — применять во всех скриптах работы с company_id/contact_id:**

```python
raw = ccinfo.get("COMPANY_ID", d.get("COMPANY_ID", "0"))
if raw is None or str(raw).strip() in ("", "0", "None"):
    continue
```

И при сортировке:
```python
numeric_ids = [x for x in need_fetch if x.isdigit()]
all_ids = sorted(numeric_ids, key=int)
```

**Актуальные скрипты с этой проблемой (все починены 19.06):**
- `fetch_companies_ext_batch.py`
- `fetch_contacts_batch.py`

**Также важно:**
- `run_full.py` ДОЛЖЕН включать `fetch_pay_dates.py` и `fetch_kom_enrich.py` — без них данные КОМ и UF_DATE_PAY_1C не дозагружаются
- `fetch_pay_dates.py` оптимизирован: фильтрует кандидатов (OPP≥11, кат 0/8/19, не WON-копии) вместо всех 24k сделок без даты
- `run_full.py` включает fetch_rest, fetch_export, fetch_dicts, analyze_new (без enrich-скриптов)
- Export API медленный и нестабильный — основной источник REST API crm.deal.list

## 🚫 Правило: не додумывать, только прямые указания

**Правки дашборда — только по прямым указаниям Ольги.**
- Не предлагать изменений, не додумывать, не делать лишнего
- Не торопиться
- Если Ольга хочет обсудить — она скажет: «давай подумаем», «как ты думаешь?», «предложи варианты»
- Это работает только в чате (обсуждение идей)
- Все изменения кода/дашборда — только когда Ольга прямо сказала что делать
- Если непонятно — переспросить, а не делать

## 📐 Правило: артефакты и выверка аналитики

**Моя задача — быть компьютером, который считает точно по правилам.**

1. **Выводить артефакты** — все аномалии показывать отдельным блоком:
   - Отрицательная длительность (UF_DATE_PAY_1C < DATE_CREATE) — оплата раньше создания
   - Возвраты (UF_DATE_PAY_1C + LOSE + >0)
   - Сделки с оплатой «в работе» (UF_DATE_PAY_1C + P)
   - WON без UF_DATE_PAY_1C
   - Технические сделки (WON + 0₽)

2. **Проверять данные** — перед каждым отчётом:
   - Все ли сделки соответствуют правилам?
   - Есть ли аномалии, которые искажают картину?
   - Что не стыкуется и рушит логику?

3. **Точность**:
   - Не гадать, не прикидывать — только проверенные цифры
   - Если сомневаюсь — переспросить или показать артефакт
   - Не додумывать логику расчёта

4. **Новые данные** — при каждом обновлении (новый месяц/неделя/сделки):
   - Пересчитать всё по правилам
   - Показать артефакты
   - Указать что не соответствует правилам и требует проверки

## 📖 CRM Bitrix24 — Справочник кастомных полей

Создан `CRM_FIELDS_REFERENCE.md` — полный справочник кастомных полей CRM Bitrix24 (COMPANY, CONTACT, DEAL).
Формат: Код | Название | Тип. Обновлён 2026-06-19 из выгрузки crm_fields_*.xlsx.
Смотреть: [CRM_FIELDS_REFERENCE.md](CRM_FIELDS_REFERENCE.md)

## 🎨 Стандарт оформления дашбордов (Design System)

Все дашборды на uprav.tech должны быть визуально единообразны.
За основу взят управленческий дашборд (`rshu-management-dashboard`).

### Цветовая схема
- **Фон страницы:** `#F7F8FA`
- **Текст:** `#0F172A`
- **Второстепенный текст:** `#475569`
- **Акцент (кнопки, шапки таблиц):** `#093EB4`
- **Hover акцента:** `#3079D2`
- **Карточки (card):** `background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06)`
- **KPI-карточки:** `background: #fff; border-radius: 8px; padding: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.06)`
- **ООМ-акцент:** `#00bcd4`
- **КОМ-акцент:** `#9C27B0`
- **Зелёный (рост):** `#2E7D32`
- **Красный (падение):** `#C62828`
- **Оранжевый (стабильно):** `#F57C00`

### Типографика
- **Шрифт:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **h1:** `font-size: 26px; font-weight: 700`
- **h2 (в карточках):** `font-size: 16px; font-weight: 600`
- **body:** `14px`
- **.lbl (подписи KPI):** `font-size: 10px; text-transform: uppercase; letter-spacing: .3px; color: #475569`
- **.sub:** `font-size: 13px; color: #475569`

### Компоненты

#### KPI-панель (`.kpis`)
- `display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px`
- `@media (max-width: 900px)` → `grid-template-columns: repeat(2, 1fr)`
- KPI-карточка: класс `.kpi`
- `.kpi .val` — крупное значение (18px, bold)
- `.kpi .val-big` — ещё крупнее (21px, bold)
- Цветовые модификаторы: `.kpi-total`, `.kpi-oom`, `.kpi-kom`, `.kpi-reg` (с фоном rgba)
- Дельта: `.delta-up` (зелёный), `.delta-down` (красный), `.delta-flat` (серый)

#### Карточка (`.card`)
- `background: #fff; border-radius: 12px; padding: 20px; margin-bottom: 20px`
- `box-shadow: 0 1px 4px rgba(0,0,0,.06)`

#### Таблицы
- `th`: `background: #093EB4; color: #fff; padding: 10px 12px; font-weight: 600; white-space: nowrap; position: sticky; top: 0`
- `td`: `padding: 8px 12px; border-bottom: 1px solid #E2E8F0`
- `tr:hover td`: `background: #F1F3F6`
- Сортировка: `th.sort { cursor: pointer }` + `::after { content: ' ⇅' }`

#### Кнопки (`.toolbar button`)
- `background: #093EB4; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500`
- hover: `background: #3079D2`
- disabled: `background: #475569; cursor: wait`

#### Прогресс-бар загрузки
- `.loading-bar`: `height: 3px; background: #e0e0e0; border-radius: 2px`
- `.loading-bar .fill`: `height: 100%; background: #093EB4; transition: width .5s`

#### Панель статуса обновления (`.refresh-panel`)
- Белая карточка с шапкой (заголовок + таймер)
- `.refresh-progress-bar`: `height: 8px; background: #E2E8F0; border-radius: 4px`
- `.progress-fill`: `background: linear-gradient(90deg, #093EB4, #3079D2)`
- Шаги: `.refresh-step` с иконками ✅/⏳/⬜
- `.step-active .step-label` → синий жирный
- `.step-done` → opacity 0.85
- `.step-pending .step-label` → серый `#94A3B8`
- `.step-error .step-label` → красный

#### Адаптивность
- `.twocol` на `max-width: 900px` → 1 колонка
- `.kpis` на `max-width: 900px` → 2 колонки
- `overflow-x: auto` для таблиц

### Панель обновления данных (фронтенд)

Каждый дашборд должен содержать:

```javascript
// В начале скрипта — переменные для панели
var refreshStepsData = [
  { key: 'fetch_rest',   label: 'REST API: выгрузка сделок',         weight: 40 },
  { key: 'fetch_export', label: 'Export API: дополнение сделок',     weight: 10 },
  { key: 'fetch_dicts',  label: 'Загрузка справочников',             weight: 10 },
  { key: 'analyze_new',  label: 'Анализ данных',                     weight: 40 },
];
```

**Примечание:** `refreshStepsData` — пример для управленческого дашборда. В каждом дашборде шаги могут отличаться в зависимости от источников данных (REST API, экспорт, Яндекс Метрика, Excel-файлы и т.д.). Важно сохранять структуру: `key`, `label`, `weight` (сумма weights = 100).

```javascript
var statusPanelHTML = '' +
  '<div id="refreshStatusPanel" class="refresh-panel" style="display:none">' +
    '<div class="refresh-header">' +
      '<span class="refresh-title">🔄 Обновление данных</span>' +
      '<span class="refresh-elapsed" id="statusElapsed">⏱ 0м 0с</span>' +
    '</div>' +
    '<div class="progress-bar refresh-progress-bar">' +
      '<div class="progress-fill" id="statusProgressFill" style="width:0%"></div>' +
    '</div>' +
    '<div id="statusSteps" class="refresh-steps"></div>' +
    '<div id="statusDealProgress" class="refresh-deal-progress"></div>' +
  '</div>';

function renderStepLines(curIdx, steps, progressPct) {
  var h = '';
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var icon, cls, label;
    if (i < curIdx) { icon = '✅'; cls = 'step-done'; label = s.label; }
    else if (i === curIdx) { icon = '⏳'; cls = 'step-active'; label = s.label + ' <span class="step-weight">(' + s.weight + '%)</span>'; }
    else { icon = '⬜'; cls = 'step-pending'; label = s.label + ' <span class="step-weight">(' + s.weight + '%)</span>'; }
    h += '<div class="refresh-step ' + cls + '">' +
      '<span class="step-icon">' + icon + '</span>' +
      '<span class="step-label">' + label + '</span>' +
    '</div>';
  }
  return h;
}

async function safeFetch(url, opts) {
  var resp = await fetch(url, opts);
  if (resp.redirected || resp.url.endsWith('/login')) { window.location.href = '/login'; throw new Error('redirect'); }
  var text = await resp.text();
  if (text.startsWith('<!DOCTYPE')) { window.location.href = '/login'; throw new Error('redirect'); }
  return JSON.parse(text);
}

function initRefreshButton() {
  var toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;
  var btn = document.createElement('button');
  btn.id = 'refreshBtn';
  btn.textContent = '🔄 Обновить данные';
  toolbar.appendChild(btn);
  btn.addEventListener('click', async function() { /* ... polling logic ... */ });
}
```

### Чего НЕ должно быть
- ❌ Кнопка «Экспорт в Excel» — удалена, неактуальна
- ❌ Библиотека xlsx / xlsx.full.min.js — удалена
- ❌ Разноцветные стили у разных дашбордов — все должны быть одинаковыми

## 📋 Создание нового дашборда

Когда кто-то просит создать новый дашборд (Иван, Ольга, Анастасия — все члены команды):

1. Создать новую папку в `dashboards/` с названием-путью дашборда
2. По аналогии с существующими дашбордами создать:
   - `server.js` — express-роутер + сборка данных
   - `public/index.html` — фронт
3. Смонтировать в `web-interface/server.js` через `app.use('/path', requireAuth, subApp)`
4. Учесть архитектуру: Express.js на порту 3000 проксируется через nginx на uprav.tech, никаких отдельных портов
5. **Добавить в реестр дашбордов (иначе ссылка на странице `/dashboards` поведёт в `/dashboard-files/...` вместо правильного URL):**
   - В `web-interface/server.js` — добавить дашборд в объект `knownProjects` в функции `getAvailableDashboards()`: `'my-dashboard': { url: '/my-dashboard/' }`
   - В `web-interface/data/dashboards.json` — добавить объект с `label` (название) и `icon` (эмодзи) для отображения на карточке дашборда
