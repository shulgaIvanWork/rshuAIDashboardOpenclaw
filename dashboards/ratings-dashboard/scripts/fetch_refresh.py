"""
fetch_refresh.py — Выгрузка сделок через Bitrix24 REST API (crm.deal.list).

Загружает сделки категорий 0, 8, 19 за 2025-2026 через вебхук.
Использует пагинацию через next (без batch — batch не гарантирует
корректную пагинацию для crm.deal.list).
Сохраняет deals_NEW.json + deals_2026.json (для совместимости).
"""
import urllib.request, urllib.parse, json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import config

BASE = config.BASE
CATEGORIES = [0, 8, 19]
LIMIT = 50

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

def call(method, params):
    """Одиночный вызов REST API."""
    body = urllib.parse.urlencode(params, doseq=True).encode()
    req = urllib.request.Request(BASE + method + ".json", data=body, method="POST")
    req.timeout = 90
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def fetch_category(cat_id):
    """Загружает все сделки категории cat_id последовательно через next."""
    print(f"\n--- Категория {cat_id} ---")
    all_deals = {}
    start = 0
    page = 0

    while True:
        params = {
            'filter[CATEGORY_ID]': cat_id,
            'filter[>OPPORTUNITY]': 0,
            'filter[>=DATE_CREATE]': '2025-01-01',
        }
        for j, field in enumerate(SELECT):
            params[f'select[{j}]'] = field
        if start:
            params['start'] = start

        try:
            resp = call('crm.deal.list', params)
        except Exception as e:
            print(f"  error at start={start}: {e}")
            break

        items = resp.get("result", [])
        if not items:
            print(f"  page {page}: empty — done")
            break

        for d in items:
            all_deals[d["ID"]] = d

        page += 1
        if page % 20 == 0:
            print(f"  page {page}: +{len(items)} => total={len(all_deals)}")

        next_start = resp.get("next")
        if next_start:
            start = next_start
        else:
            break

        time.sleep(0.15)

    print(f"  ✅ Категория {cat_id}: {len(all_deals)} сделок ({page} страниц)")
    return list(all_deals.values())


if __name__ == "__main__":
    print("=" * 60)
    print("ВЫГРУЗКА СДЕЛОК через REST API (crm.deal.list)")
    print("=" * 60)

    all_deals = []
    for cat_id in CATEGORIES:
        deals = fetch_category(cat_id)
        print(f"  Итого категория {cat_id}: {len(deals)} сделок")
        all_deals.extend(deals)

    print(f"\n{'='*60}")
    print(f"Всего сделок: {len(all_deals)}")

    # Сортировка по ID
    all_deals.sort(key=lambda d: int(d["ID"]))

    # Сохраняем как deals_NEW.json (основной файл для аналитики)
    new_path = os.path.join(config.CACHE_DIR, 'deals_NEW.json')
    json.dump(all_deals, open(new_path, 'w', encoding='utf-8'), ensure_ascii=False)
    size_mb = os.path.getsize(new_path) / 1024 / 1024
    print(f"✅ deals_NEW.json — {len(all_deals)} сделок ({size_mb:.1f} MB)")

    # Копия как deals_2026.json (для совместимости)
    deals_path = os.path.join(config.CACHE_DIR, 'deals_2026.json')
    json.dump(all_deals, open(deals_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f"✅ deals_2026.json — сохранён")
