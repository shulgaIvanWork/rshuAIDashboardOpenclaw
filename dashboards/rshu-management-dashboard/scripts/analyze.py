"""
analyze.py — агрегирует данные из deals_2026.json + dicts.json + company_contact.json + leads_pages/.
Результат: agg.json

v2 — поступления считаются по UF_DATE_PAY_1C (факт оплаты из 1С), а не по CLOSEDATE.
"""
import json, glob, re, config
from datetime import datetime, date
from collections import defaultdict, Counter

print("== Загружаем данные ==")
deals_raw = json.load(open(config.DEALS_JSON, encoding="utf-8"))
dicts     = json.load(open(config.DICTS_JSON, encoding="utf-8"))
cc        = json.load(open(config.CC_JSON,    encoding="utf-8"))

# Компании
companies = {}
try:
    companies = json.load(open("companies.json", encoding="utf-8"))
    print(f"  Компаний: {len(companies)}")
except:
    print("  Компании не загружены (нет companies.json)")

cats        = dicts["categories"]
users       = dicts["users"]
sources_map = dicts["sources"]

leads = []
for fp in glob.glob(f"{config.LEADS_PAGES}/p_*.json"):
    leads.extend(json.load(open(fp, encoding="utf-8")))
leads = list({l["ID"]: l for l in leads}.values())
print(f"  Сделок: {len(deals_raw)}  Лидов: {len(leads)}")

TODAY = date.today()
YEAR  = config.YEAR
MIN_OPP = config.MIN_OPP

EXCLUDE_CATS = {"КОМ (Sale)", "Post Sale", "Отказы"}
KOM_CAT      = "КОМ (Sale)"
PRE_SALE_CAT = "Pre Sale"


def parse_dt(s):
    if not s:
        return None
    for slice_len, fmt in [(19, "%Y-%m-%dT%H:%M:%S"), (10, "%Y-%m-%d")]:
        try:
            return datetime.strptime(s[:slice_len], fmt)
        except ValueError:
            continue
    return None


# === Нормализация названия продукта ===
RE_DATE        = re.compile(r"\d{1,2}[.\-/]\d{1,2}([.\-/]\d{2,4})?(-\d{1,2}[.\-/]\d{1,2}([.\-/]\d{2,4})?)?")
RE_RANGE       = re.compile(r"\d{1,2}-\d{1,2}\.?\d{0,2}")
RE_CITY        = re.compile(r"\s*в\s+г\.?\s*[А-ЯЁA-Z][а-яёa-z\-]+", re.IGNORECASE)
RE_DOG         = re.compile(r"\s*Договор\s*№.*$", re.IGNORECASE)
RE_DATE2       = re.compile(r"\b\d{1,2}\.\d{1,2}\.\d{2,4}\b")
RE_PARENS_DATE = re.compile(r"\s*\(\s*с\s+\d.*?\)", re.IGNORECASE)


def normalize_product(title):
    t = title or ""
    t = re.sub(r"^КОПИЯ для статистики:\s*", "", t)
    t = re.sub(r"^КОМ[.,\s]*", "", t)
    t = re.sub(r"\bПодарок[_:\s]*", "", t)
    t = RE_DOG.sub("", t)
    t = RE_CITY.sub("", t)
    t = RE_DATE2.sub("", t)
    t = RE_DATE.sub("", t)
    t = RE_RANGE.sub("", t)
    t = RE_PARENS_DATE.sub("", t)
    t = re.sub(r"\(\s*СДО\s*\)", "", t)
    t = re.sub(r"_+", " ", t)
    t = re.sub(r"\s+", " ", t).strip(' .,:;"«»()')
    return t or title


def detect_format(title, cat_name):
    if cat_name == KOM_CAT:
        return "КОМ"
    t = (title or "").lower()
    if "(сдо)" in t or "сдо)" in t or " сдо " in t or t.endswith("сдо"):
        return "СДО"
    if "онлайн" in t:
        return "ОМ (Онлайн)"
    if "в г." in t or "москва" in t or "тюмен" in t:
        return "ООМ (Очное)"
    return "ООМ (Очное)"


def detect_b2b(did, opp, cat_name):
    c = cc.get(did, {})
    if c.get("COMPANY_ID", "0") != "0":
        return "B2B"
    if cat_name == KOM_CAT:
        return "B2B"
    if opp >= 50000:
        return "B2B"
    return "B2C"


