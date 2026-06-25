"""
fetch_export.py — Дополнительная выгрузка через CRM Export API.

Второй проход после fetch_rest.py.
Загружает сделки кат. 0, 8, 19 через Export API,
мержит с deals_rest.json (REST данные приоритетнее — поля точнее).

Для ID в REST — поля из REST (STAGE_SEMANTIC_ID, UF_* — верные).
Для ID только в Export — поля из Export (старые сделки без семантики).

Сохраняет: cache/deals_NEW.json — финальный массив для analyze_new.py
"""

import urllib.request
import json
import os
import sys
import time
import shutil

sys.path.insert(0, os.path.dirname(__file__))
import config

EXPORT_URL = 'https://24.uprav.ru/web_services/crm/export.php'
SECRET     = '14b0fc053c141e47a5974b3859f5753f'

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
    """Загрузить все сделки кат. 0, 8, 19 через Export API."""
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
                print(f'  [CAT {cat_id}] offset={offset} API failed')
                break

            items = resp.get('data', {}).get('items', [])
            if not items:
                break

            prev_total = len(all_deals)
            for d in items:
                all_deals[d['ID']] = d

            cur_total = len(all_deals)
            if cur_total == prev_total:
                break

            offset += LIMIT
            time.sleep(0.2)

        print(f'  [CAT {cat_id}] всего: {len([d for d in all_deals.values() if str(d.get("CATEGORY_ID",""))==str(cat_id)])}')

    return list(all_deals.values())


def main():
    print(f'{"=" * 60}')
    print('ДОПОЛНИТЕЛЬНАЯ ВЫГРУЗКА через CRM Export API')
    print(f'{"=" * 60}')

    # 1. Загружаем Export
    export_deals = fetch_export_all()
    print(f'\nЗагружено из Export API: {len(export_deals)}')

    # 2. Фильтруем 2025-2026 (Export отдаёт DD.MM.YYYY, REST — ISO)
    def extract_year(dc_str):
        if not dc_str or len(dc_str) < 4:
            return ''
        # Export: DD.MM.YYYY → год на позициях 6-9
        if dc_str[2] == '.':
            return dc_str[6:10]
        # REST: YYYY-MM-DD
        return dc_str[:4]

    export_filtered = {d['ID']: d for d in export_deals
                       if extract_year(d.get('DATE_CREATE', '')) in ('2025', str(config.YEAR))}
    print(f'Из них {config.YEAR - 1}-{config.YEAR}: {len(export_filtered)}')

    # 3. Загружаем REST данные (если есть)
    rest_path = os.path.join(config.CACHE_DIR, 'deals_rest.json')
    rest_deals = {}
    if os.path.exists(rest_path):
        rest_deals = {d['ID']: d for d in json.load(open(rest_path, encoding='utf-8'))}
        print(f'Загружено из REST API: {len(rest_deals)}')

    # 4. Мерж: приоритет REST для полей
    merged = {}
    # Сначала Export
    for did, d in export_filtered.items():
        merged[did] = dict(d)
    # Потом REST — перезаписывает Export для тех же ID
    for did, d in rest_deals.items():
        merged[did] = dict(d)

    # 5. Добавляем сделки только из REST (которых нет в Export)
    rest_only = [did for did in rest_deals if did not in export_filtered]
    if rest_only:
        print(f'  Добавлено из REST (нет в Export): {len(rest_only)}')
        # уже добавлены циклом выше

    print(f'\nПосле мержа: {len(merged)}')

    # 6. Сохраняем как deals_NEW.json
    merged_list = list(merged.values())
    new_path = os.path.join(config.CACHE_DIR, 'deals_NEW.json')
    json.dump(merged_list, open(new_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'✅ Сохранено: {new_path} ({os.path.getsize(new_path) / 1024 / 1024:.1f} MB)')

    # Статистика по семантике в финальном файле
    sem_stats = {}
    for d in merged_list:
        sem = d.get('STAGE_SEMANTIC_ID') or 'None'
        sem_stats[sem] = sem_stats.get(sem, 0) + 1
    print(f'  STAGE_SEMANTIC_ID: {sem_stats}')
    pay_count = sum(1 for d in merged_list if d.get('UF_DATE_PAY_1C'))
    print(f'  С UF_DATE_PAY_1C: {pay_count}')


if __name__ == '__main__':
    main()
