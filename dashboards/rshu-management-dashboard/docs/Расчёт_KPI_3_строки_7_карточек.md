# Расчёт KPI — 3 строки × 7 карточек

**Дата:** 19.06.2026
**Источник:** REST API crm.deal.list (основной) + CRM Export API + OLD архив
**Скрипт:** `scripts/analyze_new.py`
**Фронт:** `public/index.html`

---

## 1. Три строки KPI

| Строка | Slug | Цвет | Описание |
|--------|------|------|----------|
| **ИТОГ** | `ytd` | `#1f2a44` | Все сделки CAT_ID IN (0, 8, 19), OPPORTUNITY >= 11.0 ₽ |
| **ООМ** (Открытое обучение) | `oom_ytd` | `#00bcd4` | ИТОГ минус КОМ (непересекающиеся множества) |
| **КОМ** (Корпоративное обучение) | `kom_ytd` | `#9C27B0` | Сделки, где выполняется любой из 5 признаков КОМ |

### 1.1. Деление ООМ/КОМ (функция `is_kom_deal()`)

Сделка считается **КОМ**, если выполняется **любое** из условий:

| № | Поле | Условие | Пояснение |
|:---:|------|---------|-----------|
| 1 | `UF_CRM_1683882427069` | == `Y` / `1` / `true` | Галочка «КОМ» |
| 2 | `UF_FORMAT` | == `19042498` | Формат обучения = «КОМ» |
| 3 | `UF_CRM_1498466811` | contains `1906` | Направление = «Корпоративное обучение» |
| 4 | `CATEGORY_ID` | == `19` | Категория = «КОМ (Sale)» |
| 5 | `UF_CRM_1765896709800` | == `34765` | Тип обучения = «КОМ» |

**ООМ** = все остальные сделки из валидных категорий (0, 8, 19), которые не подходят ни под один из 5 признаков.

**Важно:** REST API возвращает все UF_* поля корректно. Export API не возвращает — используется только как дополнение по ID.

### 1.2. Валидные категории

```python
VALID_CATS = {0, 8, 19}
```

| ID | Название | Участвует |
|:---:|----------|:---------:|
| 0 | Sale (Общая по умолчанию) | ✅ |
| 8 | Pre Sale | ✅ |
| 19 | КОМ (Sale) | ✅ |
| 9 | Post Sale | ❌ |
| 10 | Аккаунтинг | ❌ |
| 12 | Отказы | ❌ |
| 13 | Repeat Sale | ❌ |
| 20 | Реанимация | ❌ |

### 1.3. Минимальная сумма

```python
MIN_OPP = 11.0  # сделки 0-10 ₽ не учитываются нигде
```

---

## 2. Семь карточек в каждой строке

### Карточка 1 — Поступления YTD (доход)

**Что показывает:** сумму и количество оплаченных сделок с начала года.

**Правило (функция `is_paid()`):**
```
Сделка считается оплаченной, если:
- UF_DATE_PAY_1C IS NOT NULL      # дата оплаты из 1С
- OPPORTUNITY >= MIN_OPP (11.0)    # минимальная сумма
- CATEGORY_ID IN (0, 8, 19)        # валидная категория
```

**SEM не проверяется** — учитываются сделки на любой стадии (P, S, F), у которых есть дата оплаты.

**Дата оплаты:** `UF_DATE_PAY_1C` из 1С (не CLOSEDATE, не DATE_CREATE).

**Поступления за неделю (карточка 6):** строго по `UF_DATE_PAY_1C.isocalendar()` — неделя определяется по дате оплаты.

**Источник поля:** REST API возвращает UF_DATE_PAY_1C напрямую. Дополнительная дозагрузка не требуется.

**Формула:**
```python
# metrics() → для paid-списка
postupleniya = sum(r["OPP"] for r in paid)
won_relevant_cnt = len(paid)
```

**Для каждой строки:**
- ИТОГ: `pred = lambda r: r["CAT_ID"] in VALID_CATS`
- ООМ:  `pred = lambda r: r["IS_OOM"] and r["CAT_ID"] in VALID_CATS`
- КОМ:  `pred = lambda r: r["IS_KOM"]`

---

### Карточка 2 — Лиды YTD + MQL

**Что показывает:**
- Все лиды (штук) — количество созданных сделок
- Квалифицированные лиды (MQL) — штук
- Конверсия лидов в MQL = MQL / Все лиды × 100%

#### 2.1. Все лиды (функция `is_all_lead()`)

```python
def is_all_lead(r):
    if r["CAT_ID"] not in VALID_CATS:          # только 0|8|19
        return False
    if r["SEM"] == "S" and r["OPP"] < MIN_OPP: # тех.нулевые WON
        return False
    if r["CAT_ID"] in (8, 19) and r["SEM"] == "S":  # WON-копии при переходе в Sale
        return False
    return True
```

