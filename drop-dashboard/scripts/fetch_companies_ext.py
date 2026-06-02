"""
fetch_companies_ext.py — выгружает адреса компаний (city) для fallback региона
Сохраняет в companies_ext.json: company_id → { region, city }
"""
import urllib.request, urllib.parse, json, sys, time
sys.path.insert(0, '.')
import config

def call(method, params=None):
    body = urllib.parse.urlencode(params or {}, doseq=True).encode()
    req = urllib.request.Request(config.BASE + method + ".json", data=body, method="POST")
    req.timeout = config.TIMEOUT
    with urllib.request.urlopen(req, timeout=config.TIMEOUT) as r:
        return json.loads(r.read().decode())

# Собираем ID компаний из сделок
deals = json.load(open(config.DEALS_JSON, encoding="utf-8"))
cc = json.load(open(config.CC_JSON, encoding="utf-8"))

company_ids = set()
for d in deals:
    ccinfo = cc.get(d["ID"], {})
    coid = str(ccinfo.get("COMPANY_ID", d.get("COMPANY_ID", "0")))
    if coid != "0":
        company_ids.add(coid)

print(f"Компаний: {len(company_ids)}")
result = {}

for i, coid in enumerate(sorted(company_ids)):
    try:
        r = call('crm.company.get', {
            'ID': coid,
            'select[0]': 'ID',
            'select[1]': 'TITLE',
            'select[2]': 'REG_ADDRESS_CITY',
            'select[3]': 'REG_ADDRESS_COUNTRY',
            'select[4]': 'ADDRESS_CITY',
            'select[5]': 'UF_CRM_1448606105',
            'select[6]': 'UF_CRM_APP_PL_COMPANY_REGION',
            'select[7]': 'UF_CRM_APP_PL_COMPANY_LOCALITY',
            'select[8]': 'UF_CRM_1448611987',
        })
        c = r.get("result")
        if c:
            # Пробуем разные источники региона
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
            
            result[coid] = {
                "title": c.get("TITLE", ""),
                "region": region.strip() if isinstance(region, str) else ""
            }

        if (i+1) % 50 == 0:
            print(f"  {i+1}/{len(company_ids)}...")
            json.dump(result, open(config.CACHE_DIR + "/companies_ext.json", "w", encoding="utf-8"), ensure_ascii=False)

    except Exception as e:
        print(f"  ERROR company {coid}: {e}", file=sys.stderr)

    time.sleep(0.05)

json.dump(result, open(config.CACHE_DIR + "/companies_ext.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"Готово: {len(result)} компаний → companies_ext.json")
