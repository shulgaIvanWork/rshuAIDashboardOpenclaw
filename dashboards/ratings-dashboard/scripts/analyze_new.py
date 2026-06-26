"""
analyze.py — агрегирует данные из deals_2026.json + dicts.json + company_contact.json + leads_pages/.
Результат: agg.json

v2 — поступления считаются по UF_DATE_PAY_1C (факт оплаты из 1С), а не по CLOSEDATE.
"""
import json, glob, re, config, os
from datetime import datetime, date
from collections import defaultdict, Counter

print("== Загружаем данные ==")
deals_raw = json.load(open(config.CACHE_DIR + "/deals_NEW.json", encoding="utf-8"))
dicts     = json.load(open(config.DICTS_JSON, encoding="utf-8"))
cc        = json.load(open(config.CC_JSON,    encoding="utf-8"))

# Компании
companies = {}
try:
    companies = json.load(open(os.path.join(config.CACHE_DIR, "companies.json"), encoding="utf-8"))
    print(f"  Компаний: {len(companies)}")
except Exception as e:
    print(f"  Компании не загружены: {e}")

cats        = dicts["categories"]
users       = dicts["users"]
sources_map = dicts["sources"]

leads = []
for fp in glob.glob(f"{config.LEADS_PAGES}/p_*.json"):
    leads.extend(json.load(open(fp, encoding="utf-8")))
leads = list({l["ID"]: l for l in leads}.values())
print(f"  Сделок: {len(deals_raw)}  Лидов: {len(leads)}")

# Ограничение периода: до прошлого воскресенья 07.06.2026 для сверки
# Для продакшена: date.today()
TODAY = date.today()
YEAR  = config.YEAR
MIN_OPP = config.MIN_OPP

# --- Новая логика ООМ/КОМ ---
# Признаки КОМ (любой из): галочка, формат, направление, категория, тип обучения
KOM_UF_FLAG      = 'UF_CRM_1683882427069'  # boolean "КОМ"
KOM_FORMAT_ID    = '19042498'              # UF_FORMAT = КОМ
KOM_DIRECTION_ID = '1906'                  # UF_CRM_1498466811 = Корпоративное обучение
KOM_CATEGORY     = 19                      # Категория "КОМ (Sale)"
KOM_TRAINING_ID  = '34765'                # UF_CRM_1765896709800 = КОМ

EXCLUDE_CATS = {"Post Sale", "Отказы"}
PRE_SALE_CAT = "Pre Sale"

# Только эти категории участвуют в расчётах
VALID_CATS = {0, 8, 19}

# Стадии Sale для MQL+
MQL_STAGES = {'UC_4RJOR4', 'DETAILS', 'PROPOSAL', '2', '6', 'WON', 'LOSE', 
             'UC_F2YC3N', 'UC_VKPN0N', 'UC_W6SCHG'}
# Стадии Sale для SQL+
SQL_STAGES = {'DETAILS', 'PROPOSAL', '2', '6', 'WON', 'LOSE', 'UC_F2YC3N'}
# Стадии Счёт отправлен+
INVOICE_STAGES = {'PROPOSAL', '2', '6', 'WON', 'LOSE', 'UC_F2YC3N'}

# Источники: внутренняя база (исходящие)
INTERNAL_SOURCES_KEYWORDS = ['аккаунтинг', 'репитсейл', 'реанимаци', 'холодн', 'апсейл',
                            'repeat', 'accounting', 'up', 'upsale']

# Менеджеры: исключения
EXCLUDED_MANAGER_IDS = {'1', '27119', '21286'}  # James Bond, Кулевцова, Афанасьев
AUTOPAY_MANAGER_IDS = {'527', '516'}  # Щеткина, Гайдукова → "Автооплаты"
AUTOPAY_NAME = "Автооплаты"


def parse_dt(s):
    if not s:
        return None
    formats = [
        (19, "%Y-%m-%dT%H:%M:%S"),
        (10, "%Y-%m-%d"),
        (19, "%d.%m.%Y %H:%M:%S"),
        (10, "%d.%m.%Y"),
    ]
    for slice_len, fmt in formats:
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


# --- Новая логика: определение КОМ ---
def is_kom_deal(x):
    """Проверяет, относится ли сделка к КОМ по любому из 5 признаков."""
    # 1. Галочка КОМ
    if x.get(KOM_UF_FLAG) in ('Y', '1', True):
        return True
    # 2. Формат = КОМ
    if str(x.get('UF_FORMAT', '')) == KOM_FORMAT_ID:
        return True
    # 3. Направление = Корпоративное обучение
    direction = x.get('UF_CRM_1498466811', []) or []
    if KOM_DIRECTION_ID in direction or KOM_DIRECTION_ID in [str(d) for d in direction]:
        return True
    # 4. Категория = 19
    if int(x.get('CATEGORY_ID', 0)) == KOM_CATEGORY:
        return True
    # 5. Тип обучения = КОМ
    training_type = str(x.get('UF_CRM_1765896709800', ''))
    if training_type == KOM_TRAINING_ID:
        return True
    return False


# --- Новая логика: источник входящий/внутренняя база ---
def is_internal_source(name):
    """Проверяет, относится ли источник к внутренней базе (исходящие продажи)."""
    if not name:
        return False
    nl = name.lower()
    for kw in INTERNAL_SOURCES_KEYWORDS:
        if kw in nl:
            return True
    return False


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


