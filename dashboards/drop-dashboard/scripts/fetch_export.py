"""
fetch_export.py — выгрузка сделок через CRM Export API (помесячно).

Категории: Sale(0), Pre Sale(8), КОМ Sale(19)
Период: 2025-01 — сегодня (текущий месяц)

Запуск: python fetch_export.py && python merge.py && python analyze.py && python build_html.py
"""
import urllib.request, urllib.parse, json, os, sys, time
from datetime import datetime, date

import config
import shutil

EXPORT_URL = "https://24.uprav.ru/web_services/crm/export.php"
SECRET     = "14b0fc053c141e47a5974b3859f5753f"

CATEGORIES = [0, 8, 19]  # Sale, Pre Sale, КОМ (Sale)

SELECT = [
    "ID", "TITLE", "STAGE_ID", "STAGE_SEMANTIC_ID", "CATEGORY_ID",
    "OPPORTUNITY", "CURRENCY_ID", "DATE_CREATE", "DATE_MODIFY",
    "CLOSEDATE", "CLOSED", "ASSIGNED_BY_ID", "SOURCE_ID", "UTM_SOURCE",
    "COMPANY_ID", "CONTACT_ID", "LEAD_ID",
    "UF_DATE_PAY_1C", "UF_CRM_1753341391806",
    "UF_CRM_DATE_START_LEARN", "UF_CRM_DATE_END_LEARN",
    "BEGINDATE",
    "UF_FORMAT", "UF_CRM_1498466811",
    "UF_CRM_1683882427069",
    "UF_CRM_1765896709800",
    "UF_CRM_1753272713011",
]


def export_request(data):
    body = urllib.parse.urlencode({"secret": SECRET, "action": "getDeals", "data": data}, doseq=True).encode()
    req = urllib.request.Request(EXPORT_URL, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def fetch_month(cat_id, year, month):
    """Выгружает все сделки категории за один месяц."""
    month_str = f"{month:02d}"
    if month == 12:
        end_date = f"01.01.{year+1} 00:00:00"
    else:
        end_date = f"01.{month+1:02d}.{year} 00:00:00"
    
    start_date = f"01.{month_str}.{year} 00:00:00"
    
    all_deals = {}
    offset = 0
    limit = 50
    
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
            print(f"  ⚠  [CAT {cat_id}][{month_str}.{year}] Ошибка: {e}")
            time.sleep(3)
            continue
        
        if not resp.get("success"):
            print(f"  ⚠  [CAT {cat_id}][{month_str}.{year}] API: {resp.get('errors')}")
            break
        
        items = resp.get("data", {}).get("items", [])
        if not items:
            break
        
        for d in items:
            all_deals[d["ID"]] = d
        
        nav = resp.get("data", {}).get("nav", {})
        next_offset = nav.get("nextOffset")
        
        if next_offset is None or next_offset <= offset or len(items) < limit:
            break
        offset = next_offset
        time.sleep(0.25)
    
    return all_deals


def main():
    today = date.today()
    year_start = 2025
    year_end = today.year
    month_end = today.month
    
    print("=" * 60)
    print("ВЫГРУЗКА через CRM Export API")
    print(f"Категории: {CATEGORIES} (Sale, Pre Sale, КОМ)")
    print(f"Период: {year_start}-01 — {year_end}-{month_end:02d}")
    print("=" * 60)
    
    # Очищаем старые страницы
    for d in [config.PAGES_CREATE, config.PAGES_CLOSE]:
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)
    
    all_deals = {}
    
    for cat_id in CATEGORIES:
        print(f"\n--- Категория {cat_id} ---")
        for year in range(year_start, year_end + 1):
            start_month = 1 if year > year_start else 1
            end_month = 12 if year < year_end else month_end
            
            for month in range(start_month, end_month + 1):
                deals = fetch_month(cat_id, year, month)
                cnt = len(deals)
                if cnt > 0:
                    print(f"  [{year}-{month:02d}] {cnt} сделок")
                all_deals.update(deals)
                time.sleep(0.2)
    
    print(f"\n{'='*60}")
    print(f"Всего уникальных сделок: {len(all_deals)}")
    print('='*60)
    
    # Сохраняем в pages_CREATE (формат merge.py)
    outdir = config.PAGES_CREATE
    deals_list = sorted(all_deals.values(), key=lambda d: int(d['ID']))
    batch_size = 1000
    for i in range(0, len(deals_list), batch_size):
        chunk = deals_list[i:i + batch_size]
        json.dump(chunk, open(f"{outdir}/p_{i}.json", "w", encoding="utf-8"), ensure_ascii=False)
    
    print(f"Сохранено {len(deals_list)} сделок → {outdir}/")
    print()
    print("Далее запустите:")
    print("  python merge.py")
    print("  python analyze.py")
    print("  python build_html.py")


if __name__ == "__main__":
    main()
