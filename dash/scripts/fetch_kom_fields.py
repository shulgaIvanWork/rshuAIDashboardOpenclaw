#!/usr/bin/env python3
"""
Дозагрузка полей КОМ через REST API Bitrix24.

Export API не возвращает поля, нужные для определения КОМ:
  - UF_CRM_1683882427069 — галочка КОМ
  - UF_CRM_1765896709800 — тип обучения (КОМ)
  - UF_FORMAT — формат обучения
  - UF_CRM_1498466811 — направление

Дозагружаем их через batch-запросы crm.deal.get (до 50 за раз).
"""

import json
import os
import sys
import time
import requests

WEBHOOK_URL = 'https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/'
CACHE_DIR = os.path.join(os.path.dirname(__file__), '..', 'cache')

# Поля для дозагрузки
KOM_FIELDS = [
    'UF_CRM_1683882427069',   # галочка КОМ
    'UF_CRM_1765896709800',   # тип обучения (КОМ)
    'UF_FORMAT',              # формат обучения
    'UF_CRM_1498466811',      # направление
]

def has_any_kom_field(deal):
    """Есть ли хоть одно КОМ-поле у сделки."""
    for f in KOM_FIELDS:
        val = deal.get(f)
        if val is not None and val != '' and val != []:
            return True
    return False


def batch_get_deals(ids, batch_size=50):
    """Получить КОМ-поля для списка ID сделок через batch."""
    results = {}
    for i in range(0, len(ids), batch_size):
        batch_ids = ids[i:i + batch_size]
        cmd = {}
        for j, deal_id in enumerate(batch_ids):
            cmd[f'deal_{j}'] = f'crm.deal.get?id={deal_id}'

        try:
            r = requests.post(f'{WEBHOOK_URL}batch', json={
                'cmd': cmd,
                'halt': 0
            }, timeout=60)
            data = r.json()

            if 'result' in data and 'result' in data['result']:
                for j, deal_id in enumerate(batch_ids):
                    key = f'deal_{j}'
                    if key in data['result']['result']:
                        deal_data = data['result']['result'][key]
                        if deal_data:
                            extracted = {}
                            for f in KOM_FIELDS:
                                val = deal_data.get(f)
                                if val is not None and val != '' and val != []:
                                    extracted[f] = val
                            if extracted:
                                results[str(deal_id)] = extracted

            done = min(i + batch_size, len(ids))
            print(f'  [{done}/{len(ids)}] найдено с КОМ-полями: {len(results)}', flush=True)

        except Exception as e:
            print(f'  Ошибка на batch {i}: {e}', flush=True)

        time.sleep(0.5)  # не дёргаем API

    return results


def main():
    print('🔍 Дозагрузка КОМ-полей через REST API')
    print(f'  Вебхук: {WEBHOOK_URL}')

    deals_path = os.path.join(CACHE_DIR, 'deals_NEW.json')
    if not os.path.exists(deals_path):
        print('❌ deals_NEW.json не найден')
        return 1

    deals = json.load(open(deals_path, 'r', encoding='utf-8'))
    print(f'  Всего сделок: {len(deals)}')

    # Догружаем только сделки, важные для расчётов:
    # - с UF_DATE_PAY_1C (оплаченные — нужно разделить ООМ/КОМ)
    # - категория 19 (КОМ Sale)
    relevant = [d for d in deals if d.get('UF_DATE_PAY_1C') or str(d.get('CATEGORY_ID', '')) == '19']
    print(f'  Важных для КОМ-определения: {len(relevant)}')

    existing = [d for d in relevant if has_any_kom_field(d)]
    missing = [d for d in relevant if not has_any_kom_field(d)]
    print(f'  Уже с КОМ-полями: {len(existing)}')
    print(f'  Без КОМ-полей:    {len(missing)}')

    if not missing:
        print('✅ Все сделки уже имеют КОМ-поля')
        return 0

    # Берём ID сделок без КОМ-полей
    ids = [d['ID'] for d in missing]
    print(f'\n🚀 Запрашиваем КОМ-поля для {len(ids)} сделок...')

    kom_data = batch_get_deals(ids)

    if not kom_data:
        print('❌ Не удалось получить ни одного КОМ-поля')
        return 1

    print(f'\n✅ Получено КОМ-данных: {len(kom_data)}')

    # Обновляем deals_NEW.json
    updated = 0
    for deal in deals:
        deal_id = str(deal['ID'])
        if deal_id in kom_data:
            for f, val in kom_data[deal_id].items():
                deal[f] = val
            updated += 1

    json.dump(deals, open(deals_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'  Обновлено сделок: {updated}')

    # Статистика
    final_existing = [d for d in deals if has_any_kom_field(d)]
    print(f'\n📊 Итог: {len(final_existing)} сделок с КОМ-полями')

    return 0


if __name__ == '__main__':
    sys.exit(main())