def detect_format(title, uf_format):
    """Формат: приоритет UF_FORMAT, fallback по названию."""
    fmt_map = {
        '19042467': 'ООМ (Очное)', '19042468': 'ОМ (Онлайн)',
        '19042469': 'СДО', '19042498': 'КОМ',
        '19042495': 'MMBA', '19042497': 'Вечерний', '19042496': 'ГК',
    }
    if uf_format and str(uf_format) in fmt_map:
        return fmt_map[str(uf_format)]
    t = (title or "").lower()
    if "(сдо)" in t or " сдо" in t or t.endswith("сдо"):
        return "СДО"
    if "онлайн" in t:
        return "ОМ (Онлайн)"
    if "в г." in t or "москва" in t:
        return "ООМ (Очное)"
    return "ОМ (Онлайн)"


def detect_b2b(did):
    """B2B только по COMPANY_ID."""
    c = cc.get(did, {})
    return "B2B" if c.get("COMPANY_ID", "0") != "0" else "B2C"


def is_paid(r):
    """Оплата: только UF_DATE_PAY_1C (дата из 1С) + сумма > 0. Без WON, без CLOSEDATE."""
    if r["OPP"] < MIN_OPP:
        return False
    if r.get("PAY_DT") is not None:
        return True
    return False


def is_return(r):
    """Возврат: UF_DATE_PAY_1C + LOSE + >0."""
    if r["OPP"] < MIN_OPP:
        return False
    if r["SEM"] != "F":
        return False
    return r.get("PAY_DT") is not None


