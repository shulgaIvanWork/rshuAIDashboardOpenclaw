"""
fetch_rest.py — Выгрузка сделок через REST API crm.deal.list.

Основной источник данных. REST возвращает ВСЕ поля:
STAGE_SEMANTIC_ID, UF_CRM_*, UF_DATE_PAY_1C — без None.
Пагинация через next-токен (без лимита offset=5000).

Фильтр: DATE_CREATE >= 2025-01-01, CATEGORY_ID IN (0, 8, 19)
Сохраняет: cache/deals_rest.json
"""

import json
import sys
import os
import time
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.dirname(__file__))
import config

WEBHOOK = config.BASE

SELECT = [
    'ID', 'TITLE', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID',
    'OPPORTUNITY', 'CURRENCY_ID', 'DATE_CREATE', 'DATE_MODIFY',
    'CLOSEDATE', 'CLOSED', 'ASSIGNED_BY_ID', 'SOURCE_ID',
    'COMPANY_ID', 'CONTACT_ID',
    'UF_DATE_PAY_1C',
    'UF_FORMAT',
    'UF_CRM_1498466811',
    'UF_CRM_1683882427069',
    'UF_CRM_1765896709800',
    'UF_CRM_1753272713011',
    'UF_CRM_DATE_START_LEARN',
    'UF_CRM_DATE_END_LEARN',
]


def rest_call(method, params):
    body = json.dumps(params).encode()
    req = urllib.request.Request(WEBHOOK + method + '.json', data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.timeout = config.TIMEOUT
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def fetch_all(year_start):
    """Выгрузить все сделки через crm.deal.list с next-пагинацией."""
    all_deals = {}
    start = 0
    total_pages = 0

    while True:
        params = {
            'order': {'ID': 'ASC'},
            'filter': {
                '>=DATE_CREATE': year_start,
                '=CATEGORY_ID': [0, 8, 19],
            },
            'select': SELECT,
            'start': start,
        }

        resp = rest_call('crm.deal.list', params)
        items = resp.get('result', [])
        if not items:
            break

        for d in items:
            all_deals[d['ID']] = d

        total_pages += 1
        if total_pages % 10 == 0:
            print(f'  page {total_pages}: {len(all_deals)} deals...')
        if total_pages % 3 == 0 or total_pages == 1:
            print(f'###PROGRESS:{{"type":"deals_loaded","count":{len(all_deals)}}}', flush=True)

        nxt = resp.get('next')
        if nxt is None:
            break
        start = nxt
        time.sleep(0.35)

    return list(all_deals.values())


def main():
    print(f'{"=" * 60}')
    print('ВЫГРУЗКА через REST API crm.deal.list')
    year_start = f'{config.YEAR - 1}-01-01'
    print(f'  Фильтр: >=DATE_CREATE {year_start}, CAT IN (0,8,19)')
    print(f'  Поля ({len(SELECT)}): все, включая UF_*, STAGE_SEMANTIC_ID')
    print(f'{"=" * 60}')

    deals = fetch_all(year_start)
    print(f'\nПолучено сделок: {len(deals)}')

    # Фильтр 2025-2026 (на случай если REST вернул старше)
    def extract_year(dc_str):
        if not dc_str or len(dc_str) < 4:
            return ''
        return dc_str[:4]

    filtered = [d for d in deals
                if extract_year(d.get('DATE_CREATE', '')) in ('2025', str(config.YEAR))]

    print(f'Из них {config.YEAR - 1}-{config.YEAR}: {len(filtered)}')

    # Сохраняем
    path = os.path.join(config.CACHE_DIR, 'deals_rest.json')
    json.dump(filtered, open(path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'\n✅ Сохранено: {path} ({os.path.getsize(path) / 1024 / 1024:.1f} MB)')

    # Статистика
    sem_stats = {}
    for d in filtered:
        sem = d.get('STAGE_SEMANTIC_ID') or 'None'
        sem_stats[sem] = sem_stats.get(sem, 0) + 1
    print(f'  STAGE_SEMANTIC_ID: {sem_stats}')

    pay_count = sum(1 for d in filtered if d.get('UF_DATE_PAY_1C'))
    print(f'  С UF_DATE_PAY_1C: {pay_count}')


if __name__ == '__main__':
    main()
