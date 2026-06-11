"""
forecast.py — расчёт прогнозов на остаток месяца.
v3 — только воронка Sale (Общая по умолчанию), ничего из Отказы/PreSale/КОМ.

Схема продаж:
- PROPOSAL → 2 → 6 (счёт отправлен) → WON (оплачено)
- Счёт отправлен = стадия 6
- MQL/SQL = просто стадии воронки Sale
"""

import json, sys, os, glob
from datetime import date, timedelta
from collections import defaultdict

CACHE_DIR = os.path.join(os.path.dirname(__file__), '..', 'cache')

def load(path):
    with open(os.path.join(CACHE_DIR, path), 'r', encoding='utf-8') as f:
        return json.load(f)

def parse_dt(s):
    if not s: return None
    for l, f in [(19, "%Y-%m-%dT%H:%M:%S"), (10, "%Y-%m-%d")]:
        try: from datetime import datetime; return datetime.strptime(s[:l], f)
        except: continue
    return None

def fmt(n):
    try: return f"{n:,.0f}".replace(",", " ")
    except: return str(n)

def main():
    agg = load('agg.json')
    deals = load('deals_2026.json')
    dicts = load('dicts.json')
    cats = dicts['categories']

    TODAY = date.fromisoformat(agg['today'])
    YEAR = agg['year']

    month_end = date(YEAR, TODAY.month + 1, 1) - timedelta(days=1) if TODAY.month < 12 else date(YEAR, 12, 31)
    days_left_cal = (month_end - TODAY).days
    days_left_incl_cal = days_left_cal + 1

    def count_workdays(from_d, to_d, incl_today=True):
        d = from_d if incl_today else from_d + timedelta(days=1)
        cnt = 0
        while d <= to_d:
            if d.weekday() < 5: cnt += 1
            d += timedelta(days=1)
        return cnt

    days_left = count_workdays(TODAY, month_end, incl_today=False)
    days_left_incl = count_workdays(TODAY, month_end, incl_today=True)

    weeks = agg['weeks']
    MONTH_NAMES = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                   'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

    # ===================== ФИЛЬТР: только Sale =====================
    SALE_CAT = 'Общая (по умолчанию)'

    # Пайплайн: только стадии P (в работе) с суммой > 0 в Sale
    pipeline_stages = defaultdict(lambda: {'cnt': 0, 'sum': 0.0, 'zero_cnt': 0})
    for d in deals:
        cat = cats.get(str(d.get('CATEGORY_ID', '0')), '')
        if cat != SALE_CAT: continue
        sem = d.get('STAGE_SEMANTIC_ID')
        stage = d.get('STAGE_ID', '')
        opp = float(d.get('OPPORTUNITY') or 0)
        if sem == 'P':
            pipeline_stages[stage]['cnt'] += 1
            pipeline_stages[stage]['sum'] += opp
            if opp == 0: pipeline_stages[stage]['zero_cnt'] += 1

    # Стадия 6 = счёт отправлен
    stage6 = pipeline_stages.get('6', {'cnt': 0, 'sum': 0.0})
    stage2 = pipeline_stages.get('2', {'cnt': 0, 'sum': 0.0})
    proposal = pipeline_stages.get('PROPOSAL', {'cnt': 0, 'sum': 0.0})

    invoice_cnt = stage6['cnt']
    invoice_sum = stage6['sum']
    pipeline_total_cnt = sum(v['cnt'] for k, v in pipeline_stages.items() if v['sum'] > 0)
    pipeline_total_sum = sum(v['sum'] for k, v in pipeline_stages.items())

    # WON / LOSE stats (Sale)
    won_deals = []
    lose_cnt = 0
    for d in deals:
        cat = cats.get(str(d.get('CATEGORY_ID', '0')), '')
        if cat != SALE_CAT: continue
        sem = d.get('STAGE_SEMANTIC_ID')
        opp = float(d.get('OPPORTUNITY') or 0)
        if sem == 'S' and opp > 0:
            won_deals.append(d)
        elif sem == 'F':
            lose_cnt += 1

    conv_sale = len(won_deals) / (len(won_deals) + lose_cnt) * 100 if (len(won_deals) + lose_cnt) else 0

    # Коэффициент для стадии 6 → WON: высокий, т.к. это последняя стадия
    # По историческим данным, ~85% сделок со стадии 6 доходят до WON
    # (можно уточнить, но консервативно используем 80%)
    STAGE6_WON_COEFF = 0.80
    invoice_forecast = invoice_sum * STAGE6_WON_COEFF

    # ===================== ЛИДЫ В ДЕНЬ =====================
    may_weeks = [w for w in weeks if w['week'] >= 18]
    may_leads = sum(w['leads'] for w in may_weeks)
    may_days = sum(7 if w['week'] < 22 else (TODAY - date.fromisoformat(w['mon'])).days + 1 for w in may_weeks)
    may_days = max(may_days, 1)
    leads_day = may_leads / may_days

    ytd = agg['ytd']
    avg_check_ytd = ytd['avg_check']
    med_check_ytd = ytd['median_check']
    may_post = sum(w['postupleniya'] for w in may_weeks)
    may_opl = sum(w['oplata'] for w in may_weeks)
    avg_check_may = may_post / may_opl if may_opl else 0

    # ===================== КОНВЕРСИЯ =====================
    total_mql = sum(w['mql'] for w in weeks)
    total_sql = sum(w['sql'] for w in weeks)
    total_opl = sum(w['oplata'] for w in weeks)
    conv_mql_sql = total_sql / total_mql * 100 if total_mql else 0
    conv_sql_paid = total_opl / total_sql * 100 if total_sql else 0

    last4 = weeks[-4:] if len(weeks) >= 4 else weeks
    r4_sql = sum(w['sql'] for w in last4)
    r4_opl = sum(w['oplata'] for w in last4)
    conv_sql_paid_4w = r4_opl / r4_sql * 100 if r4_sql else 0

    # ===================== ЗАКРЫТИЕ В N ДНЕЙ =====================
    won_durs = []
    for d in won_deals:
        dc = parse_dt(d.get('DATE_CREATE'))
        cl = parse_dt(d.get('CLOSEDATE'))
        if not dc or not cl: continue
        days = (cl - dc).days
        if days >= 0: won_durs.append((days, float(d.get('OPPORTUNITY') or 0)))

    tw = len(won_durs)
    w5 = sum(1 for d, _ in won_durs if d <= 5)
    w14 = sum(1 for d, _ in won_durs if d <= 14)
    pct_5d = w5 / tw * 100 if tw else 0
    pct_14d = w14 / tw * 100 if tw else 0

    # ===================== ПРОГНОЗ НОВЫЕ =====================
    # Новые лиды за остаток месяца → часть станет сделками
    new_leads_fc_cnt = round(leads_day * days_left_incl)
    close_prob = pct_5d / 100  # доля закрытых ≤5 дней
    new_fc_sum = new_leads_fc_cnt * close_prob * avg_check_may

    # ===================== SQL ПРОГНОЗ (Балтиец) =====================
    avg_sql_4w = r4_sql / len(last4) if last4 else 0
    weeks_left = days_left / 7
    sql_fc_cnt = round(max(avg_sql_4w * weeks_left, 0))
    sql_fc_sum = sql_fc_cnt * (conv_sql_paid_4w / 100) * avg_check_may

    # ===================== ИТОГО =====================
    total_fc = agg['cur']['postupleniya'] + invoice_forecast + sql_fc_sum + new_fc_sum
    may_posted = sum(w['postupleniya'] for w in may_weeks)

    # ===================== ДОП. ДАННЫЕ ДЛЯ ЭКРАНОВ =====================
    conv_weekly = []
    for w in weeks[-10:]:
        conv_weekly.append({
            'week': f'W{w["week"]:02d}',
            'mql_sql': round(w['conv_mql_sql'], 1),
            'sql_paid': round(w['conv_sql_oplata'], 1),
            'mql_paid': round(w['oplata'] / w['mql'] * 100, 1) if w['mql'] else 0,
        })

    monthly_checks = {}
    for w in weeks:
        mon = date.fromisoformat(w['mon']).month
        if mon not in monthly_checks:
            monthly_checks[mon] = {'post': 0, 'cnt': 0}
        monthly_checks[mon]['post'] += w['postupleniya']
        monthly_checks[mon]['cnt'] += w['won_cnt']

    month_labels = {1:'Янв',2:'Фев',3:'Мар',4:'Апр',5:'Май',6:'Июн',7:'Июл',8:'Авг',9:'Сен',10:'Окт',11:'Ноя',12:'Дек'}
    monthly_avg_table = []
    for m in sorted(monthly_checks.keys()):
        v = monthly_checks[m]
        if v['cnt'] > 0:
            monthly_avg_table.append({
                'month': month_labels.get(m, str(m)),
                'post': round(v['post']),
                'cnt': v['cnt'],
                'avg': round(v['post'] / v['cnt'])
            })

    # Форматы поступлений (YTD)
    fmt_checks = {}
    fmt_ytd = agg.get('fmt_ytd', {})
    for k in ['ООМ (Очное)', 'ОМ (Онлайн)', 'СДО', 'КОМ']:
        v = fmt_ytd.get(k, {})
        if v.get('cnt', 0) > 0:
            fmt_checks[k] = {'sum': round(v['sum']), 'cnt': v['cnt'], 'avg': round(v['sum'] / v['cnt'])}

    b2b_data = agg.get('btype_ytd', {}).get('B2B', {})
    b2c_data = agg.get('btype_ytd', {}).get('B2C', {})
    b2b_avg_check = round(b2b_data['sum'] / b2b_data['cnt']) if b2b_data.get('cnt') else 0
    b2c_avg_check = round(b2c_data['sum'] / b2c_data['cnt']) if b2c_data.get('cnt') else 0

    # May лиды
    may_mql = sum(w['mql'] for w in may_weeks)
    may_sql = sum(w['sql'] for w in may_weeks)
    may_weekly_mql = {f'W{w["week"]:02d}': w['mql'] for w in may_weeks}
    may_weekly_sql = {f'W{w["week"]:02d}': w['sql'] for w in may_weeks}
    may_weekly_opl = {f'W{w["week"]:02d}': w['oplata'] for w in may_weeks}
    may_weekly_leads = {f'W{w["week"]:02d}': w['leads'] for w in may_weeks}
    may_conv_mql_sql = may_sql / may_mql * 100 if may_mql else 0
    may_conv_sql_paid = may_opl / may_sql * 100 if may_sql else 0

    # ===================== СБОРКА 10 ЭКРАНОВ =====================
    screens = [
        # 1. Прогноз воронка (Sale)
        {'id': 1, 'title': 'Прогноз воронка',
         'subtitle': 'Только Sale / Общая (по умолчанию)',
         'blocks': [
             {'label': 'Счёт отправлен (стадия 6)', 'cnt': invoice_cnt, 'sum': round(invoice_sum)},
             {'label': 'Коэф. 6→WON', 'value': f'{STAGE6_WON_COEFF*100:.0f}%'},
             {'label': 'Прогноз по счёту', 'sum': round(invoice_forecast)},
             {'label': 'Пайплайн PROPOSAL→6', 'cnt': pipeline_total_cnt, 'sum': round(pipeline_total_sum)},
         ],
         'pipeline': {k: {'cnt': v['cnt'], 'sum': round(v['sum'])} for k, v in pipeline_stages.items() if v['sum'] > 0},
         'forecast_sum': round(invoice_forecast),},

        # 2. Прогноз из SQL (Балтиец)
        {'id': 2, 'title': 'Прогноз из SQL (Балтиец)',
         'subtitle': 'SQL → оплата с коэффициентом конверсии',
         'blocks': [
             {'label': 'SQL за 4 нед.', 'value': r4_sql},
             {'label': 'Конверсия SQL→Paid (4 нед.)', 'value': f'{conv_sql_paid_4w:.1f}%'},
             {'label': 'Конверсия SQL→Paid (YTD)', 'value': f'{conv_sql_paid:.1f}%'},
             {'label': 'Средн. SQL/нед.', 'value': f'{avg_sql_4w:.1f}'},
             {'label': 'Осталось недель', 'value': f'{weeks_left:.1f}'},
             {'label': 'Прогноз SQL сделок', 'value': sql_fc_cnt},
             {'label': 'Средний чек (май)', 'sum': round(avg_check_may)},
             {'label': 'Прогноз по SQL', 'sum': round(sql_fc_sum)},
         ],
         'forecast_sum': round(sql_fc_sum),},

        # 3. Прогноз новые
        {'id': 3, 'title': 'Прогноз новые',
         'subtitle': 'Новые лиды × коэффициент × средний чек (Sale)',
         'blocks': [
             {'label': 'Лиды/день (май)', 'value': f'{leads_day:.1f}'},
             {'label': 'Раб. дней до конца', 'value': days_left_incl},
             {'label': 'Прогноз новых лидов', 'value': new_leads_fc_cnt},
             {'label': 'Коэф. закрытия ≤5 дн.', 'value': f'{pct_5d:.1f}%'},
             {'label': 'Средний чек (среднее, YTD)', 'sum': round(avg_check_ytd)},
             {'label': 'Средний чек (май, фактич.)', 'sum': round(avg_check_may)},
             {'label': 'Прогноз по новым', 'sum': round(new_fc_sum)},
         ],
         'forecast_sum': round(new_fc_sum),
         'coefficient_explanation': 'Расчёт: лиды/день × раб.дни × коэф.закрытия × ср.чек.',},

        # 4. Дни до конца месяца
        {'id': 4, 'title': 'Дни до конца месяца',
         'subtitle': f'Осталось {days_left} рабочих дн. (из {days_left_incl_cal} календарных)',
         'calendar_days': days_left_incl_cal,
         'blocks': [
             {'label': 'Сегодня', 'value': TODAY.strftime('%d.%m.%Y')},
             {'label': 'Конец месяца', 'value': month_end.strftime('%d.%m.%Y')},
             {'label': 'Рабочих дней', 'value': days_left, 'hint': 'без выходных'},
             {'label': 'Календарных дней', 'value': days_left_incl_cal},
             {'label': 'С учётом сегодня (раб.)', 'value': days_left_incl},
             {'label': f'Прогресс {MONTH_NAMES[TODAY.month]}', 'value': f'{round((month_end.day - days_left_cal) / month_end.day * 100, 1)}%'},
         ],},

        # 5. Новые лиды в день
        {'id': 5, 'title': 'Новые лиды в день — тенденция мая',
         'subtitle': f'Среднее {leads_day:.1f} лид/день на основе {may_leads} лидов',
         'blocks': [
             {'label': 'Всего лидов в мае', 'value': may_leads},
             {'label': 'Дней в анализе', 'value': int(may_days)},
             {'label': 'Лидов в день', 'value': f'{leads_day:.1f}'},
             {'label': 'Прогноз до конца мая', 'value': new_leads_fc_cnt},
         ],
         'weekly': may_weekly_leads,},

        # 6. Итого
        {'id': 6, 'title': 'Итого прогноз',
         'subtitle': 'Сумма прогнозов на остаток мая (Sale)',
         'blocks': [
             {'label': 'Уже поступило (тек.нед.)', 'sum': round(agg['cur']['postupleniya'])},
             {'label': 'Прогноз счёт отправлен', 'sum': round(invoice_forecast)},
             {'label': 'Прогноз SQL', 'sum': round(sql_fc_sum)},
             {'label': 'Прогноз новые', 'sum': round(new_fc_sum)},
             {'label': 'ИТОГО прогноз на остаток', 'sum': round(total_fc), 'bold': True},
             {'label': 'Поступления в мае', 'sum': round(may_posted)},
             {'label': 'YTD поступления', 'sum': round(agg['ytd']['postupleniya'])},
         ],
         'total_forecast': round(total_fc),
         'may_posted': round(may_posted),},

        # 7. Конверсия
        {'id': 7, 'title': 'Конверсия',
         'subtitle': 'MQL → SQL → Paid: понедельно и сводная',
         'blocks': [
             {'label': 'MQL→SQL (YTD)', 'value': f'{conv_mql_sql:.1f}%'},
             {'label': 'SQL→Paid (YTD)', 'value': f'{conv_sql_paid:.1f}%'},
             {'label': 'MQL→Paid (YTD)', 'value': f'{total_opl/total_mql*100:.1f}%' if total_mql else '0.0%'},
             {'label': 'MQL→SQL (май)', 'value': f'{may_conv_mql_sql:.1f}%'},
             {'label': 'SQL→Paid (май)', 'value': f'{may_conv_sql_paid:.1f}%'},
         ],
         'conv_weekly': conv_weekly,},

        # 8. Средний чек
        {'id': 8, 'title': 'Средний чек',
         'subtitle': 'По периодам, форматам и сегментам (среднее)',
         'blocks': [
             {'label': 'Средний чек YTD', 'sum': round(avg_check_ytd)},
             {'label': 'Средний чек май', 'sum': round(avg_check_may)},
             {'label': 'Медиана YTD', 'sum': round(med_check_ytd)},
             {'label': 'Макс. чек YTD', 'sum': round(agg['ytd']['max_check'])},
         ],
         'fmt_checks': fmt_checks,
         'b2b_avg': b2b_avg_check,
         'b2c_avg': b2c_avg_check,
         'monthly_avg': monthly_avg_table,},

        # 9. Лиды в сейл — май
        {'id': 9, 'title': 'Лиды в сейл — май',
         'subtitle': 'Лиды в Sale воронке за месяц',
         'blocks': [
             {'label': 'MQL (новые в Sale)', 'value': may_mql},
             {'label': 'SQL (передано в ОП)', 'value': may_sql},
             {'label': 'Лиды (CRM, все)', 'value': may_leads},
             {'label': 'Оплачено (сделок)', 'value': may_opl},
             {'label': 'Конв. MQL→SQL', 'value': f'{may_conv_mql_sql:.1f}%'},
             {'label': 'Конв. SQL→Paid', 'value': f'{may_conv_sql_paid:.1f}%'},
         ],
         'weekly_mql': may_weekly_mql,
         'weekly_sql': may_weekly_sql,
         'weekly_opl': may_weekly_opl,},

        # 10. Ключевые выводы
        {'id': 10, 'title': 'Ключевые выводы',
         'subtitle': f'Только воронка Sale (Общая по умолчанию)',
         'recommendations': [
             f'До конца {MONTH_NAMES[TODAY.month].lower()} осталось {days_left} рабочих дн.',
             f'Воронка Sale: {pipeline_total_cnt} cделок на {fmt(pipeline_total_sum)} ₽ в работе',
             f'Счёт отправлен (стадия 6): {invoice_cnt} на {fmt(invoice_sum)} ₽ → ~{fmt(invoice_forecast)} ₽',
             f'Конверсия WON/(WON+LOSE) по Sale: {conv_sale:.1f}%',
             f'Коэф. 6→WON: {STAGE6_WON_COEFF*100:.0f}% (последняя стадия)',
             f'Новые лиды: ~{leads_day:.1f}/день → ~{new_leads_fc_cnt} шт. → ~{fmt(new_fc_sum)} ₽ (коэф.{pct_5d:.1f}%)',
             f'Итого прогноз: ~{fmt(total_fc)} ₽',
         ],},
    ]

    result = {
        'today': TODAY.isoformat(),
        'month_end': month_end.isoformat(),
        'days_left': days_left,
        'screens': screens,
        'coeff': {
            'conv_sale_won_pct': round(conv_sale, 1),
            'stage6_won_coeff_pct': STAGE6_WON_COEFF * 100,
            'close_5d_pct': round(pct_5d, 1),
            'leads_day_may': round(leads_day, 1),
            'avg_check_ytd': round(avg_check_ytd),
            'avg_check_may': round(avg_check_may),
            'conv_sql_paid_ytd_pct': round(conv_sql_paid, 1),
            'conv_mql_sql_pct': round(conv_mql_sql, 1),
        },
        'pipeline': {
            'main': {k: {'cnt': v['cnt'], 'sum': round(v['sum'])} for k, v in pipeline_stages.items() if v['sum'] > 0},
            'main_total': {'cnt': pipeline_total_cnt, 'sum': round(pipeline_total_sum)},
            'invoice_sent_stage6': {'cnt': invoice_cnt, 'sum': round(invoice_sum)},
        },
    }

    print(json.dumps(result, ensure_ascii=False, default=str))

if __name__ == '__main__':
    main()