def is_paid(r):
    """Сделка считается оплаченной.
    - Приоритет: UF_DATE_PAY_1C (факт оплаты из 1С)
    - Fallback: CLOSEDATE для WON-сделок (обратная совместимость)
    - Для КОМ: SEM=S + CLOSEDATE
    """
    if r["OPP"] < MIN_OPP:
        return False
    if r["SEM"] != "S":
        return False
    if r["IS_KOM"]:
        return r["CL"] is not None
    # Приоритет: UF_DATE_PAY_1C
    if r.get("PAY_DT") is not None:
        return True
    # Fallback: если CLOSEDATE в этом году — считаем оплаченной
    if r["CL"] is not None and r["CL"].year == YEAR:
        return True
    return False


print("== Обогащаем сделки ==")
rows = []
for x in deals_raw:
    cat = cats.get(str(x.get("CATEGORY_ID", "0")), str(x.get("CATEGORY_ID", "0")))
    opp = float(x.get("OPPORTUNITY") or 0)
    pay_dt = parse_dt(x.get("UF_DATE_PAY_1C"))
    rows.append({
        "ID":        x["ID"],
        "TITLE":     x.get("TITLE", ""),
        "OPP":       opp,
        "SEM":       x.get("STAGE_SEMANTIC_ID"),
        "DC":        parse_dt(x.get("DATE_CREATE")),
        "CL":        parse_dt(x.get("CLOSEDATE")),
        "PAY_DT":    pay_dt,          # дата оплаты из 1С
        "CLOSED":    x.get("CLOSED"),
        "MGR":       users.get(str(x.get("ASSIGNED_BY_ID", "")), x.get("ASSIGNED_BY_ID", "")),
        "CAT":       cat,
        "SRC":       sources_map.get(x.get("SOURCE_ID") or "", x.get("SOURCE_ID") or "—"),
        "FORMAT":    detect_format(x.get("TITLE", ""), cat),
        "BTYPE":     detect_b2b(x["ID"], opp, cat),
        "PRODUCT":   normalize_product(x.get("TITLE", "")),
        "IS_REAL":   cat not in EXCLUDE_CATS,
        "IS_KOM":    cat == KOM_CAT,
        "IS_PRESALE": cat == PRE_SALE_CAT,
    })

# Статистика по UF_DATE_PAY_1C
pay_count = sum(1 for r in rows if r["PAY_DT"])
print(f"  Сделок с UF_DATE_PAY_1C: {pay_count} / {len(rows)}")

cur_y, cur_w, _ = TODAY.isocalendar()
prev_w = cur_w - 1 if cur_w > 1 else 1


def week_label(year, week):
    mon = date.fromisocalendar(year, week, 1)
    sun = min(date.fromisocalendar(year, week, 7), TODAY)
    return f"W{week:02d} ({mon.strftime('%d.%m')}—{sun.strftime('%d.%m')})"


# === Поступления рассчитываем по дате оплаты ===
def get_pay_year(r):
    """Год оплаты: UF_DATE_PAY_1C → CLOSEDATE (fallback). Для КОМ CLOSEDATE."""
    if not is_paid(r):
        return None
    if r["IS_KOM"]:
        return r["CL"].year if r["CL"] else None
    if r.get("PAY_DT"):
        return r["PAY_DT"].year
    if r["CL"]:
        return r["CL"].year
    return None

def get_pay_date(r):
    """Дата поступления: UF_DATE_PAY_1C → CLOSEDATE (fallback). Для КОМ CLOSEDATE."""
    if not is_paid(r):
        return None
    if r["IS_KOM"]:
        return r["CL"].date() if r["CL"] else None
    if r.get("PAY_DT"):
        return r["PAY_DT"].date()
    if r["CL"]:
        return r["CL"].date()
    return None

def pay_ytd(r):
    """Сделка оплачена в отчётном году."""
    return get_pay_year(r) == YEAR


