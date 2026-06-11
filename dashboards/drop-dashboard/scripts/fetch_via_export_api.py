"""
fetch_via_export_api.py — обновление данных сделок через CRM Export API.
Берёт сделки за 2025-2026 по воронкам Sale (0), Pre Sale (8), КОМ Sale (19).

Запуск: python fetch_via_export_api.py

После этого запустить:
    python merge.py
    python analyze.py
    python build_html.py
"""
import urllib.request, urllib.parse, json, os, sys, time
import config

EXPORT_URL = "https://24.uprav.ru/web_services/crm/export.php"
SECRET     = "14b0fc053c141e47a5974b3859f5753f"

CATEGORIES = [0, 8, 19]  # Sale, Pre Sale, КОМ (Sale)
YEAR       = 2025

SELECT = [
    "ID", "TITLE", "STAGE_ID", "STAGE_SEMANTIC_ID", "CATEGORY_ID",
    "OPPORTUNITY", "CURRENCY_ID", "DATE_CREATE", "DATE_MODIFY",
    "CLOSEDATE", "CLOSED", "ASSIGNED_BY_ID", "SOURCE_ID", "UTM_SOURCE",
    "COMPANY_ID", "CONTACT_ID", "LEAD_ID",
    "UF_DATE_PAY_1C", "UF_CRM_1753341391806",
    "UF_CRM_DATE_START_LEARN", "UF_CRM_DATE_END_LEARN",
    "BEGINDATE",
    "UF_FORMAT",
    "UF_CRM_1498466811",
]

def export_request(data):
    body = urllib.parse.urlencode({"secret": SECRET, "action": "getDeals", "data": data}, doseq=True).encode()
    req = urllib.request.Request(EXPORT_URL, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())

def fetch_category(cat_id, year_start=2025):
    """Выгружает все сделки указанной категории с year_start по текущий год."""
    all_deals = {}
    offset = 0
    limit = 50
    total_fetched = 0

    while True:
        data = {
            "FILTER": {
                "CATEGORY_ID": cat_id,
                ">=DATE_CREATE": f"01.01.{year_start} 00:00:00",
            },
            "SELECT": SELECT,
            "SORT": {"ID": "ASC"},
            "nav": {"limit": limit, "offset": offset},
            "WITH_PRODUCTS": "N",
        }
        
        try:
            resp = export_request(data)
        except Exception as e:
            print(f"  [CAT {cat_id}] Ошибка запроса: {e}")
            time.sleep(5)
            continue

        if not resp.get("success"):
            print(f"  [CAT {cat_id}] API ошибка: {resp.get('errors')}")
            break

        items = resp.get("data", {}).get("items", [])
        if not items:
            break

        for d in items:
            all_deals[d["ID"]] = d

        total_fetched += len(items)
        nav = resp.get("data", {}).get("nav", {})
        next_offset = nav.get("nextOffset")
        
        print(f"  [CAT {cat_id}] offset={offset} got={len(items)} total={total_fetched}")
        
        if next_offset is None or next_offset <= offset or len(items) < limit:
            break
        offset = next_offset
        time.sleep(0.3)  # Rate limiting

    print(f"  [CAT {cat_id}] Итого: {len(all_deals)} сделок")
    return all_deals

def main():
    print(f"== Выгрузка сделок через CRM Export API ==")
    print(f"Категории: {CATEGORIES}")
    print()

    all_deals = {}
    for cat_id in CATEGORIES:
        print(f"--- Категория {cat_id} ---")
        deals = fetch_category(cat_id, YEAR)
        all_deals.update(deals)
        print()

    print(f"Всего уникальных сделок: {len(all_deals)}")

    # Сохраняем в формате, совместимом с merge.py
    # Записываем как страницы в pages_CREATE
    outdir = config.PAGES_CREATE
    os.makedirs(outdir, exist_ok=True)
    
    # Разбиваем на батчи по 1000 для совместимости
    batch_size = 1000
    deals_list = list(all_deals.values())
    for i in range(0, len(deals_list), batch_size):
        chunk = deals_list[i:i + batch_size]
        batch_num = i // batch_size
        fp = f"{outdir}/p_export_{batch_num}.json"
        json.dump(chunk, open(fp, "w", encoding="utf-8"), ensure_ascii=False)
    
    print(f"Сохранено {len(deals_list)} сделок в {outdir}/")

    # Также сохраняем в CLOSE pages (чтобы merge собрал всё)
    outdir_close = config.PAGES_CLOSE
    os.makedirs(outdir_close, exist_ok=True)
    for i in range(0, len(deals_list), batch_size):
        chunk = deals_list[i:i + batch_size]
        batch_num = i // batch_size
        fp = f"{outdir_close}/p_export_{batch_num}.json"
        json.dump(chunk, open(fp, "w", encoding="utf-8"), ensure_ascii=False)

    print("Готово. Теперь запустите:")
    print("  python merge.py")
    print("  python analyze.py")
    print("  python build_html.py")

if __name__ == "__main__":
    main()