print("== Обогащаем сделки ==")
rows = []
for x in deals_raw:
    cat = cats.get(str(x.get("CATEGORY_ID", "0")), str(x.get("CATEGORY_ID", "0")))
    opp = float(x.get("OPPORTUNITY") or 0)
    pay_dt = parse_dt(x.get("UF_DATE_PAY_1C"))
    STAGE_ID = x.get("STAGE_ID", "")
    
    raw_sem = x.get("STAGE_SEMANTIC_ID")
    
    # Определяем КОМ по 5 признакам
    is_kom = is_kom_deal(x)
    
    rows.append({
        "ID":        x["ID"],
        "TITLE":     x.get("TITLE", ""),
        "OPP":       opp,
        "SEM":       raw_sem,
        "STAGE":     STAGE_ID,
        "DC":        parse_dt(x.get("DATE_CREATE")),
        "CL":        parse_dt(x.get("CLOSEDATE")),
        "PAY_DT":    pay_dt,          # дата оплаты из 1С
        "CLOSED":    x.get("CLOSED"),
        "MGR":       users.get(str(x.get("ASSIGNED_BY_ID", "")), x.get("ASSIGNED_BY_ID", "")),
        "MGR_ID":    str(x.get("ASSIGNED_BY_ID", "")),
        "CAT":       cat,
        "CAT_ID":    int(x.get("CATEGORY_ID", 0)),
        "SRC":       sources_map.get(x.get("SOURCE_ID") or "", x.get("SOURCE_ID") or "—"),
        "SRC_ID":    x.get("SOURCE_ID", ""),
        "FORMAT":    detect_format(x.get("TITLE", ""), x.get("UF_FORMAT", "")),
        "UF_FORMAT": str(x.get("UF_FORMAT", "")),
        "COMPANY_ID": str(x.get("COMPANY_ID", "0")),
        "BTYPE":     detect_b2b(x["ID"]),
        "PRODUCT":   normalize_product(x.get("TITLE", "")),
        "IS_KOM":    is_kom,
        "IS_OOM":    not is_kom,
        "IS_PRESALE": cat == PRE_SALE_CAT,
        "IS_INTERNAL_SRC": is_internal_source(x.get("SOURCE_ID", "") or sources_map.get(x.get("SOURCE_ID", ""), "")),
        "UF_DATE_PAY_1C": x.get("UF_DATE_PAY_1C", ""),
        "UF_CRM_1753272713011": x.get("UF_CRM_1753272713011", ""),  # Дата Счет отправлен
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
    if not is_paid(r):
        return None
    if r.get("PAY_DT"):
        return r["PAY_DT"].year
    return None

def get_pay_date(r):
    if not is_paid(r):
        return None
    if r.get("PAY_DT"):
        return r["PAY_DT"].date()
    return None

def pay_ytd(r):
    """Сделка оплачена в отчётном году."""
    return get_pay_year(r) == YEAR


def metrics(subset, is_kom_block=False, is_oom_block=False):
    if is_oom_block:
        # ООМ = не КОМ И категория 0|8|19
        pred = lambda r: r["IS_OOM"] and r["CAT_ID"] in VALID_CATS
    elif is_kom_block:
        pred = lambda r: r["IS_KOM"]
    else:
        # Основная строка — только категории 0|8|19
        pred = lambda r: r["CAT_ID"] in VALID_CATS
    paid = [r for r in subset if is_paid(r) and pred(r) and r["PAY_DT"].year == YEAR]
    pos_sum = sum(r["OPP"] for r in paid)
    pos_cnt = len(paid)
    avg     = pos_sum / pos_cnt if pos_cnt else 0
    chs     = sorted(r["OPP"] for r in paid)
    med     = chs[len(chs) // 2] if chs else 0
    mx      = max((r["OPP"] for r in paid), default=0)

    # Длительность от создания до оплаты (по UF_DATE_PAY_1C)
    dur_pairs = [((r["PAY_DT"] - r["DC"]).days, r["OPP"]) for r in paid
                if r["DC"] and r["PAY_DT"] and (r["PAY_DT"] - r["DC"]).days >= 0]
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
        "min_check": min(chs) if chs else 0,
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


# Для prev/cur — строго по дате оплаты, а не через week_subset
ws_prev_pay = [r for r in rows if get_pay_date(r) and get_pay_date(r).isocalendar()[:2] == (YEAR, prev_w)]
ws_cur_pay  = [r for r in rows if get_pay_date(r) and get_pay_date(r).isocalendar()[:2] == (YEAR, cur_w)]
m_prev     = metrics(ws_prev_pay)
m_cur      = metrics(ws_cur_pay)
m_kom_prev = metrics(ws_prev_pay, is_kom_block=True)
m_kom_cur  = metrics(ws_cur_pay,  is_kom_block=True)
# ООМ cur/prev — тоже по оплате
m_oom_prev = metrics(ws_prev_pay, is_oom_block=True)
m_oom_cur  = metrics(ws_cur_pay,  is_oom_block=True)
m_oom_ytd  = metrics(ytd_subset, is_oom_block=True)


MQL_SALE_STAGES_W = {'UC_4RJOR4', 'DETAILS', 'PROPOSAL', '2', '6', 'WON', 'LOSE',
                     'UC_F2YC3N', 'UC_VKPN0N', 'UC_W6SCHG', 'UC_670ME2'}
NOT_MQL_SALE_W = {'NEW', 'UC_1YW3V2', 'UC_STZB49', 'UC_838R2R'}
def is_qual_lead_w(r):
    if r["CAT_ID"] not in VALID_CATS:
        return False
    if r["SEM"] == "S" and r["OPP"] < MIN_OPP:
        return False
    if r["CAT_ID"] == 0:
        st = r.get("STAGE")
        if st in NOT_MQL_SALE_W:
            return False
        if st in MQL_SALE_STAGES_W:
            return True
        return False
    if r["CAT_ID"] == 19:
        if r["SEM"] == "S":
            return False
        if r["SEM"] == "F":
            return False
        return True
    return False

# Все лиды = созданные сделки (не crm.lead)
# Только категории 0|8|19, без тех.нулевых WON, без WON-копий в 8|19
def is_all_lead(r):
    if r["CAT_ID"] not in VALID_CATS:
        return False
    if r["SEM"] == "S" and r["OPP"] < MIN_OPP:
        return False  # тех.нулевые WON
    if r["CAT_ID"] in (8, 19) and r["SEM"] == "S":
        return False  # WON-копии при переходе в Sale
    return True

# Лиды отдельно для ООМ и КОМ (без тех.сделок)
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
        "kom_postupleniya": 0.0, "kom_won_cnt": 0, "invoice_cnt": 0,
        "fmt_oom": 0.0, "fmt_om": 0.0, "fmt_sdo": 0.0, "fmt_kom": 0.0,
        "presale_durs": [],
        "oom_durs": [], "kom_durs": [],
    }

for r in rows:
    # created_cnt/created_sum — по дате создания
    if r["IS_OOM"]:
        if r["DC"] and r["DC"].year >= 2024:
            wk = r["DC"].date().isocalendar()[1]
            if wk in weekly and r["OPP"] >= MIN_OPP:
                weekly[wk]["created_cnt"]  += 1
                weekly[wk]["created_sum"]  += r["OPP"]

    # lost_cnt — по дате закрытия проигрыша
    if r["IS_OOM"] and r["CL"] and r["CL"].year == YEAR and r["CLOSED"] == "Y":
        wk = r["CL"].date().isocalendar()[1]
        if wk in weekly and r["SEM"] == "F":
            weekly[wk]["lost_cnt"] += 1

    # Счёт отправлен — по UF_CRM_1753272713011 (дата счёт отправлен)
    if r.get("UF_CRM_1753272713011"):
        inv_date = parse_dt(r.get("UF_CRM_1753272713011"))
        if inv_date and inv_date.year == YEAR:
            wk = inv_date.date().isocalendar()[1]
            if wk in weekly and not r["IS_KOM"]:
                weekly[wk]["invoice_cnt"] += 1

    # postupleniya / won_cnt / oplata — по дате оплаты, только 0|8|19
    if pay_ytd(r) and r["CAT_ID"] in VALID_CATS:
        pd = get_pay_date(r)
        if pd:
            wk = pd.isocalendar()[1]
        else:
            wk = None
        if wk and wk in weekly:
            weekly[wk]["postupleniya"] += r["OPP"]
            weekly[wk]["oplata"] += 1  # все оплаты (ООМ + КОМ)
            if r["IS_KOM"]:
                weekly[wk]["kom_postupleniya"] += r["OPP"]
                weekly[wk]["kom_won_cnt"]       += 1
            else:
                weekly[wk]["won_cnt"]       += 1
            # По форматам
            fmt_keys = {"ООМ (Очное)": "fmt_oom", "ОМ (Онлайн)": "fmt_om", "СДО": "fmt_sdo", "КОМ": "fmt_kom"}
            if r["FORMAT"] in fmt_keys:
                weekly[wk][fmt_keys[r["FORMAT"]]] += r["OPP"]
            # Длительность по PAY_DT (UF_DATE_PAY_1C), не по CLOSEDATE
            if r["DC"] and r["PAY_DT"]:
                d = (r["PAY_DT"] - r["DC"]).days
                if d >= 0:
                    weekly[wk]["durs"].append(d)          # все сделки (ООМ + КОМ)
                    if r["IS_KOM"]:
                        weekly[wk]["kom_durs"].append(d)   # КОМ отдельно
                    else:
                        weekly[wk]["oom_durs"].append(d)   # ООМ отдельно

    # MQL = is_qual_lead (как в карточке 2), по DATE_CREATE
    if r["DC"] and r["DC"].year == YEAR and is_qual_lead_w(r):
        wk = r["DC"].date().isocalendar()[1]
        if wk in weekly:
            weekly[wk]["mql"] += 1

    # SQL = сделки на стадиях DETAILS+ или со счётом
    # Стадии где точно прошли SQL: DETAILS, PROPOSAL, 2, 6, WON
    # Остальные — только если есть UF_CRM_1753272713011 (дата счёт)
    # КОМ (кат 19) — считается SQL
    stage_code = r.get("STAGE")
    has_invoice = r.get("UF_CRM_1753272713011")
    is_sql = False
    if stage_code in ("DETAILS", "PROPOSAL", "2", "6", "WON"):
        is_sql = True
    elif r["CAT_ID"] == 19 and r["SEM"] != "S":
        # КОМ SQL: точно (EXECUTING, C670BC, I443UQ) или серые зоны с UF_CRM_5D133690E1
        kom_stage = (stage_code or '').replace('C19:','')
        kom_has_calc = r.get("UF_CRM_5D133690E1")
        if kom_stage in ("EXECUTING", "UC_C670BC", "UC_I443UQ"):
            is_sql = True
        elif kom_has_calc and kom_stage in ("UC_ALOZ6B", "UC_W4ML6H", "LOSE"):
            is_sql = True
    elif has_invoice and stage_code in ("LOSE", "UC_F2YC3N", "UC_W6SCHG", "UC_670ME2", "UC_VKPN0N"):
        is_sql = True
    
    if is_sql and r["DC"] and r["DC"].year == YEAR:
        wk = r["DC"].date().isocalendar()[1]
        if wk in weekly:
            weekly[wk]["sql"] += 1
    
    # Pre Sale duration: WON в PreSale = переход в Sale
    if r["IS_PRESALE"] and r["SEM"] == "S" and r["CL"] and r["CL"].year == YEAR:
        if r["DC"]:
            d = (r["CL"] - r["DC"]).days
            if d >= 0:
                wk = r["CL"].date().isocalendar()[1]
                if wk in weekly:
                    weekly[wk]["presale_durs"].append(d)

# === Новые функции для воронки ===
MQL_SALE_STAGES_W = {'UC_4RJOR4', 'DETAILS', 'PROPOSAL', '2', '6', 'WON', 'LOSE',
                     'UC_F2YC3N', 'UC_VKPN0N', 'UC_W6SCHG', 'UC_670ME2'}
NOT_MQL_SALE_W = {'NEW', 'UC_1YW3V2', 'UC_STZB49', 'UC_838R2R'}


for r in rows:

    if r["DC"] and r["DC"].year == YEAR and is_all_lead(r):
        wk = r["DC"].date().isocalendar()[1]
        if wk in weekly:
            weekly[wk]["leads"] += 1

for w, d in weekly.items():
    d["avg_check"]       = d["postupleniya"] / d["won_cnt"] if d["won_cnt"] else 0
    d["avg_dur"]         = sum(d["durs"])        / len(d["durs"])        if d["durs"]        else 0
    d["oom_avg_dur"]     = sum(d["oom_durs"])    / len(d["oom_durs"])    if d["oom_durs"]    else 0
    d["kom_avg_dur"]     = sum(d["kom_durs"])    / len(d["kom_durs"])    if d["kom_durs"]    else 0
    d["avg_presale_dur"] = sum(d["presale_durs"]) / len(d["presale_durs"]) if d["presale_durs"] else 0
    d["conv_lead_mql"]   = d["mql"]    / d["leads"]  * 100 if d["leads"]  else 0
    d["conv_mql_sql"]    = d["sql"]    / d["mql"]    * 100 if d["mql"]    else 0
    d["conv_sql_invoice"]= d["invoice_cnt"] / d["sql"] * 100 if d["sql"] else 0
    d["conv_sql_oplata"]  = d["oplata"] / d["sql"]    * 100 if d["sql"]    else 0
    d["conv_invoice_oplata"] = d["oplata"] / d["invoice_cnt"] * 100 if d["invoice_cnt"] else 0
    del d["durs"]
    del d["oom_durs"]
    del d["kom_durs"]
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
        if r["DC"] and r["PAY_DT"]:
            d = (r["PAY_DT"] - r["DC"]).days
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
btype_prev = bsplit(ws_prev_pay, f"W{prev_w}")
btype_cur  = bsplit(ws_cur_pay,  f"W{cur_w}")

# === Форматы ===
def fsplit(subset, period):
    g = defaultdict(lambda: {"cnt": 0, "sum": 0.0})
    for r in subset:
        if is_paid(r):
            if r["IS_OOM"] or r["IS_KOM"]:
                g[r["FORMAT"]]["cnt"] += 1
                g[r["FORMAT"]]["sum"] += r["OPP"]
    return {"period": period, **{k: v for k, v in g.items()}}


fmt_ytd  = fsplit([r for r in rows if pay_ytd(r)], "YTD")
fmt_prev = fsplit(ws_prev_pay, f"W{prev_w}")

# === Тип обучения (UF_CRM_1765896709800) ===
EDU_TYPE_MAP = {
    '34699': 'Повышение квалификации',
    '34700': 'Проф. переподготовка',
    '34765': 'Корпоративное обучение',
}

def extract_edu_type(uf_val):
    if not uf_val:
        return None
    return EDU_TYPE_MAP.get(str(uf_val).strip(), None)

def edusplit(subset, period):
    g = defaultdict(lambda: {"cnt": 0, "sum": 0.0})
    for r in subset:
        if is_paid(r):
            if r["IS_OOM"] or r["IS_KOM"]:
                edu = extract_edu_type(r.get("UF_CRM_1765896709800", ""))
                if edu:
                    g[edu]["cnt"] += 1
                    g[edu]["sum"] += r["OPP"]
    return {"period": period, **{k: v for k, v in g.items()}}

edu_ytd  = edusplit([r for r in rows if pay_ytd(r)], "YTD")
edu_prev = edusplit(ws_prev_pay, f"W{prev_w}")
edu_cur  = edusplit(ws_cur_pay,  f"W{cur_w}")

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
        if r["DC"] and r["PAY_DT"]:
            d = (r["PAY_DT"] - r["DC"]).days
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

# === Менеджеры: Потоковая модель + Этапы воронки ===

# Группы менеджеров
MGR_GROUPS = {
    '1': 'bond',          # James Bond
    '513': 'main',        # Михаил Зеленов
    '527': 'autopay',     # Дарья Щеткина
    '516': 'autopay',     # Ольга Гайдукова
    '528': 'main',        # Ольга Пономарева
    '12482': 'main',      # Виктория Фефелова
    '20588': 'hidden',    # Гарри Лучин — уволен
    '21286': 'afanasyev', # Дмитрий Афанасьев — лид-менеджер
    '27015': 'main',      # Сергей Иванушкин
    '19823': 'tech',      # Милана Касабян — ОЗК тех
    '26192': 'hidden',    # Татьяна Фролова — уволен
    '27163': 'main',      # Денис Дубаневич
    '27119': 'tech',      # Мария Кулевцова — ОЗК тех
    '26343': 'hidden',    # Александр Замулко — уволен
    '26161': 'hidden',    # Ольга Пайтерова — уволен
    '27158': 'main',      # Андрей Ермолов
    '27157': 'hidden',    # Татьяна Горохова — уволен
    '586': 'tech',        # Анастасия Боброва — КОМ тех
    '515': 'hidden',      # Дарья Рукина — уволен
    '517': 'hidden',      # Анна Поцелуева — уволен
    '23840': 'hidden',    # Сусанна Новосардова — уволен
    '23715': 'hidden',    # Татьяна Анисимова — уволен
    '23251': 'hidden',    # Дарья Иванова — уволен
    '25557': 'hidden',    # Анна Голубь — уволен
    '24984': 'hidden',    # Александр Елумеев — уволен
    '24620': 'hidden',    # Михаил Баранов — уволен
    '23296': 'hidden',    # astafieva@uprav.ru — уволен
    '24688': 'hidden',    # Игорь Сапожников — уволен
    '5274': 'tech',       # Елена Ткаченко — КОМ тех
    '22275': 'tech',      # Виктория Баканова — КОМ тех
    '25474': 'hidden',    # Алёна Галкина — уволен
}

YEAR_START = datetime(YEAR, 1, 1).date()

mgr_data = defaultdict(lambda: {
    "in_work_start": 0, "in_work_start_sum": 0.0,
    "created": 0, "created_sum": 0.0,
    "paid": 0, "paid_sum": 0.0,
    "lost": 0,
    "durs": [],
    "leads": 0,
    "mql": 0, "sql": 0, "invoice_cnt": 0,
    "group": "",
    # срезы для оплаченных
    "b2b_sum": 0.0, "b2c_sum": 0.0,
    "src_int_sum": 0.0, "src_mkt_sum": 0.0,
    "fmt_oom_sum": 0.0, "fmt_om_sum": 0.0, "fmt_sdo_sum": 0.0,
    "edu_pk_sum": 0.0, "edu_pp_sum": 0.0, "edu_kom_sum": 0.0,
})

for r in rows:
    mgr_id = str(r.get("MGR_ID", ""))
    group = MGR_GROUPS.get(mgr_id, 'hidden')
    
    if group == 'hidden':
        mgr_key = 'Прочие'
        group = 'other'
    elif group == 'autopay':
        mgr_key = 'Автооплаты'
    else:
        mgr_key = r["MGR"]
    mgr = r["MGR"]
    cat = r["CAT_ID"]
    if cat not in VALID_CATS:
        continue
    opp = r["OPP"]
    if opp < MIN_OPP:
        continue
    dc = r["DC"]
    pay = r["PAY_DT"]
    cl = r["CL"]
    sem = r["SEM"]
    
    d = mgr_data[mgr_key]
    d["group"] = group
    d["name"] = mgr_key
    if group not in ('autopay', 'other'):
        d["_mgr"] = mgr  # сохраняем оригинальное имя для mgr_row
    
    # Создано в 2026
    if dc and dc.year == YEAR:
        d["created"] += 1
        d["created_sum"] += opp
    
    # Оплачено в 2026
    if is_paid(r) and pay and pay.year == YEAR:
        d["paid"] += 1
        d["paid_sum"] += opp
        if dc and pay:
            dur = (pay - dc).days
            if dur >= 0:
                d["durs"].append(dur)
        # срезы
        if r.get("BTYPE") == "B2B":
            d["b2b_sum"] += opp
        else:
            d["b2c_sum"] += opp
        if is_internal_source(r.get("SRC", "")):
            d["src_int_sum"] += opp
        else:
            d["src_mkt_sum"] += opp
        fmt = r.get("FORMAT", "")
        if fmt == "Очный" or fmt == "ООМ (Очное)":
            d["fmt_oom_sum"] += opp
        elif fmt == "Онлайн" or fmt == "ОМ (Онлайн)":
            d["fmt_om_sum"] += opp
        elif fmt == "Видеокурс" or fmt == "СДО":
            d["fmt_sdo_sum"] += opp
        edu = extract_edu_type(r.get("UF_CRM_1765896709800", ""))
        if edu == "Повышение квалификации":
            d["edu_pk_sum"] += opp
        elif edu == "Проф. переподготовка":
            d["edu_pp_sum"] += opp
        elif edu == "Корпоративное обучение":
            d["edu_kom_sum"] += opp
    
    # Проиграно в 2026
    if sem == "F" and cl and cl.year == YEAR:
        d["lost"] += 1
    
    # В работе на начало года
    if dc and dc.date() <= YEAR_START:
        was_paid_before = pay and pay.date() < YEAR_START
        was_lost_before = (sem == "F" and cl and cl.date() < YEAR_START)
        if not was_paid_before and not was_lost_before:
            d["in_work_start"] += 1
            d["in_work_start_sum"] += opp
    
    # MQL: квалифицированные лиды (по is_qual_lead_w — любые категории 0|8|19, не NEW)
    if dc and dc.year == YEAR and is_qual_lead_w(r):
        d["mql"] += 1
    
    # SQL: полная логика как в управленческом
    stage_code = r.get("STAGE")
    has_invoice = r.get("UF_CRM_1753272713011")
    is_sql = False
    if stage_code in ("DETAILS", "PROPOSAL", "2", "6", "WON"):
        is_sql = True
    elif cat == 19 and sem != "S":
        kom_stage = (stage_code or '').replace('C19:','')
        kom_has_calc = r.get("UF_CRM_5D133690E1")
        if kom_stage in ("EXECUTING", "UC_C670BC", "UC_I443UQ"):
            is_sql = True
        elif kom_has_calc and kom_stage in ("UC_ALOZ6B", "UC_W4ML6H", "LOSE"):
            is_sql = True
    elif has_invoice and stage_code in ("LOSE", "UC_F2YC3N", "UC_W6SCHG", "UC_670ME2", "UC_VKPN0N"):
        is_sql = True
    
    if is_sql and dc and dc.year == YEAR:
        d["sql"] += 1
    
    # Счёт: есть UF_CRM_1753272713011, не LOSE
    inv_dt = r.get("UF_CRM_1753272713011")
    if inv_dt:
        inv_parsed = parse_dt(inv_dt)
        if inv_parsed and inv_parsed.year == YEAR and sem != "F":
            d["invoice_cnt"] += 1

# Лиды CRM (crm.lead) — отдельный проход
for l in leads:
    d = parse_dt(l.get("DATE_CREATE"))
    if not d or d.year != YEAR:
        continue
    mgr_id_lead = str(l.get("ASSIGNED_BY_ID", ""))
    group_lead = MGR_GROUPS.get(mgr_id_lead, 'hidden')
    if group_lead == 'hidden':
        continue
    mgr = users.get(mgr_id_lead, mgr_id_lead)
    mgr_key_lead = 'Автооплаты' if group_lead == 'autopay' else mgr
    mgr_data[mgr_key_lead]["leads"] += 1

cat_ytd  = defaultdict(lambda: {"cnt": 0, "sum": 0.0})
for r in rows:
    if pay_ytd(r) and r["IS_OOM"]:
        cat_ytd[r["CAT"]]["cnt"] += 1
        cat_ytd[r["CAT"]]["sum"] += r["OPP"]
cat_top = sorted([(k, v["cnt"], v["sum"]) for k, v in cat_ytd.items()], key=lambda x: -x[2])


def mgr_row(name, d):
    iws = d["in_work_start"]
    cr = d["created"]
    pd = d["paid"]
    pd_sum = d["paid_sum"]
    lo = d["lost"]
    iwe = iws + cr - pd - lo
    avg = pd_sum / pd if pd else 0
    durs = d.get("durs", [])
    avg_dur = sum(durs) / len(durs) if durs else 0
    conv = pd / (pd + lo) * 100 if (pd + lo) else 0
    
    ld = d["leads"]
    mql = d["mql"]
    sql = d["sql"]
    inv = d["invoice_cnt"]
    
    # Конверсии
    conv_lead_mql = mql / ld * 100 if ld else 0
    conv_mql_sql  = sql / mql * 100 if mql else 0
    conv_sql_inv  = inv / sql * 100 if sql else 0
    conv_inv_paid = pd / inv * 100 if inv else 0
    
    return {"name": name, "group": d["group"],
            "in_work_start": iws,
            "created": cr,
            "paid": pd, "paid_sum": round(pd_sum),
            "lost": lo,
            "in_work_end": iwe,
            "leads": ld,
            "mql": mql, "sql": sql, "invoice_cnt": inv,
            "avg_check": round(avg),
            "avg_dur": round(avg_dur, 1),
            "conv_pct": round(conv, 1),
            "conv_lead_mql": round(conv_lead_mql, 1),
            "conv_mql_sql": round(conv_mql_sql, 1),
            "conv_sql_inv": round(conv_sql_inv, 1),
            "conv_inv_paid": round(conv_inv_paid, 1),
            # срезы
            "b2b_sum": round(d["b2b_sum"]), "b2c_sum": round(d["b2c_sum"]),
            "src_int_sum": round(d["src_int_sum"]), "src_mkt_sum": round(d["src_mkt_sum"]),
            "fmt_oom_sum": round(d["fmt_oom_sum"]), "fmt_om_sum": round(d["fmt_om_sum"]), "fmt_sdo_sum": round(d["fmt_sdo_sum"]),
            "edu_pk_sum": round(d["edu_pk_sum"]), "edu_pp_sum": round(d["edu_pp_sum"]), "edu_kom_sum": round(d["edu_kom_sum"]),}


mgr_top = sorted([mgr_row(k, v) for k, v in mgr_data.items()],
                 key=lambda x: (-x["paid_sum"] if x["paid_sum"] else (1 if x["group"] == 'main' else 2)))
mgr_prev_top = []

# === ТОП-20 компаний ===
company_agg = defaultdict(lambda: {"sum": 0.0, "cnt": 0, "last": None})
for r in rows:
    if is_paid(r) and get_pay_year(r) == YEAR:
        cid = str(r.get("COMPANY_ID", "0") or cc.get(r["ID"], {}).get("COMPANY_ID", "0"))
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
        "avg_check": round(data["sum"] / data["cnt"]) if data["cnt"] else 0,
    }

top_companies = sorted(
    [company_row(cid, data) for cid, data in company_agg.items() if data["sum"] > 0],
    key=lambda x: -x["sum"])[:20]

# === MBA / MMBA рейтинг ===
MBA_DIRECTION_IDS = {'1917', '35288'}

def detect_mba_type(title):
    t = (title or '').lower()
    # 1. Micro MBA
    if 'micro' in t or 'микро' in t:
        return 'Micro MBA'
    # 2. MBA Эксперт
    if 'эксперт' in t or 'expert' in t:
        return 'MBA Эксперт'
    # 3. MBA Лидер — "MBA Лидер: Продажи", "MBA Лидер: Финансы"
    if ('лидер' in t or 'leader' in t) and ('mba' in t or 'mmba' in t):
        return 'MBA Лидер'
    # 4. Mini MBA: Классический — именно "Mini MBA: Классический"
    if ('классический' in t or 'classic' in t) and ('mini' in t or 'mmba' in t or 'mba' in t):
        return 'Mini MBA: Классический'
    # 5. Mini MBA: Специализация — Mini MBA: {другие слова} (Продажи, Производство и т.п.)
    if ('mini' in t) and ('mba' in t or 'mmba' in t):
        return 'Mini MBA: Специализация'
    if 'специализация' in t or 'specialization' in t:
        return 'Mini MBA: Специализация'
    # Артефакт
    if 'mba' in t or 'mmba' in t:
        return None
    return None

def has_mba_in_title(title):
    t = (title or '').lower()
    if 'micro' in t or 'микро' in t:
        return True
    if 'эксперт' in t or 'expert' in t:
        return True
    if ('лидер' in t or 'leader' in t) and ('mba' in t or 'mmba' in t):
        return True
    if ('классический' in t or 'classic' in t) and ('mini' in t or 'mmba' in t or 'mba' in t):
        return True
    if ('mini' in t) and ('mba' in t or 'mmba' in t):
        return True
    if 'специализация' in t or 'specialization' in t:
        return True
    return 'mba' in t or 'mmba' in t

mba_rating = defaultdict(lambda: {'cnt': 0, 'sum': 0.0, 'deals': 0})
for r in rows:
    if is_paid(r) and get_pay_year(r) == YEAR:
        is_mba = False
        direction_ids = r.get('UF_CRM_1498466811', [])
        if isinstance(direction_ids, str):
            direction_ids = [direction_ids]
        if any(d in MBA_DIRECTION_IDS for d in direction_ids):
            is_mba = True
        if not is_mba and has_mba_in_title(r['TITLE']):
            is_mba = True
        if is_mba:
            mba_type = detect_mba_type(r['TITLE'])
            if mba_type is None:
                # Артефакт
                continue
            mba_rating[mba_type]['cnt'] += 1
            mba_rating[mba_type]['sum'] += r['OPP']
            mba_rating[mba_type]['deals'] += 1

mba_rating_list = sorted(
    [{'type': k, 'cnt': v['cnt'], 'sum': v['sum'], 'deals': v['deals'], 'avg_check': round(v['sum']/v['cnt']) if v['cnt'] else 0}
     for k, v in mba_rating.items()],
    key=lambda x: -x['sum'])

# === Созданные сделки по категориям (не только оплаченные) ===
created_by_category = defaultdict(lambda: {'cnt': 0})
for r in rows:
    if r['DC'] and r['DC'].year >= 2024 and r['OPP'] >= MIN_OPP:
        created_by_category[r['CAT']]['cnt'] += 1

created_cat_list = [
    [k, v['cnt']]
    for k, v in sorted(created_by_category.items(), key=lambda x: -x[1]['cnt'])]

# Квал лиды (MQL) = Sale (стадии MQL+, без NEW/Аларм/Взят/Консульт, ВКЛ WON) + КОМ (без WON-копий)
# PreSale не входит
# Стадии MQL в Sale: WON считается (это успешные сделки)
MQL_SALE_STAGES = {'UC_4RJOR4', 'DETAILS', 'PROPOSAL', '2', '6', 'WON', 'LOSE',
                   'UC_F2YC3N', 'UC_VKPN0N', 'UC_W6SCHG', 'UC_670ME2'}
# Стадии ДО MQL (не входят)
NOT_MQL_SALE = {'NEW', 'UC_1YW3V2', 'UC_STZB49', 'UC_838R2R'}

def is_qual_lead(r):
    if r["CAT_ID"] not in VALID_CATS:
        return False
    if r["SEM"] == "S" and r["OPP"] < MIN_OPP:
        return False  # тех.нулевые WON
    if r["CAT_ID"] == 0:
        # Sale: стадии MQL+ (ВКЛЮЧАЯ WON), без NEW/Аларм/Взят/Консульт
        if r.get("STAGE") in NOT_MQL_SALE:
            return False
        if r.get("STAGE") in MQL_SALE_STAGES:
            return True
        return False
    if r["CAT_ID"] == 19:
        if r["SEM"] == "S":
            return False  # WON-копии в КОМ = не MQL
        if r["SEM"] == "F":
            return False  # отказы в КОМ = не MKL
        return True  # всё остальное в КОМ = MQL
    return False

# Все лиды = созданные сделки (не crm.lead)
# Только категории 0|8|19, без тех.нулевых WON, без WON-копий в 8|19
def is_all_lead(r):
    if r["CAT_ID"] not in VALID_CATS:
        return False  # только 0|8|19
    if r["SEM"] == "S" and r["OPP"] < MIN_OPP:
        return False  # тех.нулевые WON — не лиды
    if r["CAT_ID"] in (8, 19) and r["SEM"] == "S":
        return False  # WON в PreSale/КОМ = копии
    return True

lead_all_rows = [r for r in rows if r["DC"] and r["DC"].year == YEAR and is_all_lead(r)]
lead_ytd  = len(lead_all_rows)
oom_leads  = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR and is_all_lead(r) and r["IS_OOM"])
kom_leads  = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR and is_all_lead(r) and r["IS_KOM"])

