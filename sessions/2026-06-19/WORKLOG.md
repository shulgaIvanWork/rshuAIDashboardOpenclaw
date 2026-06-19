# WORKLOG — 19.06.2026

**Участники:** Ольга (telegram)
**Время:** 08:18 UTC — ...

---

## 08:18 UTC — Начало сессии
- Ольга сообщила, что после обновления данных конфликт — недельные карточки КПЭ 6 и 7 некорректны
- Выяснил: run_full.py падает на fetch_companies_ext_batch.py (ValueError: 'None' company_id)
- Проблема: COMPANY_ID приходит как None → str(None) = 'None' → int('None') падает
- Вторая проблема: run_full.py не запускал fetch_pay_dates.py и fetch_kom_enrich.py — данные о КОМ и UF_DATE_PAY_1C не дозагружались

## 08:44 UTC — Исправления
- Починил fetch_companies_ext_batch.py: фильтр None/'None'/'0' значений, защита сортировки
- Починил run_full.py: добавил fetch_pay_dates.py и fetch_kom_enrich.py в пайплайн

## 08:44+ UTC — Запуск обновления
- fetch_refresh.py ✅ 29145 сделок
- fetch_dicts.py ✅
- fetch_pay_dates.py ✅ — оптимизирован (фильтр кандидатов с 24k→2.5k), найдено 29 UF_DATE_PAY_1C
- fetch_kom_enrich.py ✅ — 5011 сделок обогащено, 1722 определены КОМ
- fetch_companies_ext_batch.py ⚠️ — починен, но не завершился (таймаут). 3188 компаний кэшировано
- fetch_contacts_batch.py ⚠️ — такой же баг 'None' починен, не запускался (не критично)
- fetch_leads.py ⏭️ — пропущен
- analyze_new.py ✅ — agg_new.json создан
- pm2 restart clover-web ✅ — сервер перезагружен

## 08:44+ UTC — Ошибка addEventListener
- `app.js` грузится в `<head>`, а refreshBtn в `<body>` — элемент ещё не создан
- Починил: обернул в `if (refreshBtn)` проверку
- Вторая проблема: loadAll() вызывался в `<head>` до создания DOM → contentAreaNew=null → выход без загрузки
- Починил: обернул loadAll() в `DOMContentLoaded`

## Текущие цифры (после обновления)
- YTD: 76,747,354 ₽ (881 сд.) — было 76,609,104 ₽ (880 сд.)
- ООМ: 59,855,969 ₽ (835 сд.) / КОМ: 14,048,133 ₽ (46 сд.) — совпадает
- Неделя 25 (cur): 614,650 ₽ / 9 сд. — поступления
- Неделя 24 (prev): 1,480,050 ₽ / 13 сд.
- Карточка 7: лиды 8/9, MQL 8/9 (все КОМ)

## Что починил
1. **fetch_companies_ext_batch.py** — фильтр None/'None'/'0' строк в COMPANY_ID
2. **fetch_contacts_batch.py** — то же самое для CONTACT_ID
3. **run_full.py** — добавлены fetch_pay_dates.py и fetch_kom_enrich.py в пайплайн
4. **fetch_pay_dates.py** — оптимизирован: вместо проверки всех 24k сделок без даты, фильтрует только кандидатов (≥11₽, кат 0/8/19, не WON-копии)

