"""
fetch_dicts.py — выгружает справочники Битрикс24:
    воронки (CATEGORY_ID), стадии, источники, пользователи
Результат: dicts.json
Запускать при первом старте и при изменениях в справочниках.
"""
import urllib.request, urllib.parse, json, sys
import config

def http_post(url, data, timeout=config.TIMEOUT):
    body = urllib.parse.urlencode(data, doseq=True).encode()
    req  = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

def call(method, params=None):
    return http_post(config.BASE + method + ".json", params or {})

print("== Воронки ==")
cats = call("crm.dealcategory.list", {"select[0]": "ID", "select[1]": "NAME"})["result"]
cats_map = {str(c["ID"]): c["NAME"] for c in cats}
cats_map["0"] = "Общая (по умолчанию)"
print(f"  Воронок: {len(cats_map)}")

print("== Стадии ==")
stages = {}
for cid in list(cats_map.keys()):
    try:
        r = call("crm.dealcategory.stage.list", {"id": int(cid)})
        for s in r.get("result", []):
            stages[s["STATUS_ID"]] = s.get("NAME") or s["STATUS_ID"]
    except Exception as e:
        print(f"  WARN stage cid={cid}: {e}", file=sys.stderr)
print(f"  Стадий: {len(stages)}")

print("== Источники ==")
src = call("crm.status.list", {"filter[ENTITY_ID]": "SOURCE"})["result"]
src_map = {s["STATUS_ID"]: s["NAME"] for s in src}
print(f"  Источников: {len(src_map)}")

print("== Пользователи (по сделкам) ==")
try:
    deals = json.load(open(config.DEALS_JSON, encoding="utf-8"))
    uids  = sorted({str(d.get("ASSIGNED_BY_ID","")) for d in deals if d.get("ASSIGNED_BY_ID")})
except FileNotFoundError:
    print(f"  WARN: {config.DEALS_JSON} не найден — пользователи будут пустыми")
    uids = []

users = {}
for i in range(0, len(uids), 50):
    chunk = uids[i:i+50]
    cmd   = {f"cmd[u{j}]": f"user.get?ID={uid}" for j, uid in enumerate(chunk)}
    cmd["halt"] = "0"
    r = http_post(config.BASE + "batch.json", cmd)
    res = r.get("result", {}).get("result", {})
    for j, uid in enumerate(chunk):
        arr = res.get(f"u{j}", [])
        if arr:
            u    = arr[0]
            name = " ".join(filter(None, [u.get("NAME"), u.get("LAST_NAME")])) \
                   or u.get("EMAIL") or f"ID {uid}"
            users[str(uid)] = name
print(f"  Пользователей: {len(users)}")

result = {"categories": cats_map, "stages": stages, "sources": src_map, "users": users}
json.dump(result, open(config.DICTS_JSON, "w", encoding="utf-8"), ensure_ascii=False)
print(f"Готово → {config.DICTS_JSON}")
