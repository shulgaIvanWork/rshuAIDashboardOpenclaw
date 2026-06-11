"""
fetch_invoices.py — выгрузка счетов (invoices) через REST API (батчами).

Счета привязаны к сделкам через UF_DEAL_ID.
Для дашборда важны: PRICE (факт.сумма), UF_DATE_PAY_1C (дата оплаты из 1С),
PAYED (флаг оплаты), UF_DEAL_ID (связь со сделкой).

Фильтр: PAYED=Y (все оплаченные счета). Период: без ограничения (с 2024).
Запуск: python fetch_invoices.py
"""
import urllib.request, urllib.parse, json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import config

INVOICES_FILE = os.path.join(config.CACHE_DIR, 'invoices.json')
PAGE = 50
BATCH_CMDS = 50  # максимально, т.к. инвойсы простые

SELECT = [
    "ID", "PRICE", "PAYED", "UF_DATE_PAY_1C", "UF_DEAL_ID",
    "DATE_PAYED", "STATUS_ID", "DATE_BILL", "ACCOUNT_NUMBER",
]


def build_qs(start):
    """Строит query string для crm.invoice.list с фильтром PAYED=Y."""
    p = {"start": start, "order[ID]": "ASC", "filter[PAYED]": "Y"}
    for i, f in enumerate(SELECT):
        p[f"select[{i}]"] = f
    return urllib.parse.urlencode(p, doseq=True)


def fetch_all():
    # Загружаем существующий прогресс (если был сохранён)
    all_invoices = {}
    if os.path.exists(INVOICES_FILE):
        try:
            existing = json.load(open(INVOICES_FILE, encoding="utf-8"))
            for inv in existing:
                all_invoices[inv["ID"]] = inv
            print(f"  Загружен прогресс: {len(all_invoices)} счетов")
        except:
            pass
    
    total = None
    
    # Определяем стартовый offset: по последнему загруженному ID
    if all_invoices:
        # Вычисляем offset по количеству уже загруженных счетов
        next_start = (len(all_invoices) // PAGE) * PAGE
        if next_start == len(all_invoices):
            next_start = len(all_invoices)
        print(f"  Возобновляем с offset={next_start}")
    else:
        next_start = 0
    
    # Получаем total
    try:
        params = {"filter[PAYED]": "Y", "order[ID]": "ASC", "start": 0}
        for i, f in enumerate(SELECT):
            params[f"select[{i}]"] = f
        r = http_post(config.BASE + "crm.invoice.list.json", params)
        total = r.get("total", 0)
        print(f"  Всего оплаченных счетов: {total}")
        if not all_invoices:
            items = r.get("result", [])
            for inv in items:
                all_invoices[inv["ID"]] = inv
            next_start = PAGE
    except Exception as e:
        print(f"Ошибка получения total: {e}")
        return
    
    # Сохраняем после каждой партии
    def save_progress():
        json.dump(list(all_invoices.values()), open(INVOICES_FILE, "w", encoding="utf-8"), ensure_ascii=False)
    
    # Батчевая догрузка
    while next_start < total:
        chunk = []
        s = next_start
        while s < total and len(chunk) < BATCH_CMDS:
            chunk.append(s)
            s += PAGE
        
        cmd = {f"cmd[c{i}]": "crm.invoice.list?" + build_qs(st)
               for i, st in enumerate(chunk)}
        cmd["halt"] = "0"
        
        t0 = time.time()
        try:
            r = http_post(config.BASE + "batch.json", cmd)
        except Exception as e:
            print(f"  batch error: {e}")
            save_progress()  # сохраняем что есть
            break
        
        res = r.get("result", {}).get("result", {}) or {}
        got = 0
        for i, st in enumerate(chunk):
            arr = res.get(f"c{i}", []) or []
            for inv in arr:
                all_invoices[inv["ID"]] = inv
            got += len(arr)
        
        next_start = chunk[-1] + PAGE
        elapsed = time.time() - t0
        print(f"  batch {chunk[0]}..{chunk[-1]}: got={got}, total={len(all_invoices)}/{total}  {elapsed:.1f}s")
        
        # Сохраняем каждые 5 батчей (или 25000 счетов)
        if len(all_invoices) % 12500 < 2500:
            save_progress()
            print(f"  → прогресс сохранён")
    
    save_progress()
    print(f"\n  Загружено счетов: {len(all_invoices)}")
    print(f"  Сохранено: {INVOICES_FILE}")


def http_post(url, data, timeout=config.TIMEOUT):
    body = urllib.parse.urlencode(data, doseq=True).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


if __name__ == "__main__":
    print("=" * 60)
    print("ВЫГРУЗКА СЧЕТОВ (invoices) — батчевая")
    print("=" * 60)
    fetch_all()
