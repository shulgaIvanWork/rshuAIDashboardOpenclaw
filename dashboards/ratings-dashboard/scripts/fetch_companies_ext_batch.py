"""
fetch_companies_ext_batch.py — быстрая выгрузка адресов компаний через batch API
Сохраняет companies_ext.json: company_id → { title, region }
"""
import urllib.request, urllib.parse, json, sys, time, os
sys.path.insert(0, '.')
import config

BASE = config.BASE

def call(method, params=None):
    body = urllib.parse.urlencode(params or {}, doseq=True).encode()
    req = urllib.request.Request(BASE + method + ".json", data=body, method="POST")
    req.timeout = config.TIMEOUT
    with urllib.request.urlopen(req, timeout=config.TIMEOUT) as r:
        return json.loads(r.read().decode())

def call_batch(commands):
    params = {'halt': 0}
    for i, cmd in enumerate(commands):
        params[f'cmd[{i}]'] = cmd
    r = call('batch', params)
    return r.get("result", {}).get("result", [])

deals = json.load(open(config.DEALS_JSON, encoding="utf-8"))

# Связка сделка→компания (опционально, у сделок уже есть COMPANY_ID)
cc = {}
try:
    cc = json.load(open(config.CC_JSON, encoding="utf-8"))
except Exception as e:
    print(f"  company_contact.json не найден, используем COMPANY_ID из сделок: {e}")

company_ids = set()
for d in deals:
    ccinfo = cc.get(d["ID"], {})
    coid = str(ccinfo.get("COMPANY_ID", d.get("COMPANY_ID", "0")))
    if coid not in ("0", "None"):
        company_ids.add(coid)

print(f"Компаний: {len(company_ids)}")

cext_path = config.CACHE_DIR + "/companies_ext.json"
existing = {}
if os.path.exists(cext_path):
    existing = json.load(open(cext_path, encoding="utf-8"))
    print(f"Уже в кэше: {len(existing)}")

need_fetch = set()
for cid in company_ids:
    if cid not in existing:
        need_fetch.add(cid)
    else:
        if not existing[cid].get("region"):
            need_fetch.add(cid)

print(f"Нужно дозапросить: {len(need_fetch)}")

if not need_fetch:
    print("Всё уже есть.")
    sys.exit(0)

result = dict(existing)
all_ids = sorted(need_fetch, key=int)
BATCH_SIZE = 50
total_batches = (len(all_ids) + BATCH_SIZE - 1) // BATCH_SIZE

for b in range(total_batches):
    chunk = all_ids[b * BATCH_SIZE:(b + 1) * BATCH_SIZE]
    
    cmds = []
    for cid in chunk:
        cmds.append(f'crm.company.get?ID={cid}&select[0]=ID&select[1]=TITLE&select[2]=REG_ADDRESS_CITY&select[3]=REG_ADDRESS_COUNTRY&select[4]=ADDRESS_CITY&select[5]=UF_CRM_1448606105&select[6]=UF_CRM_APP_PL_COMPANY_REGION&select[7]=UF_CRM_APP_PL_COMPANY_LOCALITY&select[8]=UF_CRM_1448611987')
    
    try:
        results = call_batch(cmds)
        for idx, cid in enumerate(chunk):
            c = results[idx] if idx < len(results) else {}
            if c and isinstance(c, dict) and c.get("ID"):
                region = (c.get("REG_ADDRESS_CITY") or 
                          c.get("ADDRESS_CITY") or 
                          c.get("UF_CRM_1448606105") or 
                          c.get("UF_CRM_APP_PL_COMPANY_REGION") or 
                          c.get("UF_CRM_APP_PL_COMPANY_LOCALITY") or "")
                
                addr = c.get("UF_CRM_1448611987") or ""
                if not region and addr:
                    parts = [p.strip() for p in addr.split(",") if p.strip()]
                    if parts:
                        region = parts[0]
                
                # Clean up - ADDRESS_CITY sometimes includes country "Москва, Россия"
                if region:
                    region = region.split(",")[0].strip()
                
                result[cid] = {
                    "title": c.get("TITLE", ""),
                    "region": region
                }
    except Exception as e:
        print(f"  ERROR batch {b+1}/{total_batches}: {e}", file=sys.stderr)
        for cid in chunk:
            result[cid] = {"title": "", "region": ""}
    
    if (b+1) % 10 == 0:
        print(f"  Batch {b+1}/{total_batches} ({len(result)} компаний)...")
        json.dump(result, open(cext_path, "w", encoding="utf-8"), ensure_ascii=False)
    
    time.sleep(0.3)

json.dump(result, open(cext_path, "w", encoding="utf-8"), ensure_ascii=False)
print(f"Готово: {len(result)} компаний → companies_ext.json")
