"""
fetch_contacts_list.py — выгрузка контактов через crm.contact.list (пагинация)
Гораздо быстрее, чем 7500 отдельных GET-запросов.
Сохраняет contacts_ext.json: contact_id → { name, region, locality }
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

# Get all contact IDs from deals
deals = json.load(open(config.DEALS_JSON, encoding="utf-8"))
cc = json.load(open(config.CC_JSON, encoding="utf-8"))

contact_ids = set()
for d in deals:
    ccinfo = cc.get(d["ID"], {})
    cid = str(ccinfo.get("CONTACT_ID", d.get("CONTACT_ID", "0")))
    if cid != "0":
        contact_ids.add(cid)

print(f"Нужно контактов: {len(contact_ids)}")

result = {}
fetched = 0

# Use crm.contact.list with pagination
# We need to fetch ALL contacts from Bitrix (not just known IDs) to get their fields
# Filter by ID range since we can't filter by list
# Actually, let's use crm.contact.list with a start parameter

# Use filter to start from our minimum ID (speed up pagination)
min_id = min(int(c) for c in contact_ids)
max_id = max(int(c) for c in contact_ids)
print(f"ID диапазон: {min_id} - {max_id}")

start = 0
total = None
while True:
    try:
        params = {
            'select[0]': 'ID',
            'select[1]': 'NAME',
            'select[2]': 'LAST_NAME',
            'select[3]': 'SECOND_NAME',
            'select[4]': 'UF_CRM_APP_PL_CONTACT_REGION',
            'select[5]': 'UF_CRM_APP_PL_CONTACT_LOCALITY',
            'select[6]': 'UF_CRM_1448611987',
            'filter[>=ID]': str(min_id),
            'filter[<=ID]': str(max_id),
            'start': start
        }
        r = call('crm.contact.list', params)
        items = r.get('result', [])
        total = r.get('total', len(items))
        
        if not items:
            break
        
        for c in items:
            cid = str(c.get('ID'))
            if cid in contact_ids:
                region = (c.get('UF_CRM_APP_PL_CONTACT_REGION') or '').strip()
                locality = (c.get('UF_CRM_APP_PL_CONTACT_LOCALITY') or '').strip()
                addr = c.get('UF_CRM_1448611987') or ''
                if not region and addr:
                    parts = [p.strip() for p in addr.split(',') if p.strip()]
                    if parts:
                        region = parts[0]
                        if not locality:
                            locality = parts[0]
                last_name   = (c.get('LAST_NAME', '') or '').strip()
                first_name  = (c.get('NAME', '') or '').strip()
                middle_name = (c.get('SECOND_NAME', '') or '').strip()
                full_name   = ' '.join(filter(None, [last_name, first_name, middle_name]))
                result[cid] = {"name": full_name, "region": region, "locality": locality}
                fetched += 1
        
        print(f"  Страница: получено {len(items)} контактов, набрано {fetched} из {total if total else '?'} нужных (start={start})")
        
        # Save every 5 pages or when fetched >= desired
        if fetched % 250 == 0:
            json.dump(result, open(config.CACHE_DIR + "/contacts_ext.json", "w", encoding="utf-8"), ensure_ascii=False)
        
        # Check if there are more pages
        if total and start + len(items) >= total:
            break
        start += len(items)
        time.sleep(0.5)
        
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        time.sleep(5)
        start += 50  # Skip problematic page

print(f"Готово: {len(result)} контактов → contacts_ext.json")
