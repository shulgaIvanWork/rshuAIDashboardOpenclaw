# CHANGELOG — 16.06.2026

## analyze_new.py
- Добавлены OOM-поля в недели: oom_postupleniya, oom_won_cnt, oom_leads, oom_mql
- Invoice и оплата теперь включают КОМ (убрал not r["IS_KOM"])
- **Стек 1 (Продажи):** stack_pay/inv/sql/mql/nq/rej + суммы
  - Урезанные стадии: MQL = UC_4RJOR4, UC_W6SCHG; SQL = DETAILS, PROPOSAL, 2, 6 + КОМ EXECUTING
  - excluded: WON, LOSE, F2YC3N, VKPN0N, W6SCHG, 670ME2 (закрытые)
  - excluded: C8:WON-копии, C19:LOSE
- **Стек 2 (Маркетинг):** stack2_pay/inv/sql/mql/nq/rej + суммы
  - Полные KPI-стадии: MQL = все MQL+; SQL = все SQL+ включая WON
- Функции классификации разделены: _is_sql1/_mql1 (стек 1), _is_sql2/_mql2 (стек 2)

## fetch_kom_enrich.py
- Новый скрипт дозагрузки UF_* полей через REST API batch
- Поля: UF_CRM_1683882427069, UF_FORMAT, UF_CRM_1498466811, UF_CRM_1765896709800
- UF_CRM_1753272713011, MOVED_TIME, PREVIOUS_STAGE_ID

## server.js
- Убраны 3 блока с перезаписью oom_ytd = {...ytd}

## public/index.html
- renderFilteredData: OOM полей (oom_postupleniya, oom_won_cnt, oom_leads)
- Новая stacked bar воронка (newChFunnel) — стек 1
- Вторая stacked bar (newChFunnel2) — стек 2
- Тултип: число + % + сумма (SQL/Счёт/Оплата)
- Подпись с общим числом лидов в заголовке стека 2
- График конверсий смещён ниже
