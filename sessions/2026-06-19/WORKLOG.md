# WORKLOG — 19.06.2026

**Участники:** Ольга
**Время:** 08:18 — 14:20 UTC

---

## 08:18 — Начало: КПЭ 6 и 7 некорректны
- run_full.py падает на fetch_companies_ext_batch.py: ValueError 'None' company_id
- run_full.py не включает fetch_pay_dates + fetch_kom_enrich
- Починил fetch_companies_ext_batch.py (фильтр None) и fetch_contacts_batch.py
- Починил app.js: addEventListener на null (скрипт в head, DOM не готов)
- Починил app.js: loadAll() вызывался до DOM → "Загрузка данных…" висела вечно

## 12:00 — Новая схема: REST + Export
Утверждена Ольгой:
1. **fetch_rest.py** — REST API crm.deal.list (основной, next-токен, все поля)
2. **fetch_export.py** — Export API + OLD архив (дополняет по ID)
3. fetch_dicts.py → analyze_new.py → agg.json

Результат: 28365 сделок, SEMANTIC: F=14388, S=13224, P=753
Export + OLD: +20 сделок к REST

## 13:56 — Пересчёт при фильтрации по дате
- kom_leads_ytd был статичным (orig) → пересчитывается из weeks
- median_check и avg_close_days_won для ООМ/КОМ не пересчитывались → починил

## 14:15 — Чистка скриптов
Удалены 9 legacy файлов:
- fetch_refresh, fetch_pay_dates, fetch_kom_enrich, fetch_incremental
- fetch_companies_ext_batch, fetch_contacts_batch, fetch_leads
- fetch_forecast, build_xlsx

Осталось 6: config, fetch_rest, fetch_export, fetch_dicts, analyze_new, run_full

## Итоговый пайплайн
run_full.py → fetch_rest → fetch_export → fetch_dicts → analyze_new → agg.json

## Итоговые цифры на дашборде (REST)
- YTD: 75,460,232 ₽ / 889 сд.
- ООМ: 62,722,099 ₽ / 845 сд.
- КОМ: 12,738,133 ₽ / 44 сд.
- Неделя 25: поступления 1,768,278 ₽, лиды 153 (ООМ 137 + КОМ 16)
- Сделка #240316 (2024, в работе, 42,500₽) — добавлена в артефакты
