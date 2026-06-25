"""
fetch_modules.py — загрузка продуктовых строк (модулей) для релевантных сделок.

Для каждой сделки категории 0 (ООМ/ОМ) из кэша deals_2026.json:
  - Стадии: WON (+ PROPOSAL, Постоплата, Частично оплачен)
  - Даты пересекаются с 2026 годом (или начинаются не ранее 2025)
Получает через REST API:
  1. crm.deal.productrows.get — продуктовые строки (модули)
  2. crm.product.get — PROPERTY_207 (дата начала модуля), PROPERTY_208 (дата окончания)
Сохраняет в cache/modules.json.

Формат modules.json:
  {
    "<deal_id>": [
      {
        "product_id": 12345,
        "product_name": "Название модуля",
        "date_start": "2026-02-02",
        "date_end": "2026-02-05"
      },
      ...
    ]
  }
"""

import json, sys, os, time
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'cache'))
DEALS_FILE = os.path.join(CACHE_DIR, 'deals_2026.json')
MODULES_FILE = os.path.join(CACHE_DIR, 'modules.json')

WEBHOOK = "https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/"
BATCH_SIZE = 50  # batch API limit

# Стадии, которые нас интересуют (категория 0)
TARGET_STAGES = {'WON', 'PROPOSAL', '2', '6', 'C0:WON', 'C0:PROPOSAL', 'C0:2', 'C0:6'}


def parse_dt(s):
    """Парсит дату из формата 2026-02-02T03:00:00+03:00"""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('+03:00', '+03:00').replace('+00:00', '+00:00'))
    except:
        return None


def parse_dt_product(val):
    """Парсит дату из PROPERTY_207/208 — 2026-02-02T03:00:00+03:00"""
    if not val:
        return None
    if isinstance(val, dict):
        val = val.get('value', val.get('VALUE', ''))
    if not val:
        return None
    return parse_dt(str(val))


def filter_deals(deals):
    """Оставляет только релевантные сделки (категория 0, нужные стадии, 2025+)."""
    relevant = [
        x for x in deals
        if x.get('CATEGORY_ID') in ('0', 0) and x.get('STAGE_ID') in TARGET_STAGES
    ]
    print(f"  Всего подходящих по категории/стадии: {len(relevant)}")

    # Фильтр по году: пересекаются с 2026 или начинаются не ранее 2025
    filtered = []
    for x in relevant:
        start = parse_dt(x.get('UF_CRM_DATE_START_LEARN'))
        end = parse_dt(x.get('UF_CRM_DATE_END_LEARN'))

        if not start and not end:
            continue  # нет дат — пропускаем

        # Не раньше 2025 (могут начинаться в 2025, но не ранее)
        if start and start.year < 2025:
            continue

        # Если заканчивается до 2026 — пропускаем
        if end and end.year < 2026:
            continue

        # Если нет END_LEARN, но START_LEARN есть и он >= 2025 — ок, проверим по модулям
        filtered.append(x)

    print(f"  После фильтра по году: {len(filtered)}")
    return filtered


def batch_productrows(deal_ids):
    """Получает продуктовые строки для списка ID сделок через batch API (legacy-формат)."""
    if not deal_ids:
        return {}

    import requests

    all_rows = {}  # deal_id → [row, ...]

    for i in range(0, len(deal_ids), BATCH_SIZE):
        batch = deal_ids[i:i + BATCH_SIZE]
        data = {}
        for j, did in enumerate(batch):
            data[f"cmd[p{j}]"] = f"crm.deal.productrows.get?ID={int(did)}"

        resp = requests.post(f"{WEBHOOK}batch", data=data, timeout=60)
        result = resp.json()

        # Legacy-формат: result.result — dict {p0: [...], p1: [...]}
        result_dict = result.get("result", {}).get("result", {})
        if not isinstance(result_dict, dict):
            result_dict = {}

        for j, did in enumerate(batch):
            rows = result_dict.get(f"p{j}", [])
            if isinstance(rows, list) and len(rows) > 0:
                all_rows[did] = rows

        if (i + 1) % 500 == 0 or i + BATCH_SIZE >= len(deal_ids):
            print(f"  productrows: {min(i + BATCH_SIZE, len(deal_ids))}/{len(deal_ids)} — получено {len(all_rows)} сделок с продуктами")

    print(f"  Всего сделок с продуктовыми строками: {len(all_rows)}/{len(deal_ids)}")
    return all_rows


