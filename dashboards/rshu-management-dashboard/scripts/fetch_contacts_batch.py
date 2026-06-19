"""
fetch_contacts_batch.py — быстрая выгрузка контактов через batch API
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

def call_batch(commands):
    """Выполнить batch-запрос, возвращает список результатов в порядке команд"""
    params = {'halt': 0}
    for i, cmd in enumerate(commands):
        params[f'cmd[{i}]'] = cmd
    r = call('batch', params)
    return r.get("result", {}).get("result", [])

# Get all contacts from deals
deals = json.load(open(config.DEALS_JSON, encoding="utf-8"))
cc = json.load(open(config.CC_JSON, encoding="utf-8"))

contact_ids = set()
for d in deals:
    ccinfo = cc.get(d["ID"], {})
    raw = ccinfo.get("CONTACT_ID", d.get("CONTACT_ID", "0"))
    # Пропускаем None, 'None', '0', и пустые строки
    if raw is None or str(raw).strip() in ("", "0", "None"):
        continue
    cid = str(raw).strip()
    contact_ids.add(cid)

print(f"Нужно контактов: {len(contact_ids)}")

# Load existing cache
cext_path = config.CACHE_DIR + "/contacts_ext.json"
existing = {}
if os.path.exists(cext_path):
    existing = json.load(open(cext_path, encoding="utf-8"))
    print(f"Уже в кэше: {len(existing)}")

# Determine which contacts need fetching
need_fetch = set()
for cid in contact_ids:
    if cid not in existing:
        need_fetch.add(cid)
    else:
        v = existing[cid]
        if not v.get("region") and not v.get("locality"):
            need_fetch.add(cid)

print(f"Нужно дозапросить: {len(need_fetch)}")

if not need_fetch:
    print("Всё уже есть.")
    sys.exit(0)

result = dict(existing)
# Безопасная сортировка — пропускаем нечисловые ID
numeric_ids = [x for x in need_fetch if x.isdigit()]
non_numeric = [x for x in need_fetch if not x.isdigit()]
if non_numeric:
    print(f"  Пропущено нечисловых CONTACT_ID: {non_numeric}")
all_ids = sorted(numeric_ids, key=int)

BATCH_SIZE = 50
total_batches = (len(all_ids) + BATCH_SIZE - 1) // BATCH_SIZE

for b in range(total_batches):
    chunk = all_ids[b * BATCH_SIZE:(b + 1) * BATCH_SIZE]
    
    cmds = []
    for cid in chunk:
        cmds.append(f'crm.contact.get?ID={cid}&select[0]=ID&select[1]=NAME&select[2]=LAST_NAME&select[3]=SECOND_NAME&select[4]=UF_CRM_APP_PL_CONTACT_REGION&select[5]=UF_CRM_APP_PL_CONTACT_LOCALITY&select[6]=UF_CRM_1448611987')
    
    try:
        results = call_batch(cmds)
        for idx, cid in enumerate(chunk):
            c = results[idx] if idx < len(results) else {}
            if c and isinstance(c, dict) and c.get("ID"):
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
                result[cid] = {"name": full_name, "region": region, "locality": locality}
            else:
                result[cid] = {"name": "Неизвестно", "region": "", "locality": ""}
    except Exception as e:
        print(f"  ERROR batch {b+1}/{total_batches}: {e}", file=sys.stderr)
        for cid in chunk:
            result[cid] = {"name": "Ошибка", "region": "", "locality": ""}
    
    if (b+1) % 10 == 0:
        print(f"  Batch {b+1}/{total_batches} ({len(result)} контактов)...")
        json.dump(result, open(cext_path, "w", encoding="utf-8"), ensure_ascii=False)
    
    time.sleep(0.3)

json.dump(result, open(cext_path, "w", encoding="utf-8"), ensure_ascii=False)
print(f"Готово: {len(result)} контактов → contacts_ext.json")
