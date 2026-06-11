"""
fetch_contacts.py — выгружает регионы контактов (простой, без батча)
Сохраняет в contacts_ext.json: contact_id → { name, region, locality }
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

# Собираем ID контактов из сделок
deals = json.load(open(config.DEALS_JSON, encoding="utf-8"))
cc = json.load(open(config.CC_JSON, encoding="utf-8"))

contact_ids = set()
for d in deals:
    ccinfo = cc.get(d["ID"], {})
    cid = str(ccinfo.get("CONTACT_ID", d.get("CONTACT_ID", "0")))
    if cid != "0":
        contact_ids.add(cid)

print(f"Контактов: {len(contact_ids)}")
result = {}

for i, cid in enumerate(sorted(contact_ids)):
    try:
        r = call('crm.contact.get', {
            'ID': cid,
            'select[0]': 'ID',
            'select[1]': 'NAME',
            'select[2]': 'LAST_NAME',
            'select[3]': 'SECOND_NAME',
            'select[4]': 'UF_CRM_APP_PL_CONTACT_REGION',
            'select[5]': 'UF_CRM_APP_PL_CONTACT_LOCALITY',
            'select[6]': 'UF_CRM_1448611987',  # адресное поле (fallback)
        })
        c = r.get("result")
        if c:
            region = (c.get("UF_CRM_APP_PL_CONTACT_REGION") or "").strip()
            locality = (c.get("UF_CRM_APP_PL_CONTACT_LOCALITY") or "").strip()
            # Fallback: пытаемся достать регион из адресного поля UF_CRM_1448611987
            addr = c.get("UF_CRM_1448611987") or ""
            if not region and addr:
                # Формат: "Москва,Россия" или "Москва, Москва, Россия"
                parts = [p.strip() for p in addr.split(",") if p.strip()]
                if parts:
                    region = parts[0]
                    if not locality:
                        locality = parts[0]
            last_name   = (c.get("LAST_NAME", "") or "").strip()
            first_name  = (c.get("NAME", "") or "").strip()
            middle_name = (c.get("SECOND_NAME", "") or "").strip()
            full_name   = " ".join(filter(None, [last_name, first_name, middle_name]))
            result[cid] = {"name": full_name, "region": region, "locality": locality}
        
        if (i+1) % 50 == 0:
            print(f"  {i+1}/{len(contact_ids)}...")
            json.dump(result, open(config.CACHE_DIR + "/contacts_ext.json", "w", encoding="utf-8"), ensure_ascii=False)
            
    except Exception as e:
        print(f"  ERROR contact {cid}: {e}", file=sys.stderr)
    
    time.sleep(0.05)  # небольшой буфер

json.dump(result, open(config.CACHE_DIR + "/contacts_ext.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"Готово: {len(result)} контактов → contacts_ext.json")
