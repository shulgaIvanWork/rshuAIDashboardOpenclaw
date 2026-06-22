#!/usr/bin/env python3
"""Расхождения: только оплаченные сделки (с UF_DATE_PAY_1C)."""

import json
from collections import defaultdict

CACHE_DIR = '/root/.openclaw/workspace/projects/dashboards/rshu-management-dashboard/cache'

KOM_FORMAT_ID = '19042498'
KOM_DIRECTION_ID = '1906'
KOM_CATEGORY = 19
KOM_TRAINING_ID = '34765'
VALID_CATS = {0, 8, 19}
MIN_OPP = 11.0

def is_kom_deal(x):
    if x.get('UF_CRM_1683882427069') in ('Y', '1', True):
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

def main():
    with open(f'{CACHE_DIR}/deals_NEW.json', 'r') as f:
        deals = json.load(f)

    # Фильтр: оплаченные, валидные категории, сумма >= 11
    paid = []
    for d in deals:
        opp = float(d.get('OPPORTUNITY') or 0)
        cat = int(d.get('CATEGORY_ID', 0))
        if cat not in VALID_CATS:
            continue
        if opp < MIN_OPP:
            continue
        if not d.get('UF_DATE_PAY_1C'):
            continue
        paid.append(d)

    print(f"Всего оплаченных сделок (OPP>={MIN_OPP}, CAT IN (0,8,19), есть UF_DATE_PAY_1C): {len(paid)}")
    
    kom_paid = [d for d in paid if is_kom_deal(d)]
    print(f"Из них КОМ: {len(kom_paid)}")
    
    # ====== Расхождение 1: КОМ без UF_FORMAT=КОМ ======
    kom_no_fmt = [d for d in kom_paid if str(d.get('UF_FORMAT', '')) != KOM_FORMAT_ID]
    kom_no_fmt_sum = sum(float(d.get('OPPORTUNITY') or 0) for d in kom_no_fmt)
    print(f"\n{'='*80}")
    print(f"1. КОМ-сделки, у которых UF_FORMAT ≠ {KOM_FORMAT_ID} (формат не КОМ)")
    print(f"   {len(kom_no_fmt)} шт, {kom_no_fmt_sum:,.0f} ₽")
    print(f"   → В 3-м ряду КПЭ они есть, в графике форматов — НЕ в категории «Корпоративное обучение»")
    print(f"{'='*80}")
    for d in sorted(kom_no_fmt, key=lambda x: -float(x.get('OPPORTUNITY') or 0)):
        opp = float(d.get('OPPORTUNITY') or 0)
        fmt = str(d.get('UF_FORMAT', '') or '—')
        edu = str(d.get('UF_CRM_1765896709800', '') or '—')
        title = (d.get('TITLE', '') or '')[:100]
        print(f"  #{d['ID']:>6} {opp:>10,.0f}₽ | UF_FORMAT={fmt:>12} | UF_CRM...9800={edu:>12} | {title}")
    
    # Распределение
    dist = defaultdict(lambda: {'cnt': 0, 'sum': 0.0})
    for d in kom_no_fmt:
        f = str(d.get('UF_FORMAT', '') or '—')
        dist[f]['cnt'] += 1
        dist[f]['sum'] += float(d.get('OPPORTUNITY') or 0)
    print(f"\n  Распределение по UF_FORMAT:")
    for f, v in sorted(dist.items(), key=lambda x: -x[1]['sum']):
        print(f"    {f:>15}: {v['cnt']:>4} шт, {v['sum']:>12,.0f} ₽")

    # ====== Расхождение 2: КОМ без типа обучения ======
    kom_no_edu = [d for d in kom_paid if str(d.get('UF_CRM_1765896709800', '')) != KOM_TRAINING_ID]
    kom_no_edu_sum = sum(float(d.get('OPPORTUNITY') or 0) for d in kom_no_edu)
    print(f"\n{'='*80}")
    print(f"2. КОМ-сделки, у которых UF_CRM_1765896709800 ≠ {KOM_TRAINING_ID} (тип обучения не КОМ)")
    print(f"   {len(kom_no_edu)} шт, {kom_no_edu_sum:,.0f} ₽")
    print(f"   → В 3-м ряду КПЭ они есть, в графике типов обучения — НЕ в «Корпоративное обучение»")
    print(f"{'='*80}")
    for d in sorted(kom_no_edu, key=lambda x: -float(x.get('OPPORTUNITY') or 0)):
        opp = float(d.get('OPPORTUNITY') or 0)
        fmt = str(d.get('UF_FORMAT', '') or '—')
        edu = str(d.get('UF_CRM_1765896709800', '') or '—')
        title = (d.get('TITLE', '') or '')[:100]
        print(f"  #{d['ID']:>6} {opp:>10,.0f}₽ | UF_FORMAT={fmt:>12} | UF_CRM...9800={edu:>12} | {title}")
    
    edu_dist = defaultdict(lambda: {'cnt': 0, 'sum': 0.0})
    for d in kom_no_edu:
        f = str(d.get('UF_CRM_1765896709800', '') or '—')
        edu_dist[f]['cnt'] += 1
        edu_dist[f]['sum'] += float(d.get('OPPORTUNITY') or 0)
    print(f"\n  Распределение по UF_CRM_1765896709800:")
    for f, v in sorted(edu_dist.items(), key=lambda x: -x[1]['sum']):
        label = {'34699': 'Повышение квалификации', '34700': 'Проф. переподготовка', '34765': 'КОМ', '—': 'Пусто', '': 'Пусто'}.get(str(f).strip(), f)
        print(f"    {f:>15} ({label:>25}): {v['cnt']:>4} шт, {v['sum']:>12,.0f} ₽")

    # ====== Расхождение 3: КОМ ВООБЩЕ БЕЗ формата и типа ======
    both_missing = [d for d in kom_paid if str(d.get('UF_FORMAT', '')) != KOM_FORMAT_ID and str(d.get('UF_CRM_1765896709800', '')) != KOM_TRAINING_ID]
    both_sum = sum(float(d.get('OPPORTUNITY') or 0) for d in both_missing)
    print(f"\n{'='*80}")
    print(f"3. КОМ-сделки БЕЗ UF_FORMAT=КОМ И БЕЗ тип обучения=КОМ")
    print(f"   {len(both_missing)} шт, {both_sum:,.0f} ₽")
    print(f"   → Они только в 3-м ряду. НЕТ ни в графике форматов, ни в графике типов.")
    print(f"{'='*80}")
    for d in sorted(both_missing, key=lambda x: -float(x.get('OPPORTUNITY') or 0)):
        opp = float(d.get('OPPORTUNITY') or 0)
        fmt = str(d.get('UF_FORMAT', '') or '—')
        edu = str(d.get('UF_CRM_1765896709800', '') or '—')
        title = (d.get('TITLE', '') or '')[:100]
        print(f"  #{d['ID']:>6} {opp:>10,.0f}₽ | UF_FORMAT={fmt:>12} | UF_CRM...9800={edu:>12} | {title}")

    # ====== Сводная таблица ======
    print(f"\n{'='*80}")
    print(f"СВОДНАЯ ТАБЛИЦА ПО ВСЕМ ОПЛАЧЕННЫМ КОМ")
    print(f"{'='*80}")
    
    all_kom_sum = sum(float(d.get('OPPORTUNITY') or 0) for d in kom_paid)
    has_fmt = sum(1 for d in kom_paid if str(d.get('UF_FORMAT', '')) == KOM_FORMAT_ID)
    has_fmt_sum = sum(float(d.get('OPPORTUNITY') or 0) for d in kom_paid if str(d.get('UF_FORMAT', '')) == KOM_FORMAT_ID)
    has_edu = sum(1 for d in kom_paid if str(d.get('UF_CRM_1765896709800', '')) == KOM_TRAINING_ID)
    has_edu_sum = sum(float(d.get('OPPORTUNITY') or 0) for d in kom_paid if str(d.get('UF_CRM_1765896709800', '')) == KOM_TRAINING_ID)
    
    print(f"\n  Показатель                       |   Шт   |     Сумма, ₽")
    print(f"  {'─'*70}")
    print(f"  3-й ряд КПЭ (КОМ, всего)         | {len(kom_paid):>5}  | {all_kom_sum:>14,.0f}")
    print(f"  ─────────────────────────────────────────────────────────────")
    print(f"  Из них с UF_FORMAT=КОМ            | {has_fmt:>5}  | {has_fmt_sum:>14,.0f}")
    print(f"  УВИДЯТ в графике форматов         |      |  (категория «Корпоративное обучение»)")
    print(f"  Из них БЕЗ UF_FORMAT=КОМ          | {len(kom_no_fmt):>5}  | {kom_no_fmt_sum:>14,.0f}")
    print(f"  НЕ УВИДЯТ в графике форматов      |      |  (размазаны по другим форматам)")
    print(f"  ─────────────────────────────────────────────────────────────")
    print(f"  Из них с типом обучения=КОМ       | {has_edu:>5}  | {has_edu_sum:>14,.0f}")
    print(f"  УВИДЯТ в графике типов обучения   |      |  (категория «Корпоративное обучение»)")
    print(f"  Из них БЕЗ типа обучения=КОМ      | {len(kom_no_edu):>5}  | {kom_no_edu_sum:>14,.0f}")
    print(f"  НЕ УВИДЯТ в графике типов обучения|      |  (пусто или другое значение)")
    print(f"  ─────────────────────────────────────────────────────────────")
    print(f"  БЕЗ И формата=КОМ, И типа=КОМ     | {len(both_missing):>5}  | {both_sum:>14,.0f}")
    print(f"  НЕТ НИ В ОДНОМ из двух графиков   |      |  (только в 3-м ряду КПЭ)")

if __name__ == '__main__':
    main()
