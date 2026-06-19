# CHANGELOG — 19.06.2026

## fetch_companies_ext_batch.py
- Защита от `COMPANY_ID = None` → `str(None) = 'None'`
- Фильтр: пропускаем None, 'None', '0', пустые строки при сборе company_ids
- Безопасная сортировка: отделяем числовые ID от нечисловых

## run_full.py
- Добавлены шаги 2b (fetch_pay_dates.py) и 2c (fetch_kom_enrich.py) в пайплайн
- Без них UF_DATE_PAY_1C и КОМ-поля не дозагружались