def batch_product_info(product_ids):
    """Получает PROPERTY_207/208 для списка продуктов через batch API (legacy-формат)."""
    if not product_ids:
        return {}

    import requests

    products = {}  # product_id → {date_start, date_end}

    for i in range(0, len(product_ids), BATCH_SIZE):
        batch = product_ids[i:i + BATCH_SIZE]
        data = {}
        for j, pid in enumerate(batch):
            data[f"cmd[c{j}]"] = f"crm.product.get?ID={int(pid)}&select[]=ID&select[]=NAME&select[]=PROPERTY_207&select[]=PROPERTY_208"

        resp = requests.post(f"{WEBHOOK}batch", data=data, timeout=60)
        result = resp.json()

        # Legacy-формат: result.result — dict {c0: {...}, c1: {...}}
        result_dict = result.get("result", {}).get("result", {})
        if not isinstance(result_dict, dict):
            result_dict = {}

        for j, pid in enumerate(batch):
            prod = result_dict.get(f"c{j}", {})
            if not prod or not isinstance(prod, dict):
                continue
            if prod.get("error"):
                continue

            # Получаем даты
            p207 = prod.get("PROPERTY_207") or prod.get("property_207")
            p208 = prod.get("PROPERTY_208") or prod.get("property_208")

            date_start = None
            date_end = None

            if isinstance(p207, dict):
                p207 = p207.get("value", p207.get("VALUE"))
            if p207:
                dt = parse_dt_product(p207)
                if dt:
                    date_start = dt.strftime("%Y-%m-%d")

            if isinstance(p208, dict):
                p208 = p208.get("value", p208.get("VALUE"))
            if p208:
                dt = parse_dt_product(p208)
                if dt:
                    date_end = dt.strftime("%Y-%m-%d")

            products[str(pid)] = {
                "name": prod.get("NAME", ""),
                "date_start": date_start,
                "date_end": date_end
            }

        if (i + 1) % 500 == 0 or i + BATCH_SIZE >= len(product_ids):
            print(f"  products: {min(i + BATCH_SIZE, len(product_ids))}/{len(product_ids)}")

    return products


def build_modules(deals_filtered, product_rows, product_info):
    """Собирает modules.json."""
    modules = {}
    for d in deals_filtered:
        did = d["ID"]
        rows = product_rows.get(did, [])
        if not rows:
            continue

        deal_modules = []
        for r in rows:
            pid = str(r.get("PRODUCT_ID", ""))
            info = product_info.get(pid, {})
            date_start = info.get("date_start")
            date_end = info.get("date_end")

            # Если дат у продукта нет — пробуем из названия продуктовой строки
            # (в PRODUCT_NAME уже есть даты "с 02.02.2026 по 05.02.2026")
            if not date_start or not date_end:
                import re
                pname = r.get("PRODUCT_NAME", "")
                m = re.search(r'с\s+(\d{2}\.\d{2}\.\d{4})\s*по\s+(\d{2}\.\d{2}\.\d{4})', pname)
                if m:
                    try:
                        ds = datetime.strptime(m.group(1), "%d.%m.%Y")
                        de = datetime.strptime(m.group(2), "%d.%m.%Y")
                        date_start = date_start or ds.strftime("%Y-%m-%d")
                        date_end = date_end or de.strftime("%Y-%m-%d")
                    except:
                        pass

            if date_start or date_end:
                deal_modules.append({
                    "product_id": pid,
                    "product_name": r.get("PRODUCT_NAME", info.get("name", "")),
                    "original_name": r.get("ORIGINAL_PRODUCT_NAME", ""),
                    "date_start": date_start,
                    "date_end": date_end
                })
            else:
                # Всё равно добавим, но без дат (пометим)
                deal_modules.append({
                    "product_id": pid,
                    "product_name": r.get("PRODUCT_NAME", info.get("name", "")),
                    "original_name": r.get("ORIGINAL_PRODUCT_NAME", ""),
                    "date_start": None,
                    "date_end": None
                })

        if deal_modules:
            modules[did] = deal_modules

    return modules


def main():
    t0 = time.time()
    print("=" * 60)
    print("fetch_modules.py — загрузка модулей сделок")
    print("=" * 60)

    # 1. Загружаем сделки из кэша
    print("\n📥 Загрузка сделок из кэша...")
    if not os.path.exists(DEALS_FILE):
        print("❌ Нет файла deals_2026.json. Запустите сначала выгрузку сделок.")
        sys.exit(1)

    with open(DEALS_FILE, 'r', encoding='utf-8') as f:
        deals = json.load(f)
    print(f"  Загружено сделок: {len(deals)}")

    # 2. Фильтруем
    print("\n🔍 Фильтрация сделок...")
    filtered = filter_deals(deals)
    if not filtered:
        print("❌ Нет подходящих сделок.")
        sys.exit(0)

    deal_ids = [x["ID"] for x in filtered]
    print(f"  ID сделок для обработки: {len(deal_ids)}")

    # 3. Получаем продуктовые строки
    print("\n📦 Загрузка продуктовых строк...")
    product_rows = batch_productrows(deal_ids)

    # 4. Собираем уникальные PRODUCT_ID
    all_product_ids = set()
    for did, rows in product_rows.items():
        for r in rows:
            pid = r.get("PRODUCT_ID")
            if pid:
                all_product_ids.add(str(pid))
    print(f"\n📋 Уникальных продуктов: {len(all_product_ids)}")

    # 5. Получаем данные продуктов
    if all_product_ids:
        print("\n📋 Загрузка данных продуктов...")
        product_info = batch_product_info(list(all_product_ids))
    else:
        product_info = {}

    # 6. Собираем финальные данные
    print("\n🔗 Сборка modules.json...")
    modules = build_modules(filtered, product_rows, product_info)

    # 7. Сохраняем
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(MODULES_FILE, 'w', encoding='utf-8') as f:
        json.dump(modules, f, ensure_ascii=False, indent=2)
    print(f"\n✅ Сохранено: {MODULES_FILE}")
    print(f"   Сделок с модулями: {len(modules)}")
    total_mods = sum(len(v) for v in modules.values())
    print(f"   Всего модулей: {total_mods}")
    elapsed = time.time() - t0
    print(f"   Время: {elapsed:.1f}с")


if __name__ == "__main__":
    main()
