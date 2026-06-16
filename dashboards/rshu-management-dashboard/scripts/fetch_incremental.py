"""
fetch_incremental.py — Инкрементальная догрузка сделок.

Загружает сделки за указанные месяцы через CRM Export API,
мержит с существующими deals_NEW.json,
перезапускает анализ.

Запуск: python fetch_incremental.py
"""
import urllib.request, urllib.parse, json, os, sys, time
from datetime import datetime, date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
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

def export_request(data):
    body = urllib.parse.urlencode({"secret": SECRET, "action": "getDeals", "data": data}, doseq=True).encode()
    req = urllib.request.Request(EXPORT_URL, data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())

def fetch_month(cat_id, year, month):
    """Выгружает сделки категории за один месяц по DATE_CREATE.
    Пагинация: используем nextOffset из ответа API (макс offset=5000).
    """
    month_str = f"{month:02d}"
    start_date = f"01.{month_str}.{year} 00:00:00"
    if month == 12:
        end_date = f"01.01.{year+1} 00:00:00"
    else:
        end_date = f"01.{month+1:02d}.{year} 00:00:00"

    all_deals = {}
    offset = 0
    limit = 50

    while offset <= 5000:
        data = {
            "FILTER": {
                "CATEGORY_ID": cat_id,
                ">=DATE_CREATE": start_date,
                "<DATE_CREATE": end_date,
                ">OPPORTUNITY": 0,
            },
            "SELECT": SELECT,
            "SORT": {"ID": "ASC"},
            "nav": {"limit": limit, "offset": offset},
        }

        try:
            resp = export_request(data)
        except Exception as e:
            print(f"  ⚠ [CAT {cat_id}][{month_str}.{year}] offset={offset} error: {e}")
            time.sleep(3)
            continue

        if not resp.get("success"):
            print(f"  ⚠ [CAT {cat_id}][{month_str}.{year}] API failed: {resp.get('errors')}")
            break

        items = resp.get("data", {}).get("items", [])
        if not items:
            break

        for d in items:
            all_deals[d["ID"]] = d

        nav = resp.get("data", {}).get("nav", {})
        next_offset = nav.get("nextOffset")

        # Если nextOffset нет, или он не изменился — конец
        if next_offset is None or next_offset <= offset:
            break
        offset = next_offset
        time.sleep(0.25)

    return all_deals

def main():
    today = date.today()
    print("=" * 60)
    print("ИНКРЕМЕНТАЛЬНАЯ ДОГРУЗКА")
    print(f"Дата: {today.isoformat()}")
    print("=" * 60)

    # Загружаем существующий deals_NEW.json
    new_path = os.path.join(config.CACHE_DIR, 'deals_NEW.json')
    existing = json.load(open(new_path, encoding='utf-8'))
    existing_map = {d["ID"]: d for d in existing}
    print(f"\nСуществующих сделок: {len(existing_map)}")

    # Догружаем за последние 3 месяца (запас) — апрель, май, июнь 2026
    # А также текущий месяц целиком
    months_to_fetch = []
    y, m = today.year, today.month
    # Текущий месяц
    months_to_fetch.append((y, m))
    # Предыдущие 2 месяца
    for i in range(1, 4):
        pm = m - i
        py = y
        while pm < 1:
            pm += 12
            py -= 1
        months_to_fetch.append((py, pm))

    fresh = {}
    for cat_id in CATEGORIES:
        print(f"\n--- Категория {cat_id} ---")
        for year, month in sorted(months_to_fetch):
            deals = fetch_month(cat_id, year, month)
            cnt = len(deals)
            if cnt > 0:
                print(f"  [{year}-{month:02d}] {cnt} сделок")
            for k, v in deals.items():
                fresh[k] = v
            time.sleep(0.2)

    print(f"\nСвежих сделок (новые): {len(fresh)}")

    # Мержим
    merged = {**existing_map}
    new_count = 0
    updated_count = 0
    for k, v in fresh.items():
        if k not in merged:
            new_count += 1
        else:
            updated_count += 1
        merged[k] = v

    merged_list = list(merged.values())
    print(f"После слияния: {len(merged_list)} (новых: {new_count}, обновлено: {updated_count})")

    if new_count == 0 and updated_count == 0:
        print("\nНет новых данных. Анализ не требуется.")
        return

    # Сохраняем
    json.dump(merged_list, open(new_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f"\n✅ Сохранено: {new_path} ({len(merged_list)} сделок)")

    # Также сохраняем как deals_2026.json (для совместимости с другими скриптами)
    json.dump(merged_list, open(os.path.join(config.CACHE_DIR, 'deals_2026.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print(f"✅ Сохранено: deals_2026.json")

if __name__ == "__main__":
    main()