**Исключения из лидов:**
1. **Технические нулевые сделки:** стадия WON, сумма < 11 ₽ — не лиды
2. **WON-копии в PreSale(8) и КОМ(19):** при переходе сделки в Sale в исходной категории остаётся копия со статусом WON — не лиды
3. **Невалидные категории:** всё кроме 0, 8, 19

**Дата:** по DATE_CREATE (год создания = отчётному году).

**Разбивка ООМ/КОМ:**
- ООМ: `is_all_lead(r) AND r["IS_OOM"]`
- КОМ: `is_all_lead(r) AND r["IS_KOM"]`
- ИТОГ = ООМ + КОМ ✅

#### 2.2. MQL / Квал. лиды (функция `is_qual_lead()`)

```python
def is_qual_lead(r):
    if r["CAT_ID"] not in VALID_CATS:
        return False
    if r["SEM"] == "S" and r["OPP"] < MIN_OPP:  # тех.нулевые WON
        return False

    # Sale (категория 0)
    if r["CAT_ID"] == 0:
        if r.get("STAGE") in NOT_MQL_SALE:      # исключаются NEW/Аларм/Взят/Консульт
            return False
        if r.get("STAGE") in MQL_SALE_STAGES:   # MQL+ (ВКЛ. WON)
            return True
        return False

    # КОМ (категория 19)
    if r["CAT_ID"] == 19:
        if r["SEM"] == "S": return False         # WON-копии
        if r["SEM"] == "F": return False         # отказы (LOSE)
        return True                              # всё остальное = MQL

    return False  # PreSale (8) — не входит в MQL
```

**PreSale (8) не входит в MQL** — сделки в PreSale считаются лидами, но не MQL.

**Стадии MQL+ в Sale (СЧИТАЮТСЯ MQL):**
Код стадии | Название
:---:|---
`UC_4RJOR4` | Маркетинговый лид (MQL)
`DETAILS` | Лид для продажи (SQL)
`PROPOSAL` | Счёт отправлен
`2` | Постоплата
`6` | Частично оплачен
`WON` | Счёт оплачен (**считаем!**)
`LOSE` | Закрыто и не реализовано
`UC_F2YC3N` | Предзакрытие в отказ
`UC_VKPN0N` | Приоритет
`UC_W6SCHG` | Следующий год
`UC_670ME2` | Возвращен в работу

**Стадии ДО MQL (исключаются):**
Код стадии | Название
:---:|---
`NEW` | Исходный лид
`UC_1YW3V2` | Аларм/Распределение
`UC_STZB49` | Взят в работу
`UC_838R2R` | Консультирование

**WON в Sale считается MQL** (Ольга, 09.06.2026).

**Разбивка ООМ/КОМ:**
- ООМ: `is_qual_lead(r) AND r["IS_OOM"]`
- КОМ: `is_qual_lead(r) AND r["IS_KOM"]`
- ИТОГ = ООМ + КОМ ✅

---

### Карточка 3 — Конверсия YTD

**Что показывает:** два показателя в одной карточке.

**Формулы:**
```python
# metrics() возвращает conv_deal_pct
conv_deal_pct = won_cnt / (won_cnt + lose_cnt) * 100
```
где:
- `won_cnt` = количество оплаченных сделок (по UF_DATE_PAY_1C)
- `lose_cnt` = количество проигранных (SEM=F, CLOSED=Y)

**Дополнительно на фронте:**
```javascript
// Конверсия к лидам
leadsYtd > 0 ? ytd.won_relevant_cnt / leadsYtd * 100 : 0

// Конверсия к MQL
qualLeads > 0 ? ytd.won_relevant_cnt / qualLeads * 100 : 0
```

---

### Карточка 4 — Средний чек YTD

**Что показывает:** средний чек, медиана, минимальный и максимальный чек.

**Формулы (в metrics()):**
```python
avg_check = pos_sum / pos_cnt if pos_cnt else 0      # среднее арифметическое
chs = sorted(r["OPP"] for r in paid)                   # все суммы по возрастанию
med = chs[len(chs) // 2] if chs else 0                 # медиана (центральный элемент)
mx = max((r["OPP"] for r in paid), default=0)          # максимум
min_check = min(chs) if chs else 0                     # минимум
```

**Медиана:** берётся значение посередине отсортированного списка чеков. При чётном количестве — левый элемент (половинный индекс).

**Средний чек на фронте** пересчитывается:
```javascript
avg_check = Math.round(postupleniya / won_relevant_cnt)
```
т.к. postupleniya и won_relevant_cnt могут пересчитываться по отфильтрованным неделям.

**Медиана на фронте** — пересчитывается из понедельных полей при фильтрации по дате.

---

### Карточка 5 — Срок WON (цикл сделки)

