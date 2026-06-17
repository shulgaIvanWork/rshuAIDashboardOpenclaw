# CHANGELOG — 16.06.2026 (v2, дополнено 17.06)

## analyze_new.py
- Добавлены OOM-поля в недели: oom_postupleniya, oom_won_cnt, oom_leads, oom_mql
- Invoice и оплата теперь включают КОМ (убрал not r["IS_KOM"])
- **Стек 1 (Продажи):** stack_pay/inv/sql/mql/nq/rej + суммы
  - Урезанные стадии: MQL = UC_4RJOR4, SQL = DETAILS/PROPOSAL/2/6 + КОМ EXECUTING
  - excluded: WON, LOSE, F2YC3N, VKPN0N, W6SCHG, 670ME2
  - excluded: C8:WON-копии, C19:LOSE, tech_won
- **Стек 2 (Маркетинг):** stack2_pay/inv/sql/mql/nq/rej + суммы
  - Полные KPI-стадии: MQL все MQL+, SQL все SQL+ включая WON
- Функции классификации разделены: _is_sql1/_mql1 (стек 1), _is_sql2/_mql2 (стек 2)
- _get_effective_stage() — MOVED_TIME + PREVIOUS_STAGE_ID для корректного определения стадии на неделе

## fetch_kom_enrich.py
- Новый скрипт — дозагрузка UF_* полей через REST API batch
- Поля: UF_CRM_1683882427069, UF_FORMAT, UF_CRM_1498466811, UF_CRM_1765896709800,
  UF_CRM_1753272713011, MOVED_TIME, PREVIOUS_STAGE_ID

## server.js (rshu-management-dashboard)
- Убраны 3 блока с перезаписью oom_ytd = {...ytd}

## public/index.html (rshu-management-dashboard)
- renderFilteredData: OOM поля (oom_postupleniya, oom_won_cnt, oom_leads)
- buildFilteredData(): OOM/КОМ аналогично ИТОГ — через oom_postupleniya/ком_postupleniya
- Новая stacked bar воронка (newChFunnel, newChFunnel2)
- Тултип: число + % + сумма
- destroyNewCharts() + chartInstancesNew для очистки графиков
- **Переименование лейблов:**
  - «WON vs LOSE» → «Оплаты vs Отказы» (заголовки)
  - «WON» → «Оплаты», «LOSE» → «Отказы» (лейблы графиков)
  - «Выиграно/Проиграно» → «Оплаты/Отказы» (ch_cnt)
- Добавлен tooltip с долей для newChWl

## Созданы файлы
- `docs/Инструкция_по_графикам_и_таблицам.md` — полное описание всех графиков
- `sessions/2026-06-16/WORKLOG_v2.md` — лог сессии
- `sessions/2026-06-16/DECISIONS_v2.md` — утверждённые решения
- `sessions/2026-06-16/CHANGELOG_v2.md` — этот файл
- `sessions/2026-06-16/TODO_v2.md` — backlog
