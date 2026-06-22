# CHANGELOG — 2026-06-22

## manager-report-dev

### `cd1f6b3` — feat: manager-report-dev — полная логика по менеджерам
Новый дашборд для разработки менеджерского отчёта.

- MQL/SQL синхронизированы с rshu-management
- Группировка менеджеров (main/autopay/tech/bond/afanasyev/other)
- Фильтр по периоду (месяц) с пересчётом на лету
- 3 горизонтальных stacked bar (B2B, источники, форматы)
- Утверждённые правила расчёта

### `d8970d8` (ratings) — SQL логика — полная синхронизация
- SQL: КОМ-стадии EXECUTING/UC_C670BC/UC_I443UQ
- SQL: INV_DT + стадии LOSE/UC_F2YC3N и др.
- Группировка менеджеров (MGR_GROUPS)
- Прочие (уволенные) в одну строку

## Связанные (сегодня ранее)

### `657e971` (rshu-management) — Цикл сделки, 6-я карточка
### `d8970d8` (rshu-management) — metrics: PAY_DT.year == YEAR
### `34f1297` (ratings) — потоковая модель воронки
### `0b5d78c` (ratings) — таблица Менеджеры — воронка с конверсиями
