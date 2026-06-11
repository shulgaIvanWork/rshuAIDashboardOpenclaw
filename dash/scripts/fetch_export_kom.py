"""
fetch_export_kom.py — выгрузка сделок с новыми полями (UF_*) из Export API.

Стратегия:
1. Категория 19 (КОМ) — полностью (≤ 5000)
2. Категория 0 (Sale) — последние 5000
3. Категория 8 (Pre Sale) — последние 5000

Затем merge с existing_data_from_old_dump для недостающих ID.
"""
import urllib.request, urllib.parse, json, os, sys, time, shutil

import config

EXPORT_URL = "https://24.uprav.ru/web_services/crm/export.php"
SECRET     = "14b0fc053c141e47a5974b3859f5753f"

CATEGORIES = [0, 8, 19]

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

def flatten_dict(prefix, d):
    params = []
    if isinstance(d, dict):
        for k, v in d.items():
            if isinstance(v, (dict, list)):
                params.extend(flatten_dict(f'{prefix}[{k}]', v))
            else:
                params.append((f'{prefix}[{k}]', str(v)))
    elif isinstance(d, list):
        for i, v in enumerate(d):
            params.append((f'{prefix}[{i}]', str(v)))
    return params

def export_request(data):
    params = flatten_dict('data', data)
    params.append(('secret', SECRET))
    params.append(('action', 'getDeals'))
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(EXPORT_URL, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())

def fetch_category(cat_id, limit=50, max_offset=5000):
    """Выгружает сделки категории до max_offset."""
    all_deals = {}
    offset = 0
    
    while offset <= max_offset:
        data = {
            "FILTER": {"CATEGORY_ID": cat_id},
            "SELECT": SELECT,
            "SORT": {"ID": "DESC"},
            "nav": {"limit": limit, "offset": offset},
            "WITH_PRODUCTS": "N",
        }
        
        try:
            resp = export_request(data)
        except Exception as e:
            print(f"  [CAT {cat_id}] offset={offset} Error: {e}")
            time.sleep(3)
            continue
        
        if not resp.get("success"):
            print(f"  [CAT {cat_id}] API error: {resp.get('errors')}")
            break
        
        items = resp.get("data", {}).get("items", [])
        if not items:
            break
        
        for d in items:
            all_deals[d["ID"]] = d
        
        nav = resp.get("data", {}).get("nav", {})
        next_offset = nav.get("nextOffset")
        
        print(f"  [CAT {cat_id}] offset={offset} got={len(items)} total={len(all_deals)}")
        
        if next_offset is None or next_offset == offset or next_offset > max_offset:
            break
        offset = next_offset
        time.sleep(0.25)
    
    return all_deals

def main():
    print("=" * 60)
    print("ВЫГРУЗКА через Export API (только новые поля)")
    print("=" * 60)
    
    # Очищаем старые страницы
    for d in [config.PAGES_CREATE, config.PAGES_CLOSE]:
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)
    
    # Загружаем существующие данные (полный дамп 293k)
    existing_path = os.path.join(config.CACHE_DIR, 'deals_all.json')
    if os.path.exists(existing_path):
        existing = json.load(open(existing_path, encoding='utf-8'))
        print(f"\nСуществующие данные: {len(existing)} сделок")
    else:
        existing = json.load(open(config.DEALS_JSON, encoding='utf-8'))
        print(f"\nТекущие данные: {len(existing)} сделок")
    
    # Собираем всё в один словарь
    all_deals = {d['ID']: d for d in existing}
    
    # Выгружаем из Export API
    for cat_id in CATEGORIES:
        print(f"\n--- Категория {cat_id} ---")
        new_deals = fetch_category(cat_id)
        print(f"  ✅ Получено {len(new_deals)} сделок из Export API")
        
        # Только добавляем UF-поля к существующим сделкам + новые ID
        for did, new_deal in new_deals.items():
            if did in all_deals:
                # Обогащаем UF-полями, не меняя CATEGORY_ID
                for key in ['UF_FORMAT', 'UF_CRM_1498466811', 'UF_CRM_1683882427069', 
                           'UF_CRM_1765896709800', 'UF_CRM_1753272713011', 'UF_DATE_PAY_1C',
                           'UF_CRM_DATE_START_LEARN', 'UF_CRM_DATE_END_LEARN']:
                    if key in new_deal and new_deal[key]:
                        all_deals[did][key] = new_deal[key]
                # Сохраняем CONACT, COMPANY обогащение
                if 'CONTACT' in new_deal:
                    all_deals[did]['CONTACT'] = new_deal['CONTACT']
                if 'COMPANY' in new_deal:
                    all_deals[did]['COMPANY'] = new_deal['COMPANY']
            else:
                all_deals[did] = new_deal
    
    print(f"\n{'='*60}")
    print(f"Всего сделок: {len(all_deals)}")
    
    # Фильтруем: только 2025-2026, наши 3 категории
    need_cats = {0, 8, 19}
    filtered = []
    for d in all_deals.values():
        cat = int(d.get('CATEGORY_ID', 0))
        if cat not in need_cats:
            continue
        dc = d.get('DATE_CREATE', '')
        # Поддержка двух форматов: ГГГГ-ММ-ДД (старый REST) и ДД.ММ.ГГГГ (Export API)
        if dc and len(dc) >= 4:
            if dc[2] == '.':  # Формат ДД.ММ.ГГГГ
                year = dc[6:10]
            else:  # Формат ГГГГ-ММ-ДД
                year = dc[:4]
        else:
            year = ''
        if year not in ('2024', '2025', '2026'):
            continue
        filtered.append(d)
    
    print(f"Отфильтровано (2024-2026, 3 категории): {len(filtered)}")
    
    # Сохраняем
    outdir = config.PAGES_CREATE
    batch_size = 1000
    for i in range(0, len(filtered), batch_size):
        chunk = filtered[i:i + batch_size]
        json.dump(chunk, open(f"{outdir}/p_{i}.json", "w", encoding="utf-8"), ensure_ascii=False)
    
    print(f"Сохранено в {outdir}/")
    print()
    print("Далее: python merge.py && python analyze_new.py")

if __name__ == "__main__":
    main()
