"""
refresh_filtered.py — быстрый перезапуск пайплайна.

1. Фильтрует существующие сделки 2026 только по Sale (0), Pre Sale (8), КОМ Sale (19)
2. Догружает 2025 год через Export API (по месяцам, из-за лимита offset=5000)
3. Собирает финальный датасет
4. Запускает merge.py → analyze.py → build_html.py

Запуск: python refresh_filtered.py
"""
import urllib.request, urllib.parse, json, os, sys, time
import config

EXPORT_URL = "https://24.uprav.ru/web_services/crm/export.php"
SECRET     = "14b0fc…753f"

NEEDED_CATS = [0, 8, 19]  # Sale, Pre Sale, КОМ (Sale)
YEAR = 2026
OUTPUT_DEALS = os.path.join(config.CACHE_DIR, 'deals_2026.json')

SELECT = [
    "ID", "TITLE", "STAGE_ID", "STAGE_SEMANTIC_ID", "CATEGORY_ID",
    "OPPORTUNITY", "CURRENCY_ID", "DATE_CREATE", "DATE_MODIFY",
    "CLOSEDATE", "CLOSED", "ASSIGNED_BY_ID", "SOURCE_ID", "UTM_SOURCE",
    "COMPANY_ID", "CONTACT_ID", "LEAD_ID",
    "UF_DATE_PAY_1C", "UF_CRM_1753341391806",
    "UF_CRM_DATE_START_LEARN", "UF_CRM_DATE_END_LEARN",
    "BEGINDATE",
]

def export_request(data):
    body = urllib.parse.urlencode({"secret": SECRET, "action": "getDeals", "data": data}, doseq=True).encode()
    req = urllib.request.Request(EXPORT_URL, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())

def fetch_category_by_month(cat_id, year, months=None):
    """Выгружает сделки категории за год, разбивая по месяцам (из-за offset ≤ 5000)."""
    if months is None:
        months = range(1, 13)
    
    all_deals = {}
    for month in months:
        month_str = f"{month:02d}"
        start_date = f"01.{month_str}.{year} 00:00:00"
        if month == 12:
            end_date = f"31.12.{year} 23:59:59"
        else:
            end_date = f"01.{month+1:02d}.{year} 00:00:00"
        
        offset = 0
        limit = 50
        month_total = 0
        
        while True:
            data = {
                "FILTER": {
                    "CATEGORY_ID": cat_id,
                    ">=DATE_CREATE": start_date,
                    "<DATE_CREATE": end_date,
                },
                "SELECT": SELECT,
                "SORT": {"ID": "ASC"},
                "nav": {"limit": limit, "offset": offset},
                "WITH_PRODUCTS": "N",
            }
            
            try:
                resp = export_request(data)
            except Exception as e:
                print(f"  [CAT {cat_id}][{month:02d}/{year}] Ошибка: {e}")
                time.sleep(5)
                continue
            
            if not resp.get("success"):
                print(f"  [CAT {cat_id}][{month:02d}/{year}] API ошибка: {resp.get('errors')}")
                break
            
            items = resp.get("data", {}).get("items", [])
            if not items:
                break
            
            for d in items:
                all_deals[d["ID"]] = d
            
            month_total += len(items)
            nav = resp.get("data", {}).get("nav", {})
            next_offset = nav.get("nextOffset")
            
            if next_offset is None or next_offset <= offset or len(items) < limit:
                break
            offset = next_offset
            time.sleep(0.3)
        
        if month_total > 0:
            print(f"  [CAT {cat_id}][{month:02d}/{year}] {month_total} сделок")
    
    return all_deals

def main():
    print("== Обновление данных: только Sale, Pre Sale, КОМ (Sale) ==")
    print()
    
    # Шаг 1: Фильтруем существующие сделки 2026
    print("--- Шаг 1: Фильтрация 2026 по нужным категориям ---")
    all_deals_path = os.path.join(config.CACHE_DIR, 'deals_all.json')
    
    if os.path.exists(all_deals_path):
        # Уже есть бэкап полных данных
        existing = json.load(open(all_deals_path, encoding='utf-8'))
    elif os.path.exists(config.DEALS_JSON):
        # Создаём бэкап
        existing = json.load(open(config.DEALS_JSON, encoding='utf-8'))
        json.dump(existing, open(all_deals_path, 'w', encoding='utf-8'), ensure_ascii=False)
        print(f"  Создан бэкап: {all_deals_path} ({len(existing)} сделок)")
    else:
        existing = []
    
    filtered = {d['ID']: d for d in existing if int(d.get('CATEGORY_ID', 0)) in NEEDED_CATS}
    print(f"  Отфильтровано: {len(filtered)} сделок из {len(existing)}")
    
    # Шаг 2: Догружаем 2025 год по месяцам
    print()
    print("--- Шаг 2: Догрузка 2025 года через Export API ---")
    for cat_id in NEEDED_CATS:
        deals_2025 = fetch_category_by_month(cat_id, 2025)
        print(f"  Категория {cat_id}: +{len(deals_2025)} сделок за 2025")
        filtered.update(deals_2025)
    
    # Шаг 3: Сохраняем
    print()
    print("--- Шаг 3: Сохранение ---")
    final = list(filtered.values())
    json.dump(final, open(config.DEALS_JSON, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f"  Сохранено {len(final)} сделок → {config.DEALS_JSON}")
    
    # Шаг 4: Запускаем пайплайн
    print()
    print("--- Шаг 4: merge.py ---")
    os.chdir(config.SCRIPT_DIR)
    exec(open('merge.py').read())
    
    print()
    print("--- Шаг 5: analyze.py ---")
    exec(open('analyze.py').read())
    
    print()
    print("--- Шаг 6: build_html.py ---")
    exec(open('build_html.py').read())
    
    print()
    print("✅ Готово! Дашборд обновлён.")

if __name__ == "__main__":
    main()
