"""
fetch_fast.py — Быстрая выгрузка сделок параллельными запросами.

Использует concurrent.futures для параллельных HTTP-запросов к API Bitrix24.
Не batch, а N индивидуальных запросов параллельно.
"""
import urllib.request, json, os, sys, time, concurrent.futures
import config

SELECT = [
    "ID","TITLE","STAGE_ID","STAGE_SEMANTIC_ID","CATEGORY_ID",
    "OPPORTUNITY","CURRENCY_ID","DATE_CREATE","CLOSEDATE",
    "CLOSED","ASSIGNED_BY_ID","SOURCE_ID","UTM_SOURCE",
    "COMPANY_ID","CONTACT_ID","LEAD_ID",
    "UF_DATE_PAY_1C","UF_CRM_1753341391806",
    "UF_CRM_DATE_START_LEARN","UF_CRM_DATE_END_LEARN","BEGINDATE",
]
PAGE = 50
WORKERS = 30  # parallel HTTP requests

def build_qs(which, start):
    p = {"start": start, "order[ID]": "ASC"}
    if which == "CREATE":
        p[">=DATE_CREATE"] = f"{config.YEAR}-01-01T00:00:00"
        p["<=DATE_CREATE"] = f"{config.YEAR}-12-31T23:59:59"
    else:
        p[">=CLOSEDATE"] = f"{config.YEAR}-01-01T00:00:00"
        p["<=CLOSEDATE"] = f"{config.YEAR}-12-31T23:59:59"
    for i, f in enumerate(SELECT):
        p[f"select[{i}]"] = f
    return urllib.parse.urlencode(p, doseq=True)

def fetch_page(which, start, outdir):
    """Fetch a single page and save to file."""
    qs = build_qs(which, start)
    url = config.BASE + "crm.deal.list.json"
    data = qs.encode()
    
    try:
        req = urllib.request.Request(url, data=data, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read().decode())
        
        items = resp.get("result", [])
        if items:
            fname = f"p_{start}.json"
            json.dump(items, open(os.path.join(outdir, fname), "w", encoding="utf-8"), ensure_ascii=False)
        
        return (start, len(items), None)
    except Exception as e:
        return (start, 0, str(e))

def fetch_pages(starts, outdir, label, max_workers=WORKERS):
    """Fetch pages in parallel."""
    os.makedirs(outdir, exist_ok=True)
    
    total_pages = len(starts)
    done = 0
    items_total = 0
    errors = 0
    
    print(f"[{label}] Fetching {total_pages} pages, {max_workers} parallel...")
    t0 = time.time()
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_page, label, s, outdir): s for s in starts}
        
        for future in concurrent.futures.as_completed(futures):
            s, cnt, err = future.result()
            done += 1
            items_total += cnt
            if err:
                errors += 1
                if errors <= 5:
                    print(f"  ERR offset={s}: {err}")
            
            if done % 200 == 0 or done == total_pages:
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed > 0 else 0
                print(f"  [{label}] {done}/{total_pages} pages, {items_total} items, "
                      f"{errors} errors, {elapsed:.0f}s, {rate:.1f} pg/s")
    
    elapsed = time.time() - t0
    print(f"[{label}] Done: {done}/{total_pages} pages, {items_total} items, "
          f"{errors} errors, {elapsed:.0f}s")
    return items_total

def get_next_offset(outdir):
    """Find the highest page offset already fetched."""
    max_offset = -PAGE
    if os.path.exists(outdir):
        for f in os.listdir(outdir):
            if f.startswith("p_") and f.endswith(".json"):
                try:
                    off = int(f[2:-5])
                    if off > max_offset:
                        max_offset = off
                except:
                    pass
    return max_offset + PAGE

if __name__ == "__main__":
    # Check total from Bitrix (we already know from state, but verify)
    qs = build_qs("CREATE", 0)
    data = qs.encode()
    req = urllib.request.Request(config.BASE + "crm.deal.list.json", data=data, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read().decode())
    create_total = resp.get("total", 0)
    
    print(f"CREATE total: {create_total} deals")
    
    next_create = get_next_offset(config.PAGES_CREATE)
    remaining_create = create_total - next_create
    
    print(f"CREATE next offset: {next_create}, remaining: {max(0, remaining_create)} items")
    
    if remaining_create > 0:
        starts = list(range(next_create, create_total, PAGE))
        print(f"CREATE pages to fetch: {len(starts)}")
        fetch_pages(starts, config.PAGES_CREATE, "CREATE")
    else:
        print("CREATE already complete!")
    
    # Now CLOSE
    close_state_file = config.STATE_CLOSE
    close_outdir = config.PAGES_CLOSE
    
    # Get CLOSE total
    qs = build_qs("CLOSE", 0)
    data = qs.encode()
    req = urllib.request.Request(config.BASE + "crm.deal.list.json", data=data, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read().decode())
    close_total = resp.get("total", 0)
    
    print(f"\nCLOSE total: {close_total} deals")
    
    next_close = get_next_offset(close_outdir)
    remaining_close = close_total - next_close
    
    print(f"CLOSE next offset: {next_close}, remaining: {max(0, remaining_close)} items")
    
    if remaining_close > 0:
        starts = list(range(next_close, close_total, PAGE))
        print(f"CLOSE pages to fetch: {len(starts)}")
        fetch_pages(starts, close_outdir, "CLOSE")
    else:
        print("CLOSE already complete!")
    
    print("\n✅ All done! Run merge.py next.")