def metrics(subset, is_kom_block=False):
    """Агрегированные метрики по подмножеству сделок.
    Поступления считаются только по 1С-оплаченным.
    """
    pred = (lambda r: r["IS_KOM"]) if is_kom_block else (lambda r: r["IS_REAL"])
    paid = [r for r in subset if is_paid(r) and pred(r)]
    pos_sum = sum(r["OPP"] for r in paid)
    pos_cnt = len(paid)
    avg     = pos_sum / pos_cnt if pos_cnt else 0
    chs     = sorted(r["OPP"] for r in paid)
    med     = chs[len(chs) // 2] if chs else 0
    mx      = max((r["OPP"] for r in paid), default=0)

    # Длительность от создания до оплаты (по CLOSEDATE, т.к. PAY_DT может быть сильно позже)
    # Длительность от создания до оплаты
    dur_pairs = [((r["CL"] - r["DC"]).days, r["OPP"]) for r in paid
                if r["DC"] and r["CL"] and (r["CL"] - r["DC"]).days >= 0]
    durs = [p[0] for p in dur_pairs]
    opps = [p[1] for p in dur_pairs]
    avg_dur = sum(durs) / len(durs) if durs else 0
    avg_dur_weighted = sum(d * o for d, o in dur_pairs) / sum(opps) if sum(opps) else 0
    med_dur = sorted(durs)[len(durs) // 2] if durs else 0

    lose_durs = []
    lose_cnt  = 0
    for r in subset:
        if r["SEM"] == "F" and r["CL"] and pred(r):
            lose_cnt += 1
            if r["DC"]:
                d = (r["CL"] - r["DC"]).days
                if d >= 0:
                    lose_durs.append(d)
    avg_lose = sum(lose_durs) / len(lose_durs) if lose_durs else 0
    conv     = pos_cnt / (pos_cnt + lose_cnt) * 100 if (pos_cnt + lose_cnt) else 0
    return {
        "postupleniya": pos_sum,
        "won_relevant_cnt": pos_cnt,
        "won_total_cnt": pos_cnt,  # больше не считаем нулевые сделки отдельно
        "zero_won_pct": 0,
        "avg_check": avg,
        "median_check": med,
        "max_check": mx,
        "avg_close_days_won": avg_dur,
        "avg_close_days_won_weighted": round(avg_dur_weighted, 1),
        "median_close_days_won": med_dur,
        "avg_close_days_lose": avg_lose,
        "lose_cnt": lose_cnt,
        "conv_deal_pct": conv,
        "created_cnt": sum(1 for r in subset if r["DC"] and pred(r)),
    }


# YTD — сделки с PAY_DT в этом году (или созданные/закрытые в этом году)
ytd_subset = [r for r in rows
              if (r["DC"] and r["DC"].year == YEAR)
              or (r["CL"] and r["CL"].year == YEAR)
              or pay_ytd(r)]
m_ytd     = metrics(ytd_subset)
m_kom_ytd = metrics(ytd_subset, is_kom_block=True)


def week_subset(year, week):
    """Сделки, относящиеся к неделе (по дате оплаты, создания или закрытия)."""
    seen = set()
    s    = []
    for r in rows:
        ok = False
        if get_pay_date(r) and get_pay_date(r).isocalendar()[:2] == (year, week):
            ok = True
        if r["CL"] and r["CL"].date().isocalendar()[:2] == (year, week):
            ok = True
        if r["DC"] and r["DC"].date().isocalendar()[:2] == (year, week):
            ok = True
        if ok and r["ID"] not in seen:
            seen.add(r["ID"])
            s.append(r)
    return s


ws_prev    = week_subset(YEAR, prev_w)
ws_cur     = week_subset(YEAR, cur_w)
m_prev     = metrics(ws_prev)
m_cur      = metrics(ws_cur)
m_kom_prev = metrics(ws_prev, is_kom_block=True)
m_kom_cur  = metrics(ws_cur,  is_kom_block=True)

# === MQL → SQL → Оплата по неделям ===
print("== Недельная воронка ==")
weekly = {}
for w in range(1, cur_w + 1):
    try:
        mon = date.fromisocalendar(YEAR, w, 1)
    except ValueError:
        continue
    sun = min(date.fromisocalendar(YEAR, w, 7), TODAY)
    weekly[w] = {
        "week": w, "mon": mon.isoformat(), "sun": sun.isoformat(),
        "label": week_label(YEAR, w),
        "label_short": f"W{w:02d}",
        "label_dates": f"{mon.strftime('%d.%m')}—{sun.strftime('%d.%m')}",
        "created_cnt": 0, "created_sum": 0.0,
        "postupleniya": 0.0, "won_cnt": 0, "lost_cnt": 0,
        "leads": 0, "avg_check": 0, "durs": [],
        "mql": 0, "sql": 0, "oplata": 0,
        "kom_postupleniya": 0.0, "kom_won_cnt": 0,
        "fmt_oom": 0.0, "fmt_om": 0.0, "fmt_sdo": 0.0, "fmt_kom": 0.0,
        "presale_durs": [],
    }

for r in rows:
    # created_cnt/created_sum — по дате создания
    if r["IS_REAL"]:
        if r["DC"] and r["DC"].year == YEAR:
            wk = r["DC"].date().isocalendar()[1]
            if wk in weekly and r["OPP"] >= MIN_OPP:
                weekly[wk]["created_cnt"]  += 1
                weekly[wk]["created_sum"]  += r["OPP"]

    # lost_cnt — по дате закрытия проигрыша
    if r["IS_REAL"] and r["CL"] and r["CL"].year == YEAR and r["CLOSED"] == "Y":
        wk = r["CL"].date().isocalendar()[1]
        if wk in weekly and r["SEM"] == "F":
            weekly[wk]["lost_cnt"] += 1

    # postupleniya / won_cnt / oplata — по дате оплаты
    if pay_ytd(r):
        pd = get_pay_date(r)
        if pd:
            wk = pd.isocalendar()[1]
        else:
            wk = None
        if wk and wk in weekly:
            weekly[wk]["postupleniya"] += r["OPP"]
            if r["IS_KOM"]:
                weekly[wk]["kom_postupleniya"] += r["OPP"]
                weekly[wk]["kom_won_cnt"]       += 1
            else:
                weekly[wk]["won_cnt"]       += 1
                weekly[wk]["oplata"]         += 1
            # По форматам
            fmt_keys = {"ООМ (Очное)": "fmt_oom", "ОМ (Онлайн)": "fmt_om", "СДО": "fmt_sdo", "КОМ": "fmt_kom"}
            if r["FORMAT"] in fmt_keys:
                weekly[wk][fmt_keys[r["FORMAT"]]] += r["OPP"]
            if not r["IS_KOM"] and r["DC"]:
                d = (r["CL"] - r["DC"]).days if r["CL"] else 0
                if d >= 0:
                    weekly[wk]["durs"].append(d)

    # MQL = создан в Pre Sale
    if r["IS_PRESALE"] and r["DC"] and r["DC"].year == YEAR:
        wk = r["DC"].date().isocalendar()[1]
        if wk in weekly:
            weekly[wk]["mql"] += 1

    # SQL = выигран в Pre Sale (передан в ОП)
    if r["IS_PRESALE"] and r["SEM"] == "S" and r["CL"] and r["CL"].year == YEAR:
        wk = r["CL"].date().isocalendar()[1]
        if wk in weekly:
            weekly[wk]["sql"] += 1
            if r["DC"]:
                d = (r["CL"] - r["DC"]).days
                if d >= 0:
                    weekly[wk]["presale_durs"].append(d)

for l in leads:
    d = parse_dt(l.get("DATE_CREATE"))
    if d and d.year == YEAR:
        wk = d.date().isocalendar()[1]
        if wk in weekly:
            weekly[wk]["leads"] += 1

for w, d in weekly.items():
    d["avg_check"]       = d["postupleniya"] / d["won_cnt"] if d["won_cnt"] else 0
    d["avg_dur"]         = sum(d["durs"])        / len(d["durs"])        if d["durs"]        else 0
    d["avg_presale_dur"] = sum(d["presale_durs"]) / len(d["presale_durs"]) if d["presale_durs"] else 0
    d["conv_mql_sql"]    = d["sql"]    / d["mql"]    * 100 if d["mql"]    else 0
    d["conv_sql_oplata"] = d["oplata"] / d["sql"]    * 100 if d["sql"]    else 0
    del d["durs"]
    del d["presale_durs"]

# === Источники + полная аналитика ===
print("== Источники ==")
src_data = defaultdict(lambda: {
    "postupleniya": 0.0, "deals": 0, "mql": 0, "sql": 0,
    "postupleniya_week": 0.0, "leads": 0,
    "durs": [],
})

# MQL: созданные в Pre Sale
for r in rows:
    if r["IS_PRESALE"] and r["DC"] and r["DC"].year == YEAR:
        src_data[r["SRC"]]["mql"] += 1

# SQL: выигранные в Pre Sale
for r in rows:
    if r["IS_PRESALE"] and r["SEM"] == "S" and r["CL"] and r["CL"].year == YEAR:
        src_data[r["SRC"]]["sql"] += 1

# Оплаченные (без КОМ): поступления, сделки, срок WON
for r in rows:
    if pay_ytd(r) and not r["IS_KOM"]:
        src_data[r["SRC"]]["postupleniya"] += r["OPP"]
        src_data[r["SRC"]]["deals"] += 1
        if r["DC"] and r["CL"]:
            d = (r["CL"] - r["DC"]).days
            if d >= 0:
                src_data[r["SRC"]]["durs"].append(d)
        # Поступления этой недели
        pd_src = get_pay_date(r)
        if pd_src and pd_src.isocalendar()[:2] == (YEAR, cur_w):
            src_data[r["SRC"]]["postupleniya_week"] += r["OPP"]

# Лиды
for l in leads:
    d = parse_dt(l.get("DATE_CREATE"))
    if d and d.year == YEAR:
        sname = sources_map.get(l.get("SOURCE_ID", "") or "", "—")
        src_data[sname]["leads"] += 1

def src_item(name, d):
    avg_check = d.get("postupleniya", 0) / d.get("deals", 0) if d.get("deals", 0) else 0
    durs = d.get("durs", [])
    avg_dur = sum(durs) / len(durs) if durs else 0
    conv_mql_sql = d.get("sql", 0) / d.get("mql", 0) * 100 if d.get("mql", 0) else 0
    conv_sql_deals = d.get("deals", 0) / d.get("sql", 0) * 100 if d.get("sql", 0) else 0
    conv_lead_deals = d.get("deals", 0) / d.get("leads", 0) * 100 if d.get("leads", 0) else 0
    return {
        "name": name,
        "postupleniya": d.get("postupleniya", 0),
        "deals": d.get("deals", 0),
        "mql": d.get("mql", 0),
        "sql": d.get("sql", 0),
        "postupleniya_week": d.get("postupleniya_week", 0),
        "leads": d.get("leads", 0),
        "avg_check": round(avg_check),
        "avg_won_days": round(avg_dur, 1),
        "conv_mql_sql": round(conv_mql_sql, 1),
        "conv_sql_deals": round(conv_sql_deals, 1),
        "conv_lead_deals": round(conv_lead_deals, 1),
    }

src_list = sorted([src_item(k, v) for k, v in src_data.items()],
                   key=lambda x: -x["postupleniya"])
# Сводная строка — считаем по всем данным
all_durs = []
for r in rows:
    if pay_ytd(r):
        if r["DC"] and r["CL"]:
            d = (r["CL"] - r["DC"]).days
            if d >= 0:
                all_durs.append(d)

total_row = src_item("📊 ИТОГО", {
    "postupleniya": sum(s["postupleniya"] for s in src_list),
    "deals": sum(s["deals"] for s in src_list),
    "mql": sum(s["mql"] for s in src_list),
    "sql": sum(s["sql"] for s in src_list),
    "postupleniya_week": sum(s["postupleniya_week"] for s in src_list),
    "leads": sum(s["leads"] for s in src_list),
    "durs": all_durs,
})
src_rating = [total_row] + src_list[:20]

# === B2B / B2C ===
def bsplit(subset, period_label):
    g = defaultdict(lambda: {"cnt": 0, "sum": 0.0})
    for r in subset:
        if is_paid(r):
            g[r["BTYPE"]]["cnt"] += 1
            g[r["BTYPE"]]["sum"] += r["OPP"]
    return {"period": period_label, **{k: v for k, v in g.items()}}


btype_ytd  = bsplit([r for r in rows if pay_ytd(r)], "YTD")
btype_prev = bsplit(ws_prev, f"W{prev_w}")
btype_cur  = bsplit(ws_cur,  f"W{cur_w}")

# === Форматы ===
def fsplit(subset, period):
    g = defaultdict(lambda: {"cnt": 0, "sum": 0.0})
    for r in subset:
        if is_paid(r):
            if r["IS_REAL"] or r["IS_KOM"]:
                g[r["FORMAT"]]["cnt"] += 1
                g[r["FORMAT"]]["sum"] += r["OPP"]
    return {"period": period, **{k: v for k, v in g.items()}}


fmt_ytd  = fsplit([r for r in rows if pay_ytd(r)], "YTD")
fmt_prev = fsplit(ws_prev, f"W{prev_w}")

# === ТОП продуктов (80% выручки) ===
prod_data = defaultdict(lambda: {
    "sql": 0, "deals": 0, "sum": 0.0, "durs": [],
})

for r in rows:
    if r["FORMAT"] == "КОМ":
        continue
    key = r["PRODUCT"][:90]
    
    # SQL = все созданные сделки по продукту (весь пайплайн, без КОМ)
    if r["DC"] and r["DC"].year == YEAR and r["OPP"] >= MIN_OPP:
        prod_data[key]["sql"] += 1
    
    # Оплачено по 1С
    if pay_ytd(r):
        prod_data[key]["deals"] += 1
        prod_data[key]["sum"] += r["OPP"]
        if r["DC"] and r["CL"]:
            d = (r["CL"] - r["DC"]).days
            if d >= 0:
                prod_data[key]["durs"].append(d)

def prod_item(name, d):
    avg_check = d["sum"] / d["deals"] if d["deals"] else 0
    durs = d.get("durs", [])
    avg_dur = sum(durs) / len(durs) if durs else 0
    return {
        "name": name,
        "sql": d["sql"],
        "deals": d["deals"],
        "sum": d["sum"],
        "avg_check": round(avg_check),
        "avg_won_days": round(avg_dur, 1),
        "share": 0.0,
        "_durs": durs,
    }

prod_list = sorted(
    [prod_item(k, v) for k, v in prod_data.items()],
    key=lambda x: -x["sum"])

# Вычисляем долю
TOP_N = 20
total_non_kom = sum(p["sum"] for p in prod_list)
selected = []
for p in prod_list:
    p["share"] = round(p["sum"] / total_non_kom * 100, 1) if total_non_kom else 0
    if len(selected) < TOP_N:
        selected.append(p)

# Удаляем служебное поле
for p in selected:
    del p["_durs"]

# Строка «оставшееся»
remaining = prod_list[len(selected):]
rem_sum = sum(p["sum"] for p in remaining)
rem_deals = sum(p["deals"] for p in remaining)
rem_sql = sum(p["sql"] for p in remaining)
rem_durs = []
for p in remaining:
    rem_durs.extend(p["_durs"])

rem_avg_check = rem_sum / rem_deals if rem_deals else 0
rem_avg_dur = sum(rem_durs) / len(rem_durs) if rem_durs else 0

remaining_row = {
    "name": f"📦 Остальные ({len(remaining)} продуктов)",
    "sql": rem_sql,
    "deals": rem_deals,
    "sum": rem_sum,
    "avg_check": round(rem_avg_check),
    "avg_won_days": round(rem_avg_dur, 1),
    "share": round(rem_sum / total_non_kom * 100, 1) if total_non_kom else 0,
}

top_products = selected + [remaining_row]

# === Менеджеры ===
mgr_ytd  = defaultdict(lambda: {"cnt": 0, "sum": 0.0, "lost": 0})
mgr_prev = defaultdict(lambda: {"cnt": 0, "sum": 0.0, "lost": 0})
cat_ytd  = defaultdict(lambda: {"cnt": 0, "sum": 0.0})
for r in rows:
    if r["IS_REAL"]:
        if pay_ytd(r):
            mgr_ytd[r["MGR"]]["cnt"] += 1
            mgr_ytd[r["MGR"]]["sum"] += r["OPP"]
            cat_ytd[r["CAT"]]["cnt"] += 1
            cat_ytd[r["CAT"]]["sum"] += r["OPP"]
            pd_mgr = get_pay_date(r)
            if pd_mgr and pd_mgr.isocalendar()[:2] == (YEAR, prev_w):
                mgr_prev[r["MGR"]]["cnt"] += 1
                mgr_prev[r["MGR"]]["sum"] += r["OPP"]
        elif r["SEM"] == "F" and r["CL"] and r["CL"].year == YEAR:
            mgr_ytd[r["MGR"]]["lost"] += 1
            if r["CL"].date().isocalendar()[:2] == (YEAR, prev_w):
                mgr_prev[r["MGR"]]["lost"] += 1

mgr_leads_ytd  = Counter()
mgr_leads_prev = Counter()
for l in leads:
    d = parse_dt(l.get("DATE_CREATE"))
    if not d or d.year != YEAR:
        continue
    mgr = users.get(str(l.get("ASSIGNED_BY_ID", "")), str(l.get("ASSIGNED_BY_ID", "")))
    mgr_leads_ytd[mgr] += 1
    if d.date().isocalendar()[:2] == (YEAR, prev_w):
        mgr_leads_prev[mgr] += 1


def mgr_row(name, d, leads_cnt):
    w   = d["cnt"]; s = d["sum"]; lo = d["lost"]
    avg = s / w if w else 0
    conv = w / (w + lo) * 100 if (w + lo) else 0
    return {"name": name, "leads": leads_cnt, "won": w, "lost": lo,
            "conv_pct": round(conv, 1), "postupleniya": s, "avg_check": round(avg)}


mgr_top      = sorted([mgr_row(k, v, mgr_leads_ytd[k]) for k, v in mgr_ytd.items()],
                       key=lambda x: -x["postupleniya"])[:30]
mgr_prev_top = sorted([mgr_row(k, v, mgr_leads_prev[k]) for k, v in mgr_prev.items()],
                       key=lambda x: -x["postupleniya"])[:5]
cat_top      = sorted([(k, v["cnt"], v["sum"]) for k, v in cat_ytd.items()], key=lambda x: -x[2])

# === ТОП-20 компаний ===
company_agg = defaultdict(lambda: {"sum": 0.0, "cnt": 0, "last": None})
for r in rows:
    if is_paid(r) and get_pay_year(r) == YEAR:
        cid = cc.get(r["ID"], {}).get("COMPANY_ID", "0")
        if cid and cid != "0":
            pay_dt = get_pay_date(r)
            company_agg[cid]["sum"] += r["OPP"]
            company_agg[cid]["cnt"] += 1
            if pay_dt and (company_agg[cid]["last"] is None or pay_dt > company_agg[cid]["last"]):
                company_agg[cid]["last"] = pay_dt

def company_row(cid, data):
    name = companies.get(cid, "—")
    last_str = data["last"].strftime("%d.%m.%Y") if data["last"] else "—"
    return {
        "id": cid,
        "name": name[:100],
        "sum": data["sum"],
        "cnt": data["cnt"],
        "last_date": last_str,
    }

top_companies = sorted(
    [company_row(cid, data) for cid, data in company_agg.items() if data["sum"] > 0],
    key=lambda x: -x["sum"])[:20]

lead_ytd  = sum(1 for l in leads if (d := parse_dt(l.get("DATE_CREATE"))) and d.year == YEAR)
lead_prev = sum(1 for l in leads if (d := parse_dt(l.get("DATE_CREATE")))
                and d.year == YEAR and d.date().isocalendar()[:2] == (YEAR, prev_w))
lead_cur  = sum(1 for l in leads if (d := parse_dt(l.get("DATE_CREATE")))
                and d.year == YEAR and d.date().isocalendar()[:2] == (YEAR, cur_w))

out = {
    "today": TODAY.isoformat(), "year": YEAR,
    "prev_week": prev_w, "cur_week": cur_w,
    "prev_week_label": week_label(YEAR, prev_w),
    "cur_week_label":  week_label(YEAR, cur_w),
    "min_opp":      MIN_OPP,
    "ytd": m_ytd, "prev": m_prev, "cur": m_cur,
    "kom_ytd": m_kom_ytd, "kom_prev": m_kom_prev, "kom_cur": m_kom_cur,
    "leads_ytd": lead_ytd, "leads_prev": lead_prev, "leads_cur": lead_cur,
    "weeks":       [weekly[w] for w in sorted(weekly.keys())],
    "src_rating":  src_rating,
    "btype_ytd":   btype_ytd,  "btype_prev": btype_prev,  "btype_cur": btype_cur,
    "fmt_ytd":     fmt_ytd,    "fmt_prev":   fmt_prev,
    "top_products": top_products,
    "top_companies": top_companies,
    "mgr_top":      mgr_top,   "mgr_prev_top": mgr_prev_top,
    "by_category":  cat_top,
}
json.dump(out, open(config.AGG_JSON, "w", encoding="utf-8"), ensure_ascii=False, default=str)

print(f"\nYTD основное:   {m_ytd['postupleniya']:,.0f} ₽   {m_ytd['won_relevant_cnt']} сд.")
print(f"YTD КОМ (отд.): {m_kom_ytd['postupleniya']:,.0f} ₽   {m_kom_ytd['won_relevant_cnt']} сд.")
print(f"Лидов YTD: {lead_ytd}")
print(f"\nГотово → {config.AGG_JSON}")
print("Следующий шаг: python build_html.py  (и/или  python build_xlsx.py)")
