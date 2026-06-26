"""
fetch_refresh.py — Выгрузка сделок через Bitrix24 REST API (crm.deal.list).

Загружает сделки категорий 0, 8, 19 за 2025-2026 через вебхук.
Сохраняет deals_NEW.json + deals_2026.json (для совместимости).

Преимущества перед Export API:
- ✅ Возвращает UF_* поля (UF_DATE_PAY_1C и др.)
- ✅ Возвращает STAGE_SEMANTIC_ID
- ✅ Работает через batch до 50 команд за запрос
"""
import urllib.request, urllib.parse, json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import config

BASE = config.BASE
CATEGORIES = [0, 8, 19]
LIMIT = 50
YEAR = 2026

# Поля, которые нужны для анализа
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

def call(method, params=None):
    """Одиночный вызов REST API."""
    body = urllib.parse.urlencode(params or {}, doseq=True).encode()
    req = urllib.request.Request(BASE + method + ".json", data=body, method="POST")
    req.timeout = 90
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())

def call_batch(commands):
    """Пакетный вызов (до 50 команд)."""
    params = {'halt': 0}
    for i, cmd in enumerate(commands):
        params[f'cmd[{i}]'] = cmd
    r = call('batch', params)
    return r.get("result", {}).get("result", [])


def fetch_category(cat_id):
    """Загружает все сделки категории cat_id за YEAR через batch API."""
    print(f"\n--- Категория {cat_id} ---")
    all_deals = {}
    start = 0
    stale = 0

    while True:
        # Формируем команды batch (до 50 страниц по LIMIT сделок)
        cmds = []
        offsets = []
        for i in range(LIMIT):
            offset = start + i * LIMIT
            filters = [
                f'filter[CATEGORY_ID]={cat_id}',
                f'filter[>OPPORTUNITY]=0',
                f'filter[>=DATE_CREATE]={YEAR - 1}-01-01',
                f'filter[<DATE_CREATE]={YEAR + 1}-01-01',
                f'start={offset}',
            ]
            sel = '&'.join(f'select[{j}]={f}' for j, f in enumerate(SELECT))
            cmd = f'crm.deal.list?{"&".join(filters)}&{sel}'
            cmds.append(cmd)
            offsets.append(offset)

        try:
            results = call_batch(cmds)
        except Exception as e:
            print(f"  error at start={start}: {e}")
            break

        any_new = False
        total_pages = 0
        for idx, res in enumerate(results):
            items = res if isinstance(res, list) else res.get("result", []) if isinstance(res, dict) else []
            if not items:
                continue
            total_pages += 1
            before = len(all_deals)
            for d in items:
                all_deals[d["ID"]] = d
            if len(all_deals) > before:
                any_new = True

        print(f"  start={start}: {total_pages} pages with data, total={len(all_deals)}")

        if not any_new:
            stale += 1
            if stale >= 2:
                print(f"  2 пустых batch подряд — стоп")
                break
        else:
            stale = 0

        start += LIMIT * LIMIT  # 50 страниц × 50 сделок = 2500 за batch
        time.sleep(0.3)

    print(f"  ✅ {len(all_deals)} сделок")
    return list(all_deals.values())


if __name__ == "__main__":
    print("=" * 60)
    print("ВЫГРУЗКА СДЕЛОК через REST API (crm.deal.list)")
    print("=" * 60)

    all_deals = []
    for cat_id in CATEGORIES:
        deals = fetch_category(cat_id)
        print(f"  Категория {cat_id}: {len(deals)} сделок")
        all_deals.extend(deals)

    print(f"\n{'='*60}")
    print(f"Всего сделок: {len(all_deals)}")

    # Сортировка по ID
    all_deals.sort(key=lambda d: int(d["ID"]))

    # Сохраняем как deals_NEW.json (основной файл для аналитики)
    new_path = os.path.join(config.CACHE_DIR, 'deals_NEW.json')
    json.dump(all_deals, open(new_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f"✅ deals_NEW.json — {len(all_deals)} сделок ({os.path.getsize(new_path)/1024/1024:.1f} MB)")

    # Копия как deals_2026.json (для совместимости с другими скриптами)
    deals_path = os.path.join(config.CACHE_DIR, 'deals_2026.json')
    json.dump(all_deals, open(deals_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f"✅ deals_2026.json — сохранён")
