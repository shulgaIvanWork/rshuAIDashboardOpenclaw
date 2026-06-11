"""
fetch_cats.py — быстрая выгрузка сделок ТОЛЬКО по воронкам Sale(0), Pre Sale(8), КОМ Sale(19)
за 2025-2026 годы через старый Bitrix24 REST API (batch-запросами).

Помесячная разбивка для надёжности пагинации.
Запуск: python fetch_cats.py && python merge.py && python analyze.py && python build_html.py
"""
import urllib.request, urllib.parse, json, os, sys, time, shutil
from datetime import datetime, date

import config

BASE = "https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/"
CATEGORIES = [0, 8, 19]
PAGE = 50
BATCH_CMDS = 10
TIMEOUT = 90

SELECT = [
    "ID", "TITLE", "STAGE_ID", "STAGE_SEMANTIC_ID", "CATEGORY_ID",
    "OPPORTUNITY", "CURRENCY_ID", "DATE_CREATE", "DATE_MODIFY",
    "CLOSEDATE", "CLOSED", "ASSIGNED_BY_ID", "SOURCE_ID", "UTM_SOURCE",
    "COMPANY_ID", "CONTACT_ID", "LEAD_ID",
    "UF_DATE_PAY_1C", "UF_CRM_1753341391806",
    "UF_CRM_DATE_START_LEARN", "UF_CRM_DATE_END_LEARN",
    "BEGINDATE",
    "UF_FORMAT", "UF_CRM_1498466811",
]


def http_post(url, data, timeout=TIMEOUT):
    body = urllib.parse.urlencode(data, doseq=True).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def fetch_month(cat_id, year, month):
    """Выгружает все сделки категории за один месяц через batch."""
    month_str = f"{month:02d}"
    
    # Определяем границы месяца
    if month == 12:
        end_date = f"{year+1}-01-01T00:00:00"
    else:
        end_date = f"{year}-{month+1:02d}-01T00:00:00"
    
    start_date = f"{year}-{month_str}-01T00:00:00"
    
    filt = {
        "CATEGORY_ID": cat_id,
        ">=DATE_CREATE": start_date,
        "<DATE_CREATE": end_date,
    }
    
    # Первый запрос — узнаём total
    r = http_post(BASE + "crm.deal.list.json", {
        **filt, "start": 0,
        **{f"select[{i}]": v for i, v in enumerate(SELECT)},
    })
    
    if "result" not in r:
        print(f"  [CAT {cat_id}][{month_str}] ERR: {r.get('error','?')}", file=sys.stderr)
        return {}
    
    all_deals = {}
    total = r.get("total", 0)
    
    for d in r["result"]:
        all_deals[d["ID"]] = d
    
    if total <= PAGE:
        return all_deals
    
    # Батчевые запросы
    start = PAGE
    while start < total:
        chunk = []
        s = start
        while s < total and len(chunk) < BATCH_CMDS:
            chunk.append(s)
            s += PAGE
        
        cmd = {}
        for i, st in enumerate(chunk):
            qs = urllib.parse.urlencode({
                **filt, "start": st, "order[ID]": "ASC",
                **{f"select[{j}]": v for j, v in enumerate(SELECT)},
            }, doseq=True)
            cmd[f"cmd[c{i}]"] = "crm.deal.list?" + qs
        cmd["halt"] = "0"
        
        t0 = time.time()
        r2 = http_post(BASE + "batch.json", cmd)
        res = r2.get("result", {}).get("result", {}) or {}
        
        got = 0
        for i, st in enumerate(chunk):
            arr = res.get(f"c{i}", []) or []
            for d in arr:
                all_deals[d["ID"]] = d
            got += len(arr)
        
        print(f"  [{year}-{month_str}] offsets {chunk[0]}..{chunk[-1]}  got={got}  total={len(all_deals)}/{total}  {time.time()-t0:.1f}s")
        
        start = chunk[-1] + PAGE
        time.sleep(0.1)
    
    return all_deals


def main():
    today = date.today()
    
    print("=" * 60)
    print("ВЫГРУЗКА: Sale(0), Pre Sale(8), КОМ Sale(19)")
    print(f"Период: 2025-01 — {today.year}-{today.month:02d}")
    print("=" * 60)
    
    # Очищаем старые страницы
    for d in [config.PAGES_CREATE, config.PAGES_CLOSE]:
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)
    
    all_deals = {}
    
    for cat_id in CATEGORIES:
        print(f"\n--- Категория {cat_id} ---")
        for year in range(2025, today.year + 1):
            start_month = 1
            end_month = 12 if year < today.year else today.month
            
            for month in range(start_month, end_month + 1):
                deals = fetch_month(cat_id, year, month)
                cnt = len(deals)
                if cnt > 0:
                    print(f"  ✅ [{year}-{month:02d}] {cnt} сделок (уник.)")
                all_deals.update(deals)
    
    print(f"\n{'='*60}")
    print(f"Всего уникальных сделок: {len(all_deals)}")
    print('='*60)
    
    # Сохраняем в pages_CREATE
    outdir = config.PAGES_CREATE
    deals_list = sorted(all_deals.values(), key=lambda d: int(d['ID']))
    batch_size = 1000
    for i in range(0, len(deals_list), batch_size):
        chunk = deals_list[i:i + batch_size]
        json.dump(chunk, open(f"{outdir}/p_{i}.json", "w", encoding="utf-8"), ensure_ascii=False)
    
    print(f"Сохранено {len(deals_list)} сделок → {outdir}/")
    print()
    print("Далее: python merge.py && python analyze.py && python build_html.py")


if __name__ == "__main__":
    main()