**Что показывает:** среднее количество дней от создания сделки до оплаты.

**Формула (в metrics()):**
```python
dur_pairs = [((r["PAY_DT"] - r["DC"]).days, r["OPP"]) 
             for r in paid
             if r["DC"] and r["PAY_DT"] 
             and (r["PAY_DT"] - r["DC"]).days >= 0]

avg_dur = sum(durs) / len(durs) if durs else 0                  # простая средняя
avg_dur_weighted = sum(d * o for d, o in dur_pairs) / sum(opps) # взвешенная по сумме
med_dur = sorted(durs)[len(durs) // 2] if durs else 0           # медиана
```

**Условия:**
- Только оплаченные сделки (UF_DATE_PAY_1C есть)
- Только дни >= 0 (если оплата раньше создания — исключается из расчёта)
- От DATE_CREATE до UF_DATE_PAY_1C

---

### Карточка 6 — Неделя: поступления

**Что показывает:** сумма оплат за неделю + дельта к прошлой неделе.

**Расчёт:** строго по `UF_DATE_PAY_1C.isocalendar()` — неделя определяется по ISO-дате оплаты.

**Формула:**
```python
ws_cur_pay = [r for r in rows 
              if get_pay_date(r) 
              and get_pay_date(r).isocalendar()[:2] == (YEAR, cur_w)]
m_cur = metrics(ws_cur_pay)        # ИТОГ
m_oom_cur = metrics(ws_cur_pay, is_oom_block=True)  # ООМ
m_kom_cur = metrics(ws_cur_pay, is_kom_block=True)  # КОМ
```

**Дельта на фронте:**
```javascript
delta = (cur.postupleniya - prev.postupleniya) / prev.postupleniya * 100
```

---

### Карточка 7 — Неделя: лиды

**Что показывает:** все лиды за неделю + дельта + MQL за неделю + дельта.

**Все лиды:** по DATE_CREATE, функция `is_all_lead()` (см. карточку 2).

**MQL:** по DATE_CREATE, функция `is_qual_lead_w()` (аналог `is_qual_lead()` для недельной воронки).

**Расчёт:**
```python
# В цикле по неделям:
if r["DC"] and r["DC"].year == YEAR and is_all_lead(r):
    weekly[wk]["leads"] += 1

if r["DC"] and r["DC"].year == YEAR and is_qual_lead_w(r):
    weekly[wk]["mql"] += 1

# ООМ/КОМ разбивка добавляется:
if r["IS_OOM"]:
    weekly[wk]["oom_leads"] += 1
    weekly[wk]["oom_mql"] += 1
# КОМ = weekly[wk]["leads"] - weekly[wk]["oom_leads"]
```

**На фронте:**
- ИТОГ: `wkCur.leads` / `wkCur.mql`
- ООМ: `wkCur.oom_leads` / `wkCur.oom_mql`
- КОМ: `wkCur.leads - wkCur.oom_leads` / `wkCur.mql - wkCur.oom_mql`

---

## 3. Артефакты

Выводятся отдельным блоком внизу дашборда. Аномалии:

| Артефакт | Условие |
|----------|---------|
| 🔄 Возвраты | UF_DATE_PAY_1C есть + SEM=F + OPP > 0 |
| ⚠️ В работе с оплатой | UF_DATE_PAY_1C есть + SEM=P (не закрыта, но деньги прошли) |
| ❓ WON без даты | SEM=S, UF_DATE_PAY_1C нет |
| ⛔ Технические нулевые | SEM=S + OPP < 11 |
| 🔴 Оплата раньше создания | UF_DATE_PAY_1C < DATE_CREATE |
| 📂 Другие категории | UF_DATE_PAY_1C в категориях кроме 0, 8, 19 |
| 🔍 КОМ в PreSale | IS_KOM + IS_PRESALE (не WON) |
| ⏳ Старые сделки Sale в работе | CAT=0, SEM=P, OPP>0, год <= 2024 |

---

## 4. Обновление данных (новая схема)

```bash
cd /root/.openclaw/workspace/projects/dashboards/rshu-management-dashboard

# Полный пайплайн (одной командой):
python3 scripts/run_full.py
```

**Пайплайн:**
1. `fetch_rest.py` — REST API crm.deal.list (основной источник)
   - Все поля: STAGE_SEMANTIC_ID, UF_*, UF_DATE_PAY_1C — корректные
   - Фильтр: >=DATE_CREATE 2025-01-01, CAT IN (0,8,19)
   - Пагинация: next-токен (без лимита offset)
   - → cache/deals_rest.json
2. `fetch_export.py` — CRM Export API + OLD архив (дополнение)
   - Мерж с REST: приоритет REST для полей
   - OLD архив даёт ~20 сделок, которых нет в REST
   - → cache/deals_NEW.json
