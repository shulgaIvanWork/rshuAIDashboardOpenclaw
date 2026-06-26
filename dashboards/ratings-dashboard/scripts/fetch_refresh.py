"""
fetch_refresh.py — Быстрое обновление данных через CRM Export API.

Загружает сделки категорий 0, 8, 19 за 2025-2026,
мержит с существующим deals_OLD.json (бэкапом),
перезапускает анализ.
"""
import urllib.request, json, os, sys, time, shutil
sys.path.insert(0, os.path.dirname(__file__))
import config

EXPORT_URL = "https://24.uprav.ru/web_services/crm/export.php"
SECRET     = "14b0fc053c141e47a5974b3859f5753f"
CATEGORIES = [0, 8, 19]
LIMIT = 50
MAX_OFFSET = 50000

SELECT = [
    "ID", "TITLE", "STAGE_ID", "STAGE_SEMANTIC_ID", "CATEGORY_ID",
    "OPPORTUNITY", "CURRENCY_ID", "DATE_CREATE", "DATE_MODIFY",
    "CLOSEDATE", "CLOSED", "ASSIGNED_BY_ID", "SOURCE_ID",
    "COMPANY_ID", "CONTACT_ID",
    "UF_DATE_PAY_1C",
    "UF_FORMAT", "UF_CRM_1498466811",
    "UF_CRM_1683882427069",
    "UF_CRM_1765896709800",
    "UF_CRM_1753272713011",
    "UF_CRM_DATE_START_LEARN", "UF_CRM_DATE_END_LEARN",
]

def fetch_page(params):
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(EXPORT_URL, data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())

def fetch_category_simple(cat_id):
    """Пагинация: offset от 0 с шагом LIMIT. Останавливается, когда 2 страницы подряд не дали новых ID."""
    all_deals = {}
    offset = 0
    stale_pages = 0
    while offset <= MAX_OFFSET:
        params = [
            ('secret', SECRET),
            ('action', 'getDeals'),
            ('data[FILTER][CATEGORY_ID]', str(cat_id)),
            ('data[FILTER][>OPPORTUNITY]', '0'),
            ('data[SORT][ID]', 'ASC'),
            ('data[nav][limit]', str(LIMIT)),
            ('data[nav][offset]', str(offset)),
        ]
        for i, field in enumerate(SELECT):
            params.append((f'data[SELECT][{i}]', field))
        
        try:
            resp = fetch_page(params)
        except Exception as e:
            print(f"  [CAT {cat_id}] offset={offset} error: {e}")
            break
        
        if not resp.get("success"):
            print(f"  [CAT {cat_id}] offset={offset} API failed")
            break
        
        items = resp.get("data", {}).get("items", [])
        if not items:
            print(f"  [CAT {cat_id}] offset={offset} empty — done")
            break
        
        before = len(all_deals)
        for d in items:
            all_deals[d["ID"]] = d
        new = len(all_deals) - before
        
        print(f"  [CAT {cat_id}] offset={offset}: {len(items)} items, {new} new, total={len(all_deals)}")
        
        if new == 0:
            stale_pages += 1
            if stale_pages >= 2:
                print(f"  [CAT {cat_id}] 2 пустых страницы подряд — стоп")
                break
        else:
            stale_pages = 0
        
        offset += LIMIT
        time.sleep(0.2)
    
    return all_deals

def main():
    print("=" * 60)
    print("БЫСТРОЕ ОБНОВЛЕНИЕ через CRM Export API")
    print("=" * 60)
    
    # Загружаем существующий бэкап
    old_path = os.path.join(config.CACHE_DIR, 'deals_OLD.json')
    if os.path.exists(old_path):
        print(f"\nЗагружаем существующий бэкап: {old_path}")
        existing = json.load(open(old_path, encoding='utf-8'))
        print(f"  {len(existing)} сделок")
    else:
        print("\nБэкап не найден, начинаем с нуля")
        existing = []
    
    existing_map = {d["ID"]: d for d in existing}
    print(f"  Уникальных ID: {len(existing_map)}")
    
    # Загружаем свежие данные по каждой категории
    fresh = {}
    for cat_id in CATEGORIES:
        print(f"\n--- Категория {cat_id} ---")
        deals = fetch_category_simple(cat_id)
        print(f"  ✅ {len(deals)} сделок")
        for k, v in deals.items():
            # Сохраняем только если ID новый или входящий — мержим
            fresh[k] = v
    
    print(f"\n{'='*60}")
    print(f"Свежих сделок: {len(fresh)}")
    
    # Мержим: существующие + новые
    merged = {**existing_map}
    for k, v in fresh.items():
        merged[k] = v
    print(f"После слияния: {len(merged)}")
    
    # Фильтр 2025-2026
    def extract_year(dc_str):
        if not dc_str or len(dc_str) < 4: return ''
        return dc_str[6:10] if dc_str[2] == '.' else dc_str[:4]
    
    merged_list = [d for d in merged.values()
                   if extract_year(d.get('DATE_CREATE','')) in ('2025', '2026')
                   or extract_year(d.get('CLOSEDATE','')) in ('2025', '2026')]
    
    print(f"Из них 2025-2026: {len(merged_list)}")
    
    # Сохраняем как deals_2026.json
    deals_path = os.path.join(config.CACHE_DIR, 'deals_2026.json')
    json.dump(merged_list, open(deals_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f"\n✅ Сохранено: {deals_path} ({os.path.getsize(deals_path)/1024/1024:.1f} MB)")
    
    # Сохраняем как deals_NEW.json для new-анализа
    new_path = os.path.join(config.CACHE_DIR, 'deals_NEW.json')
    json.dump(merged_list, open(new_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f"✅ Сохранено: {new_path}")
    
    print("\nДалее: python merge.py && python analyze_new.py")

if __name__ == "__main__":
    main()
