# CHANGELOG — 19.06.2026

## Создано
- `fetch_rest.py` — REST API crm.deal.list, next-токен, все поля корректные
- `fetch_export.py` — Export API + OLD архив, мерж с REST (приоритет REST)

## Изменено
- `fetch_companies_ext_batch.py` — фильтр None/'None'/'0' строк в COMPANY_ID (удалён)
- `fetch_contacts_batch.py` — то же для CONTACT_ID (удалён)
- `fetch_pay_dates.py` — оптимизирован: фильтр кандидатов 24k→2.5k (удалён)
- `run_full.py` — новая схема: rest → export → dicts → analyze
- `server.js` — артефакт #240316 (старая сделка в работе)
- `public/app.js` — DOMContentLoaded для loadAll(), if(refreshBtn) проверка
- `public/app.js` — kom_leads_ytd пересчитывается из weeks
- `public/app.js` — median_check и avg_close_days_won для ООМ/КОМ

## Удалено
- fetch_refresh.py, fetch_pay_dates.py, fetch_kom_enrich.py
- fetch_incremental.py, fetch_companies_ext_batch.py
- fetch_contacts_batch.py, fetch_leads.py, forecast.py
- build_xlsx.py

## Коммиты
1. `7252cce` — Новая схема выгрузки: REST + Export (7 файлов)
2. `3f18dd5` — Удалены legacy скрипты (8 файлов)
3. `bfa764f` — Удалён build_xlsx.py
4. `a521bf1` — run_full: убран вызов build_xlsx.py
