# DECISIONS — 19.06.2026

1. Все скрипты, работающие с company_id/contact_id, должны фильтровать None/'None'/'0'/пустые строки до сортировки
2. fetch_pay_dates.py должен фильтровать кандидатов, а не проверять все сделки без даты
3. run_full.py обязан включать fetch_pay_dates.py и fetch_kom_enrich.py перед analyze_new.py
4. fetch_companies_ext_batch.py и fetch_contacts_batch.py — не критичны для KPI, можно пропускать при таймаутах