3. `fetch_dicts.py` — справочники (воронки, стадии, пользователи)
   - → cache/dicts.json
4. `analyze_new.py` — анализ
   - → cache/agg_new.json

**Копирование и перезапуск:**
```bash
cp cache/agg_new.json cache/agg.json
pm2 restart clover-web
```

**Среднее время выполнения:** ~8-12 минут (REST API ~7-8 мин, Export ~4-5 мин).

**Кэши:**
- `cache/deals_rest.json` — свежие данные из REST API (~28k сделок)
- `cache/deals_OLD.json` — полный архив из Export API (~196k записей)
- `cache/deals_NEW.json` — финальный результат после мержа

---

## 5. Структура данных в API

Эндпоинт: `/rshu-management-dashboard/api/data/new`

| Поле | Тип | Описание |
|------|-----|----------|
| `ytd` | object | ИТОГ YTD (7 карточек) |
| `oom_ytd` | object | ООМ YTD |
| `kom_ytd` | object | КОМ YTD |
| `cur` / `oom_cur` / `kom_cur` | object | Текущая неделя |
| `prev` / `oom_prev` / `kom_prev` | object | Прошлая неделя |
| `leads_ytd` / `oom_leads_ytd` / `kom_leads_ytd` | int | Лиды YTD |
| `qual_lead_ytd` / `oom_qual_lead_ytd` / `kom_qual_lead_ytd` | int | MQL YTD |
| `qual_lead_cur` / `qual_lead_prev` | int | MQL неделя |
| `weeks[]` | array | Недельные данные с полями: `leads`, `oom_leads`, `mql`, `oom_mql`, `postupleniya`, `oom_postupleniya`, `kom_postupleniya`, `oplata`, `oom_won_cnt`, `kom_won_cnt`, и т.д. |

**Важно:** Поля `oom_*` и `kom_*` рассчитываются в `analyze_new.py` и передаются как есть через API. **server.js НЕ должен их переопределять.**

---

## 6. Цветовая схема

| Строка | Цвет | Hex |
|--------|------|:---:|
| ИТОГ (ООМ + КОМ) | Тёмно-синий | `#1f2a44` |
| ООМ | Бирюзовый | `#00bcd4` |
| КОМ | Фиолетовый | `#9C27B0` |

---

## 7. Исключения по менеджерам

| ID | Менеджер | Действие |
|:---:|----------|----------|
| 527 + 516 | Щеткина + Гайдукова | → «Автооплаты» (одна строка) |
| 1 | [БОТ] James Bond | Исключить полностью |
| 27119 | Мария Кулевцова | Исключить (ОЗК, тех.сделки) |
| 21286 | Дмитрий Афанасьев | Исключить (лид-менеджер) |

---

## 8. Воронка продаж (5 этапов по неделям)

| Этап | Правило | Детали |
|:---:|---|---|
| 📥 **Лиды** | `is_all_lead()` по DATE_CREATE | CAT IN (0,8,19), без тех.нулевых, без WON-копий |
| 🔍 **MQL** | `is_qual_lead()` по DATE_CREATE | Sale: MQL+ (без NEW/Аларм/Взят/Консульт). КОМ: все кроме WON/LOSE. PreSale(8) не входит |
| 🎯 **SQL** | Стадии SQL+ | **Точно:** DETAILS, PROPOSAL, 2, 6, WON. **С датой счёта:** LOSE, UC_F2YC3N, W6SCHG, 670ME2, VKPN0N. **КОМ:** EXECUTING, C670BC, I443UQ (точно); AL0Z6B, W4ML6H, LOSE — с UF_CRM_5D133690E1 |
| 📄 **Счёт** | `UF_CRM_1753272713011` | Не КОМ |
| ✅ **Оплата** | `UF_DATE_PAY_1C` | CAT IN (0,8,19) + OPP >= 11 |

---

## 9. Скрипты (новая схема)

| Скрипт | Назначение | Источник |
|--------|-----------|----------|
| `fetch_rest.py` | **Основной: выгрузка сделок** | REST API crm.deal.list |
| `fetch_export.py` | **Дополнительный: дозагрузка по ID** | CRM Export API + OLD |
| `fetch_dicts.py` | Справочники (категории, стадии, пользователи) | REST API |
| `analyze_new.py` | **Основной: агрегация всех метрик** | cache/deals_NEW.json |
| `run_full.py` | Полный пайплайн (все шаги) | — |
| `config.py` | Настройки (MIN_OPP, YEAR, пути) | — |

**(Legacy-скрипты fetch_refresh, fetch_pay_dates, fetch_kom_enrich, fetch_incremental, fetch_companies_ext_batch, fetch_contacts_batch, fetch_leads, forecast, build_xlsx — удалены 19.06.2026)**
