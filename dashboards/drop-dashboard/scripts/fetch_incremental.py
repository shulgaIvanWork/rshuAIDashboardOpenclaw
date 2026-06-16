"""
fetch_incremental.py — догрузка свежих сделок за последние N дней
через CRM Export API + мерж с существующим deals_NEW.json + анализ.

Используется для быстрого обновления данных без полной перезагрузки.
"""
import urllib.request, urllib.parse, json, os, sys, time, shutil
from datetime import datetime, timedelta, date
sys.path.insert(0, os.path.dirname(__file__))
import config

EXPORT_URL = "https://24.uprav.ru/web_services/crm/export.php"
SECRET     = "14b0fc053c141e47a5974b3859f5753f"
CATEGORIES = [0, 8, 19]
LIMIT       = 50        # макс. 50 по API
MAX_OFFSET  = 5000      # ограничение API
DAYS_BACK   = 21        # последние 3 недели — надёжно

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

def fetch_days_range(cat_id, since_str, until_str):
    """Загружаем сделки категории за диапазон дат."""
    all_deals = {}
    offset = 0
    while offset <= MAX_OFFSET:
        params = [
            ('secret', SECRET),
            ('action', 'getDeals'),
            ('data[FILTER][CATEGORY_ID]', str(cat_id)),
            ('data[FILTER][>=DATE_CREATE]', since_str),
            ('data[FILTER][<DATE_CREATE]', until_str),
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
            print(f"  [CAT {cat_id}] offset={offset} API failed: {resp.get('error','')}")
            break

        items = resp.get("data", {}).get("items", [])
        if not items:
            print(f"  [CAT {cat_id}] offset={offset} empty — done")
            break

        for d in items:
            all_deals[d["ID"]] = d

        print(f"  [CAT {cat_id}] offset={offset}: {len(items)} items, total={len(all_deals)}")
        offset += LIMIT
        time.sleep(0.2)

    return all_deals


def main():
    print("=" * 60)
    print("ИНКРЕМЕНТАЛЬНАЯ ДОГРУЗКА через CRM Export API")
    print("=" * 60)

    # Диапазон: последние DAYS_BACK дней
    until_dt = date.today()
    since_dt = until_dt - timedelta(days=DAYS_BACK)
    # Формат для API — YYYY-MM-DD HH:MM:SS
    since_str = since_dt.strftime("%d.%m.%Y 00:00:00")
    until_str = until_dt.strftime("%d.%m.%Y 23:59:59")
    print(f"\nДиапазон: {since_str} — {until_str} ({DAYS_BACK} дней)")

    # Загружаем свежие данные
    fresh = {}
    for cat_id in CATEGORIES:
        print(f"\n--- Категория {cat_id} ---")
        deals = fetch_days_range(cat_id, since_str, until_str)
        print(f"  ✅ {len(deals)} сделок")
        fresh.update(deals)

    print(f"\n{'='*60}")
    print(f"Свежих сделок (всего): {len(fresh)}")

    # Загружаем существующий deals_NEW.json
    new_path = os.path.join(config.CACHE_DIR, 'deals_NEW.json')
    if os.path.exists(new_path):
        existing = json.load(open(new_path, encoding='utf-8'))
        print(f"Существующий deals_NEW.json: {len(existing)} сделок")
    else:
        existing = []
        print("deals_NEW.json не найден, начинаем с пустого")

    existing_map = {d["ID"]: d for d in existing}
    print(f"Уникальных ID в существующем: {len(existing_map)}")

    # Мерж: существующие + новые
    existing_map.update(fresh)
    merged = list(existing_map.values())
    print(f"После слияния: {len(merged)}")

    # Фильтр 2025-2026
    def extract_year(dc_str):
        if not dc_str or len(dc_str) < 4: return ''
        return dc_str[6:10] if dc_str[2] == '.' else dc_str[:4]

    merged = [d for d in merged
              if extract_year(d.get('DATE_CREATE','')) in ('2025', '2026')
              or extract_year(d.get('CLOSEDATE','')) in ('2025', '2026')]
    print(f"Из них 2025-2026: {len(merged)}")

    # Сохраняем как deals_NEW.json
    json.dump(merged, open(new_path, 'w', encoding='utf-8'), ensure_ascii=False)
    size_mb = os.path.getsize(new_path) / 1024 / 1024
    print(f"\n✅ Сохранён deals_NEW.json ({size_mb:.1f} MB, {len(merged)} сделок)")

    # Сохраняем как deals_2026.json (для совместимости со старыми скриптами)
    old_path = os.path.join(config.CACHE_DIR, 'deals_2026.json')
    shutil.copy2(new_path, old_path)
    print(f"✅ Скопировано в deals_2026.json")

    # Запускаем анализ
    print("\n" + "=" * 60)
    print("ЗАПУСК analyze_new.py")
    print("=" * 60)
    analyze_script = os.path.join(os.path.dirname(__file__), 'analyze_new.py')
    import subprocess
    result = subprocess.run([sys.executable, analyze_script], cwd=os.path.dirname(__file__))
    if result.returncode == 0:
        print(f"\n✅ Анализ выполнен успешно!")
    else:
        print(f"\n❌ Анализ завершился с ошибкой (код {result.returncode})")
        sys.exit(result.returncode)

    # Что дальше
    print("\n" + "=" * 60)
    print("ГОТОВО! Данные загружены и проанализированы.")
    print("Обновите страницу дашборда.")
    print("=" * 60)


if __name__ == "__main__":
    main()