qual_lead_ytd  = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR and is_qual_lead(r))
oom_qual_lead_ytd = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR and is_qual_lead(r) and r["IS_OOM"])
kom_qual_lead_ytd = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR and is_qual_lead(r) and r["IS_KOM"])
lead_prev = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                and r["DC"].date().isocalendar()[:2] == (YEAR, prev_w)
                and is_all_lead(r))
lead_cur  = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                and r["DC"].date().isocalendar()[:2] == (YEAR, cur_w)
                and is_all_lead(r))
oom_lead_prev = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                    and r["DC"].date().isocalendar()[:2] == (YEAR, prev_w)
                    and is_all_lead(r) and r["IS_OOM"])
oom_lead_cur  = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                    and r["DC"].date().isocalendar()[:2] == (YEAR, cur_w)
                    and is_all_lead(r) and r["IS_OOM"])
kom_lead_prev = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                    and r["DC"].date().isocalendar()[:2] == (YEAR, prev_w)
                    and is_all_lead(r) and r["IS_KOM"])
kom_lead_cur  = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                    and r["DC"].date().isocalendar()[:2] == (YEAR, cur_w)
                    and is_all_lead(r) and r["IS_KOM"])
# Недельные MQL
qual_lead_prev = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                     and r["DC"].date().isocalendar()[:2] == (YEAR, prev_w)
                     and is_qual_lead(r))
