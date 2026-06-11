"""
merge.py — склеивает страницы из pages_CREATE/ и pages_CLOSE/ в один файл
deals_2026.json и параллельно строит company_contact.json.

Запускать после того, как fetch_deals.py завершил оба потока.
"""
import json, glob, os
import config

print("== Объединяем страницы сделок ==")
all_deals = {}
for folder in [config.PAGES_CREATE, config.PAGES_CLOSE]:
    files = glob.glob(f"{folder}/p_*.json")
    for fp in files:
        try:
            arr = json.load(open(fp, encoding="utf-8"))
            for x in arr:
                all_deals[x["ID"]] = x
        except Exception as e:
            print(f"  WARN {fp}: {e}")

deals = list(all_deals.values())
json.dump(deals, open(config.DEALS_JSON, "w", encoding="utf-8"), ensure_ascii=False)
print(f"  Уникальных сделок: {len(deals)} → {config.DEALS_JSON}")

print("== Строим company_contact.json ==")
cc = {}
for d in deals:
    cc[d["ID"]] = {
        "COMPANY_ID": d.get("COMPANY_ID") or "0",
        "CONTACT_ID": d.get("CONTACT_ID") or "0",
        "LEAD_ID":    d.get("LEAD_ID"),
    }
json.dump(cc, open(config.CC_JSON, "w", encoding="utf-8"), ensure_ascii=False)
print(f"  Записей: {len(cc)} → {config.CC_JSON}")

print("Готово. Следующий шаг: python analyze.py")
