"""
fetch_contacts_fast.py — дозаполняет регионы контактов (только те, у кого пусто)
Берёт существующий contacts_ext.json, находит пустые регионы и дозаполняет из адреса
Сохраняет обратно в contacts_ext.json
"""
import urllib.request, urllib.parse, json, sys, time, os
sys.path.insert(0, '.')
import config

def call(method, params=None):
    body = urllib.parse.urlencode(params or {}, doseq=True).encode()
    req = urllib.request.Request(config.BASE + method + ".json", data=body, method="POST")
    req.timeout = config.TIMEOUT
    with urllib.request.urlopen(req, timeout=config.TIMEOUT) as r:
        return json.loads(r.read().decode())

cext_path = config.CACHE_DIR + "/contacts_ext.json"

# Загружаем существующий файл (или пустой словарь)
if os.path.exists(cext_path):
    cext = json.load(open(cext_path, encoding="utf-8"))
else:
    cext = {}

# Собираем ID контактов из сделок
deals = json.load(open(config.DEALS_JSON, encoding="utf-8"))
cc = json.load(open(config.CC_JSON, encoding="utf-8"))

contact_ids = set()
for d in deals:
    ccinfo = cc.get(d["ID"], {})
    cid = str(ccinfo.get("CONTACT_ID", d.get("CONTACT_ID", "0")))
    if cid != "0":
        contact_ids.add(cid)

print(f"Всего контактов в сделках: {len(contact_ids)}")
print(f"В кэше: {len(cext)}")

# Находим контакты, которых нет в кэше или у которых пустой регион
need_update = set()
for cid in contact_ids:
    if cid not in cext:
        need_update.add(cid)
    else:
        v = cext[cid]
        if not v.get("region") and not v.get("locality"):
            need_update.add(cid)

print(f"Нужно обновить/добавить: {len(need_update)}")

updated = 0
for i, cid in enumerate(sorted(need_update)):
    try:
        r = call('crm.contact.get', {
            'ID': cid,
            'select[0]': 'ID',
            'select[1]': 'NAME',
            'select[2]': 'LAST_NAME',
            'select[3]': 'SECOND_NAME',
            'select[4]': 'UF_CRM_APP_PL_CONTACT_REGION',
            'select[5]': 'UF_CRM_APP_PL_CONTACT_LOCALITY',
            'select[6]': 'UF_CRM_1448611987',
        })
        c = r.get("result")
        if c:
            region = (c.get("UF_CRM_APP_PL_CONTACT_REGION") or "").strip()
            locality = (c.get("UF_CRM_APP_PL_CONTACT_LOCALITY") or "").strip()
            addr = c.get("UF_CRM_1448611987") or ""
            
            if not region and addr:
                parts = [p.strip() for p in addr.split(",") if p.strip()]
                if parts:
                    region = parts[0]
                    if not locality:
                        locality = parts[0]
            
            last_name   = (c.get("LAST_NAME", "") or "").strip()
            first_name  = (c.get("NAME", "") or "").strip()
            middle_name = (c.get("SECOND_NAME", "") or "").strip()
            full_name   = " ".join(filter(None, [last_name, first_name, middle_name]))
            cext[cid] = {"name": full_name, "region": region, "locality": locality}
            updated += 1
        
        if (i+1) % 100 == 0:
            print(f"  {i+1}/{len(need_update)}...")
            
    except Exception as e:
        print(f"  ERROR contact {cid}: {e}", file=sys.stderr)
    
    time.sleep(0.03)

# Сохраняем
json.dump(cext, open(cext_path, "w", encoding="utf-8"), ensure_ascii=False)
print(f"Готово: {updated} обновлено, всего в кэше: {len(cext)} → contacts_ext.json")