qual_lead_cur  = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                     and r["DC"].date().isocalendar()[:2] == (YEAR, cur_w)
                     and is_qual_lead(r))
oom_qual_prev = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                    and r["DC"].date().isocalendar()[:2] == (YEAR, prev_w)
                    and is_qual_lead(r) and r["IS_OOM"])
oom_qual_cur  = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                    and r["DC"].date().isocalendar()[:2] == (YEAR, cur_w)
                    and is_qual_lead(r) and r["IS_OOM"])
kom_qual_prev = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                    and r["DC"].date().isocalendar()[:2] == (YEAR, prev_w)
                    and is_qual_lead(r) and r["IS_KOM"])
kom_qual_cur  = sum(1 for r in rows if r["DC"] and r["DC"].year == YEAR
                    and r["DC"].date().isocalendar()[:2] == (YEAR, cur_w)
                    and is_qual_lead(r) and r["IS_KOM"])

out = {
    "today": TODAY.isoformat(), "year": YEAR,
    "prev_week": prev_w, "cur_week": cur_w,
    "prev_week_label": week_label(YEAR, prev_w),
    "cur_week_label":  week_label(YEAR, cur_w),
    "min_opp":      MIN_OPP,
    "ytd": m_ytd, "prev": m_prev, "cur": m_cur,
    "kom_ytd": m_kom_ytd, "kom_prev": m_kom_prev, "kom_cur": m_kom_cur, "oom_ytd": m_oom_ytd, "oom_prev": m_oom_prev, "oom_cur": m_oom_cur,
    "leads_ytd": lead_ytd, "leads_prev": lead_prev, "leads_cur": lead_cur, "qual_lead_ytd": qual_lead_ytd,
    "qual_lead_prev": qual_lead_prev, "qual_lead_cur": qual_lead_cur,
    "oom_leads_ytd": oom_leads, "kom_leads_ytd": kom_leads,
    "oom_qual_lead_ytd": oom_qual_lead_ytd, "kom_qual_lead_ytd": kom_qual_lead_ytd,
    "oom_leads_prev": oom_lead_prev, "oom_leads_cur": oom_lead_cur,
    "kom_leads_prev": kom_lead_prev, "kom_leads_cur": kom_lead_cur,
    "qual_lead_prev": qual_lead_prev, "qual_lead_cur": qual_lead_cur,
    "oom_qual_prev": oom_qual_prev, "oom_qual_cur": oom_qual_cur,
    "kom_qual_prev": kom_qual_prev, "kom_qual_cur": kom_qual_cur,
    "weeks":       [weekly[w] for w in sorted(weekly.keys())],
    "src_rating":  src_rating,
    "btype_ytd":   btype_ytd,  "btype_prev": btype_prev,  "btype_cur": btype_cur,
    "fmt_ytd":     fmt_ytd,    "fmt_prev":   fmt_prev,
    "edu_ytd":     edu_ytd,    "edu_prev":   edu_prev,    "edu_cur": edu_cur,
    "top_products": top_products,
    "top_companies": top_companies,
    "mgr_top":      mgr_top,   "mgr_prev_top": mgr_prev_top,
    "by_category":  cat_top,
    "created_by_category": created_cat_list,
    "mba_rating":   mba_rating_list,
}
import os
agg_new_path = os.path.join(config.CACHE_DIR, 'agg_new.json')
json.dump(out, open(agg_new_path, 'w', encoding='utf-8'), ensure_ascii=False, default=str)

print(f"\nYTD основное:   {m_ytd['postupleniya']:,.0f} ₽   {m_ytd['won_relevant_cnt']} сд.")
print(f"YTD КОМ (отд.): {m_kom_ytd['postupleniya']:,.0f} ₽   {m_kom_ytd['won_relevant_cnt']} сд.")
print(f"Лидов YTD: {lead_ytd}")
print(f"\nГотово → {agg_new_path}")
print("Следующий шаг: обновить вкладку Новая логика в дашборде")
