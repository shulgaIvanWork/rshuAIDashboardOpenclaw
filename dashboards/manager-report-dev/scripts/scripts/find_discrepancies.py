#!/usr/bin/env python3
"""Находит расхождения между 3-м рядом КПЭ (КОМ), форматами и типом обучения."""

import json
from collections import defaultdict

CACHE_DIR = '/root/.openclaw/workspace/projects/dashboards/rshu-management-dashboard/cache'

KOM_UF_FLAG = 'UF_CRM_1683882427069'
KOM_FORMAT_ID = '19042498'
KOM_DIRECTION_ID = '1906'
KOM_CATEGORY = 19
KOM_TRAINING_ID = '34765'

VALID_CATS = {0, 8, 19}
MIN_OPP = 11.0

def is_kom_deal(x):
    if x.get(KOM_UF_FLAG) in ('Y', '1', True):
        return True
    if str(x.get('UF_FORMAT', '')) == KOM_FORMAT_ID:
        return True
    direction = x.get('UF_CRM_1498466811', []) or []
    if KOM_DIRECTION_ID in direction or KOM_DIRECTION_ID in [str(d) for d in direction]:
        return True
    if int(x.get('CATEGORY_ID', 0)) == KOM_CATEGORY:
        return True
    training_type = str(x.get('UF_CRM_1765896709800', ''))
    if training_type == KOM_TRAINING_ID:
        return True
    return False

def has_fmt_kom(x):
    """Есть ли UF_FORMAT = КОМ?"""
    return str(x.get('UF_FORMAT', '')) == KOM_FORMAT_ID

def has_edu_kom(x):
    """Есть ли тип обучения = Корпоративное обучение?"""
    return str(x.get('UF_CRM_1765896709800', '')) == KOM_TRAINING_ID

def has_flag_kom(x):
    """Галочка КОМ"""
    return x.get(KOM_UF_FLAG) in ('Y', '1', True)

def has_direction_kom(x):
    """Направление = Корпоративное обучение"""
    direction = x.get('UF_CRM_1498466811', []) or []
    return KOM_DIRECTION_ID in direction or KOM_DIRECTION_ID in [str(d) for d in direction]

def has_cat19(x):
    """Категория = 19"""
    return int(x.get('CATEGORY_ID', 0)) == KOM_CATEGORY

def fmt_date(v):
    if not v:
        return '—'
    return str(v)[:10]

