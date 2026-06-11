"""
fetch_export_full.py — ПОЛНАЯ выгрузка через CRM Export API (курсорная пагинация).

Только через Export API, без старых дампов.
Использует >ID для курсорной пагинации: offset ≤ 5000, limit = 50.
Проходит все сделки категорий 0, 8, 19 за 2025-2026.

Запуск: python fetch_export_full.py && python merge.py && python analyze_new.py
"""
import urllib.request, urllib.parse, json, os, sys, time, shutil, re
import config

EXPORT_URL = "https://24.uprav.ru/web_services/crm/export.php"
SECRET     = "14b0fc053c141e47a5974b3859f5753f"

CATEGORIES = [0, 8, 19]
LIMIT = 50
MAX_OFFSET = 5000

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

def flatten(prefix, d):
    params = []
    if isinstance(d, dict):
        for k, v in d.items():
            if isinstance(v, (dict, list)):
                params.extend(flatten(f'{prefix}[{k}]', v))
            else:
                params.append((f'{prefix}[{k}]', str(v)))
    elif isinstance(d, list):
        for i, v in enumerate(d):
            params.append((f'{prefix}[{i}]', str(v)))
    return params

def fetch_page(cat_id, cursor_id=0, offset=0):
    data = {
        "FILTER": {"CATEGORY_ID": cat_id},
        "SELECT": SELECT,
        "SORT": {"ID": "ASC"},
        "nav": {"limit": LIMIT, "offset": offset},
    }
    if cursor_id > 0:
        data["FILTER"][">ID"] = cursor_id
    
    params = flatten('data', data)
    params.append(('secret', SECRET))
    params.append(('action', 'getDeals'))
    body = urllib.parse.urlencode(params).encode()
    
    req = urllib.request.Request(EXPORT_URL, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())

def extract_year(dc_str):
    """Извлекает год из даты (поддерживает ГГГГ-ММ-ДД и ДД.ММ.ГГГГ)."""
    if not dc_str or len(dc_str) < 4: return ''
    return dc_str[6:10] if dc_str[2] == '.' else dc_str[:4]

def fetch_category(cat_id):
    """Выгружает ВСЕ сделки категории через курсорную пагинацию."""
    all_deals = {}
    cursor = 0
    total_fetched = 0
    
    while True:
        offset = 0
        page_count = 0
        last_id = cursor
        
        while offset <= MAX_OFFSET:
            resp = fetch_page(cat_id, cursor, offset)
            if not resp.get("success"):
                print(f"  [CAT {cat_id}] API error at cursor={cursor} offset={offset}")
                break
            
            items = resp.get("data", {}).get("items", [])
            if not items:
                break
            
            for d in items:
                all_deals[d["ID"]] = d
                last_id = max(last_id, int(d["ID"]))
            
            page_count += len(items)
            nav = resp.get("data", {}).get("nav", {})
            next_off = nav.get("nextOffset")
            
            if next_off is None or next_off == offset or next_off > MAX_OFFSET:
                break
            offset = next_off
            time.sleep(0.25)
        
        total_fetched += page_count
        print(f"  [CAT {cat_id}] cursor={cursor} got={page_count} total={len(all_deals)} last_id={last_id}")
        
        if page_count == 0 or last_id == cursor:
            break
        cursor = last_id
        time.sleep(0.5)
    
    return all_deals

def main():
    print("=" * 60)
    print("ПОЛНАЯ ВЫГРУЗКА через CRM Export API (курсорная пагинация)")
    print("=" * 60)
    
    # Очищаем страницы
    for d in [config.PAGES_CREATE, config.PAGES_CLOSE]:
        if os.path.exists(d): shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)
    
    all_deals = {}
    for cat_id in CATEGORIES:
        print(f"\n--- Категория {cat_id} ---")
        deals = fetch_category(cat_id)
        print(f"  ✅ {len(deals)} сделок")
        all_deals.update(deals)
    
    print(f"\n{'='*60}")
    print(f"Всего сделок: {len(all_deals)}")
    
    # Фильтр: 2025-2026
    filtered = [d for d in all_deals.values()
                if extract_year(d.get('DATE_CREATE','')) in ('2025', '2026')]
    
    print(f"Из них 2025-2026: {len(filtered)}")
    
    # Сохраняем
    batch_size = 1000
    for i in range(0, len(filtered), batch_size):
        chunk = filtered[i:i + batch_size]
        json.dump(chunk, open(f"{config.PAGES_CREATE}/p_{i}.json", "w", encoding="utf-8"), ensure_ascii=False)
    
    print(f"Сохранено → {config.PAGES_CREATE}/")
    print()
    print("Далее: python merge.py && python analyze_new.py")

if __name__ == "__main__":
    main()
