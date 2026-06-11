"""
build_kom_cache.py — Генерация data/cache.json для КОМ дашборда.

Читает готовые данные из drop-dashboard cache (agg.json + deals_2026.json)
и строит KOM-специфичный кэш.
"""
import json, os, sys
from datetime import datetime

YEAR = 2026
DROP_CACHE = os.path.join(os.path.dirname(__file__), '..', '..', 'drop-dashboard', 'cache')
KOM_DATA = os.path.join(os.path.dirname(__file__), '..', 'data')
KOM_CACHE = os.path.join(os.path.dirname(__file__), '..', 'cache')
os.makedirs(KOM_DATA, exist_ok=True)
os.makedirs(KOM_CACHE, exist_ok=True)

KOM_CAT = "КОМ (Sale)"
MIN_OPP = 1.0

def load_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"  ERROR {path}: {e}")
        return None

def main():
    print("Загружаем данные...")
    
    deals = load_json(os.path.join(DROP_CACHE, 'deals_2026.json'))
    dicts = load_json(os.path.join(DROP_CACHE, 'dicts.json'))
    cc = load_json(os.path.join(DROP_CACHE, 'company_contact.json'))
    agg = load_json(os.path.join(DROP_CACHE, 'agg.json'))
    
    if not deals or not dicts or not agg:
        print("ОШИБКА: Не найдены исходные файлы")
        sys.exit(1)
    
    cats = dicts.get('categories', {})
    users = dicts.get('users', {})
    
    # KOM сделки (все, включая "копии для статистики" — они нужны для статистики)
    kom_all = [d for d in deals if cats.get(str(d.get('CATEGORY_ID', '0')), '') == KOM_CAT]
    
    # Исключаем технические сделки (копии, входящие звонки)
    kom_real = [d for d in kom_all 
                if 'копия для статистики' not in (d.get('TITLE', '') or '').lower()
                and 'входящий звонок' not in (d.get('TITLE', '') or '').lower()]
    
    # Сделки с суммой >= 1
    kom_with_opp = [d for d in kom_real if float(d.get('OPPORTUNITY', 0) or 0) >= MIN_OPP]
    
    print(f"Всего сделок: {len(deals)}")
    print(f"КОМ (все): {len(kom_all)}")
    print(f"КОМ (реальных): {len(kom_real)}")
    print(f"КОМ (с суммой): {len(kom_with_opp)}")
    
    # Суммы и количества из agg.json (точные метрики)
    kom_ytd = agg.get('kom_ytd', {})
    total_kom_revenue = kom_ytd.get('postupleniya', 0)
    total_kom_deals = kom_ytd.get('won_relevant_cnt', 0)
    
    print(f"КОМ YTD (из agg.json): {total_kom_revenue:,.0f} ₽ / {total_kom_deals} сделок")
    
    # Weekly KOM data from agg.json
    weeks = agg.get('weeks', [])
    weekly_kom = []
    for w in weeks:
        kom_rev = w.get('kom_postupleniya', 0)
        kom_cnt = w.get('kom_won_cnt', 0)
        if kom_rev > 0 or kom_cnt > 0:
            weekly_kom.append({
                'label': w.get('label_short', ''),
                'dates': w.get('label_dates', ''),
                'revenue': round(kom_rev),
                'leads': kom_cnt,
                'paid': kom_cnt,
                'avgCheck': round(kom_rev / kom_cnt) if kom_cnt > 0 else 0,
                'conversion': 0,
                'avgDuration': 0,
                'trainingDays': 0,
            })
    
    # Monthly KOM from agg (group weeks by actual month from label_dates)
    def week_to_month(label_dates):
        """Определяем месяц по дате начала недели из label_dates"""
        try:
            # Format: '12.01—18.01' or '26.01—01.02'
            start_str = label_dates.split('—')[0].strip()
            day, month = start_str.split('.')
            return int(month)
        except:
            return None
    
    month_map = {}
    for w in weeks:
        kom_rev = w.get('kom_postupleniya', 0)
        kom_cnt = w.get('kom_won_cnt', 0)
        if kom_rev > 0 or kom_cnt > 0:
            month_num = week_to_month(w.get('label_dates', ''))
            if month_num is None:
                continue
            month_map[month_num] = month_map.get(month_num, {'revenue': 0, 'deals': 0})
            month_map[month_num]['revenue'] += kom_rev
            month_map[month_num]['deals'] += kom_cnt
    
    month_names = ['', 'Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
    
    monthly = []
    for m_num in sorted(month_map.keys()):
        m = month_map[m_num]
        mn = month_names[m_num] if 1 <= m_num <= 12 else str(m_num)
        monthly.append({
            'monthName': mn,
            'revenue': round(m['revenue']),
            'leads': m['deals'],
            'registrations': 0,
            'paid': m['deals'],
            'avgCheck': round(m['revenue'] / m['deals']) if m['deals'] > 0 else 0,
            'conversion': 0,
            'avgDuration': 0,
            'trainingDays': 0,
            'participants': 0,
        })
    
    # Top KOM paid deals (from the "copy for stats" which are the real paid ones)
    # These are the actual paid KOM deals from the data
    paid_kom = [d for d in kom_all 
                if d.get('STAGE_SEMANTIC_ID') == 'S' 
                and d.get('CLOSED') == 'Y'
                and float(d.get('OPPORTUNITY', 0) or 0) > 0]
    
    paid_kom_sorted = sorted(paid_kom, key=lambda d: float(d.get('OPPORTUNITY', 0) or 0), reverse=True)
    
    top_deals = []
    for i, d in enumerate(paid_kom_sorted[:50]):
        manager = users.get(str(d.get('ASSIGNED_BY_ID', '')), '—')
        opp = float(d.get('OPPORTUNITY', 0) or 0)
        
        top_deals.append({
            'rank': i + 1,
            'title': d.get('TITLE', ''),
            'manager': manager,
            'revenue': round(opp),
            'clientType': 'repeat' if any(kw in (d.get('TITLE','') or '').lower() for kw in ['повтор', '2 группа', '3 группа']) else 'new',
            'trainStart': d.get('UF_CRM_DATE_START_LEARN', '—') or '—',
            'trainEnd': d.get('UF_CRM_DATE_END_LEARN', '—') or '—',
            'teacherFee': None,
            'duration': 0,
            'payDate': d.get('CLOSEDATE', '—') or '—',
        })
    
    kom_real_paid = len([d for d in kom_real if d.get('STAGE_SEMANTIC_ID') == 'S' and d.get('CLOSED') == 'Y'])
    
    cache_data = {
        'updatedAt': datetime.now().isoformat(),
        'kpi': {
            'totalRevenue': round(total_kom_revenue),
            'totalLeads': len(kom_with_opp),
            'totalRegistered': len(kom_with_opp),
            'totalPaid': total_kom_deals,
            'avgCheck': round(total_kom_revenue / total_kom_deals) if total_kom_deals > 0 else 0,
            'conversion': round(total_kom_deals / len(kom_with_opp) * 100, 1) if len(kom_with_opp) > 0 else 0,
            'avgDuration': 0,
            'trainingDays': 0,
            'participants': 0,
        },
        'warningNote': '',
        'dealsNote': f'Всего КОМ: {len(kom_with_opp)} сделок, оплачено: {total_kom_deals}',
        'monthly': monthly,
        'weekly': weekly_kom,
        'topDeals': top_deals,
    }
    
    cache_file = os.path.join(KOM_DATA, 'cache.json')
    with open(cache_file, 'w', encoding='utf-8') as f:
        json.dump(cache_data, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ KOM cache: {cache_file}")
    print(f"   Выручка: {round(total_kom_revenue):,} ₽")
    print(f"   Оплачено сделок: {total_kom_deals}")
    print(f"   Недель с данными: {len(weekly_kom)}")
    print(f"   ТОП сделок: {len(top_deals)}")
    
    # Copy shared cache files  
    for fname in ['deals_2026.json', 'company_contact.json', 'companies_ext.json', 'dicts.json']:
        src = os.path.join(DROP_CACHE, fname)
        dst = os.path.join(KOM_CACHE, fname)
        if os.path.exists(src) and not os.path.islink(dst):
            import shutil
            shutil.copy2(src, dst)
            size = os.path.getsize(dst)
            print(f"   Копирован: {fname} ({size/1024/1024:.1f} MB)")
    
    print("Готово!")

if __name__ == '__main__':
    main()