def main():
    with open(f'{CACHE_DIR}/deals_NEW.json', 'r') as f:
        deals = json.load(f)

    print(f"Всего сделок в deals_NEW.json: {len(deals)}")
    print()

    kom_deals = []
    non_kom = []

    for d in deals:
        opp = float(d.get('OPPORTUNITY') or 0)
        cat = int(d.get('CATEGORY_ID', 0))
        if cat not in VALID_CATS:
            continue
        if opp < MIN_OPP:
            continue

        if is_kom_deal(d):
            kom_deals.append(d)

    print(f"Из них КОМ (по любому из 5 признаков, валидные категории 0|8|19, OPP>={MIN_OPP}): {len(kom_deals)}")
    print()

    # Анализируем расхождения
    print("=" * 140)
    print(f"{'ID':>8} | {'Сумма':>10} | {'Кат':>3} | {'Галочка':>7} | {'Формат=КОМ':>10} | {'Напр=КОМ':>9} | {'Кат=19':>6} | {'Тип=КОМ':>8} | {'UF_FORMAT':>12} | {'UF_CRM...9800':>15} | Название")
    print("=" * 140)

    # Расхождение 1: КОМ, НО UF_FORMAT != 19042498
    # Расхождение 2: КОМ, НО UF_CRM_1765896709800 != 34765
    # Расхождение 3: КОМ без ЕДИНСТВЕННОГО показателя в форматах/типе

    discrepancy_count = 0
    for d in kom_deals:
        has_fmt = has_fmt_kom(d)
        has_edu = has_edu_kom(d)
        has_flag = has_flag_kom(d)
        has_dir = has_direction_kom(d)
        has_cat = has_cat19(d)

        # Сделка считается расходящейся, если у неё нет UF_FORMAT=19042498
        # ИЛИ нет UF_CRM_1765896709800=34765
        # (т.е. она КОМ, но не отображается соответствующе в форматах или типе)
        if not has_fmt or not has_edu:
            discrepancy_count += 1
            uf_format_raw = str(d.get('UF_FORMAT', '') or '—')
            edu_raw = str(d.get('UF_CRM_1765896709800', '') or '—')
            title = (d.get('TITLE', '') or '')[:80]

            flags = []
            if has_flag: flags.append('✔')
            else: flags.append('—')
            if has_fmt: flags.append('✔')
            else: flags.append('—')
            if has_dir: flags.append('✔')
            else: flags.append('—')
            if has_cat: flags.append('✔')
            else: flags.append('—')
            if has_edu: flags.append('✔')
            else: flags.append('—')

            print(f"{d.get('ID','?'):>8} | {opp:>10.0f} | {d.get('CATEGORY_ID','?'):>3} | {flags[0]:>7} | {flags[1]:>10} | {flags[2]:>9} | {flags[3]:>6} | {flags[4]:>8} | {uf_format_raw:>12} | {edu_raw:>15} | {title}")

    print("=" * 140)
    print(f"\nВсего расходящихся КОМ-сделок: {discrepancy_count}")

    # Сводка по типам расхождений
    print()
    print("=" * 80)
    print("СВОДКА ПО ТИПАМ РАСХОЖДЕНИЙ")
    print("=" * 80)

    # КОМ без UF_FORMAT=КОМ
    kom_no_fmt = [d for d in kom_deals if not has_fmt_kom(d)]
    print(f"\n1. КОМ (по любому признаку), НО UF_FORMAT ≠ {KOM_FORMAT_ID} (КОМ): {len(kom_no_fmt)} сделок")
    print(f"   → Они попадут в 3-й ряд КПЭ, НО НЕ попадут в «Корпоративное обучение» в графике форматов")
    if kom_no_fmt:
        print(f"   Сумма: {sum(float(d.get('OPPORTUNITY') or 0) for d in kom_no_fmt):,.0f} ₽")
        # Распределение по UF_FORMAT у этих сделок
        fmt_dist = defaultdict(lambda: {'cnt': 0, 'sum': 0.0})
        for d in kom_no_fmt:
            f = str(d.get('UF_FORMAT', '') or '—')
            fmt_dist[f]['cnt'] += 1
            fmt_dist[f]['sum'] += float(d.get('OPPORTUNITY') or 0)
        print(f"   Распределение по UF_FORMAT:")
        for f, v in sorted(fmt_dist.items(), key=lambda x: -x[1]['sum']):
            print(f"     {f:>12}: {v['cnt']:>4} шт, {v['sum']:>12,.0f} ₽")

    # КОМ без типа обучения
    kom_no_edu = [d for d in kom_deals if not has_edu_kom(d)]
    print(f"\n2. КОМ (по любому признаку), НО UF_CRM_1765896709800 ≠ {KOM_TRAINING_ID}: {len(kom_no_edu)} сделок")
    print(f"   → Они попадут в 3-й ряд КПЭ, НО НЕ попадут в «Корпоративное обучение» в графике типов обучения")
    if kom_no_edu:
        print(f"   Сумма: {sum(float(d.get('OPPORTUNITY') or 0) for d in kom_no_edu):,.0f} ₽")
        edu_dist = defaultdict(lambda: {'cnt': 0, 'sum': 0.0})
        for d in kom_no_edu:
            f = str(d.get('UF_CRM_1765896709800', '') or '—')
            edu_dist[f]['cnt'] += 1
            edu_dist[f]['sum'] += float(d.get('OPPORTUNITY') or 0)
        print(f"   Распределение по UF_CRM_1765896709800:")
        for f, v in sorted(edu_dist.items(), key=lambda x: -x[1]['sum']):
            print(f"     {f:>12}: {v['cnt']:>4} шт, {v['sum']:>12,.0f} ₽")

    # По какому признаку определяется КОМ
    print(f"\n3. По КАКОМУ признаку определяется КОМ (у всех КОМ-сделок):")
    by_flag = {'Галочка': 0, 'Формат': 0, 'Направление': 0, 'Категория=19': 0, 'Тип обучения': 0}
    by_flag_sum = {'Галочка': 0.0, 'Формат': 0.0, 'Направление': 0.0, 'Категория=19': 0.0, 'Тип обучения': 0.0}
    for d in kom_deals:
        opp = float(d.get('OPPORTUNITY') or 0)
        if has_flag_kom(d):
            by_flag['Галочка'] += 1
            by_flag_sum['Галочка'] += opp
        if has_fmt_kom(d):
            by_flag['Формат'] += 1
            by_flag_sum['Формат'] += opp
        if has_direction_kom(d):
            by_flag['Направление'] += 1
            by_flag_sum['Направление'] += opp
        if has_cat19(d):
            by_flag['Категория=19'] += 1
            by_flag_sum['Категория=19'] += opp
        if has_edu_kom(d):
            by_flag['Тип обучения'] += 1
            by_flag_sum['Тип обучения'] += opp

    for k in ['Галочка', 'Формат', 'Направление', 'Категория=19', 'Тип обучения']:
        print(f"   {k:>15}: {by_flag[k]:>5} сд, {by_flag_sum[k]:>12,.0f} ₽")

    # Сколько сделок с КОМ но в PreSale
    kom_presale = [d for d in kom_deals if str(d.get('CATEGORY_ID', '')) == '8']
    print(f"\n4. КОМ-сделки в PreSale (категория 8): {len(kom_presale)} шт")
    if kom_presale:
        print(f"   Сумма: {sum(float(d.get('OPPORTUNITY') or 0) for d in kom_presale):,.0f} ₽")

if __name__ == '__main__':
    main()
