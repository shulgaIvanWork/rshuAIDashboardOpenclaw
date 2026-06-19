"""
fetch_export.py — Дополнительная выгрузка через CRM Export API.

Второй проход после fetch_rest.py.
Загружает сделки кат. 0, 8, 19 через Export API,
добавляет данные из deals_OLD.json (бэкап),
мержит с deals_rest.json (REST данные приоритетнее — поля точнее).

Итого: REST > Export > OLD (приоритет полей)
     = deals_NEW.json — финальный массив для analyze_new.py
"""

import urllib.request, urllib.parse, json, os, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import config

EXPORT_URL = 'https://24.uprav.ru/web_services/crm/export.php'
SECRET     = '***'
CATEGORIES = [0, 8, 19]
LIMIT = 50
MAX_OFFSET = 5000

SELECT = [
    'ID', 'TITLE', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID',
    'OPPORTUNITY', 'CURRENCY_ID', 'DATE_CREATE', 'DATE_MODIFY',
    'CLOSEDATE', 'CLOSED', 'ASSIGNED_BY_ID', 'SOURCE_ID',
    'COMPANY_ID', 'CONTACT_ID',
    'UF_DATE_PAY_1C',
    'UF_FORMAT', 'UF_CRM_1498466811',
    'UF_CRM_1683882427069',
    'UF_CRM_1765896709800',
    'UF_CRM_1753272713011',
    'UF_CRM_DATE_START_LEARN', 'UF_CRM_DATE_END_LEARN',
]


def fetch_page(params):
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(EXPORT_URL, data=body, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def fetch_export_all():
    all_deals = {}
    for cat_id in CATEGORIES:
        offset = 0
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
                print(f'  [CAT {cat_id}] offset={offset} error: {e}')
                break

            if not resp.get('success'):
                break

            items = resp.get('data', {}).get('items', [])
            if not items:
                break

            prev_total = len(all_deals)
            for d in items:
                all_deals[d['ID']] = d

            if len(all_deals) == prev_total:
                break
            offset += LIMIT
            time.sleep(0.2)

        print(f'  [CAT {cat_id}] всего: {len([d for d in all_deals.values() if str(d.get("CATEGORY_ID",""))==str(cat_id)])}')
    return list(all_deals.values())


def extract_year(dc_str):
    """Извлечь год из DD.MM.YYYY или YYYY-MM-DD"""
    if not dc_str or len(dc_str) < 4:
        return ''
    if dc_str[2] == '.':
        return dc_str[6:10]
    return dc_str[:4]


def main():
    print('=' * 60)
    print('ДОПОЛНИТЕЛЬНАЯ ВЫГРУЗКА — Export API + OLD архив')
    print('=' * 60)

    # --- Источник 1: Export API ---
    export_deals = fetch_export_all()
    print(f'\nЗагружено из Export API: {len(export_deals)}')

    export_map = {d['ID']: d for d in export_deals
                  if extract_year(d.get('DATE_CREATE', '')) in ('2025', str(config.YEAR))}
    print(f'  Из них {config.YEAR - 1}-{config.YEAR}: {len(export_map)}')

    # --- Источник 2: OLD архив (бэкап, есть сделки вне лимита offset) ---
    old_path = os.path.join(config.CACHE_DIR, 'deals_OLD.json')
    old_map = {}
    if os.path.exists(old_path):
        old_all = json.load(open(old_path, encoding='utf-8'))
        old_map = {d['ID']: d for d in old_all
                   if extract_year(d.get('DATE_CREATE', '')) in ('2025', str(config.YEAR))}
        print(f'Загружено из OLD архива: {len(old_all)}, из них {config.YEAR - 1}-{config.YEAR}: {len(old_map)}')
    else:
        print('OLD архив не найден')

    # --- Источник 3: REST данные (приоритетные) ---
    rest_path = os.path.join(config.CACHE_DIR, 'deals_rest.json')
    rest_map = {}
    if os.path.exists(rest_path):
        rest_map = {d['ID']: d for d in json.load(open(rest_path, encoding='utf-8'))}
        print(f'Загружено из REST API: {len(rest_map)}')

    # --- Мерж: OLD → Export → REST (последний перезаписывает) ---
    merged = {}
    # 1. OLD (самые старые, наименее точные)
    for did, d in old_map.items():
        merged[did] = dict(d)
    # 2. Export (перезаписывает OLD для тех же ID)
    for did, d in export_map.items():
        merged[did] = dict(d)
    # 3. REST (самые точные поля, перезаписывает всех)
    for did, d in rest_map.items():
        merged[did] = dict(d)

    print(f'\nПосле мержа: {len(merged)}')
    new_from_old = [did for did in merged if did not in rest_map]
    if new_from_old:
        print(f'  Добавлено из OLD/Export (нет в REST): {len(new_from_old)}')

    # --- Сохраняем ---
    merged_list = list(merged.values())
    new_path = os.path.join(config.CACHE_DIR, 'deals_NEW.json')
    json.dump(merged_list, open(new_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'✅ Сохранено: {new_path} ({os.path.getsize(new_path) / 1024 / 1024:.1f} MB)')

    sem_stats = {}
    for d in merged_list:
        sem = d.get('STAGE_SEMANTIC_ID') or 'None'
        sem_stats[sem] = sem_stats.get(sem, 0) + 1
    print(f'  STAGE_SEMANTIC_ID: {sem_stats}')
    pay_count = sum(1 for d in merged_list if d.get('UF_DATE_PAY_1C'))
    print(f'  С UF_DATE_PAY_1C: {pay_count}')


if __name__ == '__main__':
    main()
