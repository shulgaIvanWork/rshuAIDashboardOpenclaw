#!/usr/bin/env python3
"""
Дозагрузка UF_DATE_PAY_1C через REST API Bitrix24.

Проблема: Export API (export.php) не возвращает UF_DATE_PAY_1C,
хотя это поле есть в CRM. Дозагружаем его через старый REST API.

Использует batch-запросы crm.deal.get (до 50 сделок за раз).
"""

import json
import os
import sys
import time
import requests

WEBHOOK_URL = 'https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/'
CACHE_DIR = os.path.join(os.path.dirname(__file__), '..', 'cache')


def batch_get_deals(ids, batch_size=50):
    """Получить UF_DATE_PAY_1C для списка ID сделок через batch."""
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
                            pay_date = deal_data.get('UF_DATE_PAY_1C')
                            if pay_date:
                                results[str(deal_id)] = pay_date

            # Прогресс
            done = min(i + batch_size, len(ids))
            print(f' → [{done}/{len(ids)}] найдено с UF_DATE_PAY_1C: {len(results)}', flush=True)

        except Exception as e:
            print(f' ❌ Ошибка на batch {i}: {e}', flush=True)

        time.sleep(0.5)  # не дёргаем API

    return results


def main():
    print('📅 Дозагрузка UF_DATE_PAY_1C через REST API')
    print(f' 🔗 Вебхук: {WEBHOOK_URL}')

    # Читаем сделки из deals_NEW.json
    deals_path = os.path.join(CACHE_DIR, 'deals_NEW.json')
    if not os.path.exists(deals_path):
        print('❌ deals_NEW.json не найден')
        return 1

    deals = json.load(open(deals_path, 'r', encoding='utf-8'))
    print(f' 📦 Всего сделок: {len(deals)}')

    # Смотрим у кого уже есть UF_DATE_PAY_1C
    existing = [d for d in deals if d.get('UF_DATE_PAY_1C')]
    missing = [d for d in deals if not d.get('UF_DATE_PAY_1C')]
    print(f' ✅ Уже с UF_DATE_PAY_1C: {len(existing)}')
    print(f' ⏳ Без UF_DATE_PAY_1C: {len(missing)}')

    if not missing:
        print('✅ Все сделки уже имеют UF_DATE_PAY_1C')
        return 0

    # Берём ID сделок без UF_DATE_PAY_1C
    ids = [d['ID'] for d in missing]
    print(f'\n🚀 Запрашиваем UF_DATE_PAY_1C для {len(ids)} сделок...')

    pay_dates = batch_get_deals(ids)

    if not pay_dates:
        print('❌ Не удалось получить ни одной даты оплаты')
        return 1

    print(f'\n✅ Получено UF_DATE_PAY_1C: {len(pay_dates)}')

    # Обновляем deals_NEW.json
    updated = 0
    for deal in deals:
        deal_id = str(deal['ID'])
        if deal_id in pay_dates:
            deal['UF_DATE_PAY_1C'] = pay_dates[deal_id]
            updated += 1

    # Сохраняем
    json.dump(deals, open(deals_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f' ✅ Обновлено сделок: {updated}')

    # Статистика
    final_existing = [d for d in deals if d.get('UF_DATE_PAY_1C')]
    print(f'\n📊 Итог: {len(final_existing)} сделок с UF_DATE_PAY_1C')

    return 0


if __name__ == '__main__':
    sys.exit(main())
