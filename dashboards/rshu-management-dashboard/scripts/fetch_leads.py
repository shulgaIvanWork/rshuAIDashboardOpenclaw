"""
fetch_leads.py — инкрементальная выгрузка лидов из Битрикс24.

Запуск:
    python fetch_leads.py             # один батч-запрос
    python fetch_leads.py --batches 5 # 5 батч-запросов
    python fetch_leads.py --reset     # начать с нуля

Сохраняет страницы в leads_pages/.
Состояние хранится в leads_state.json.
"""
import urllib.request, urllib.parse, json, os, sys, time, argparse
import config

SELECT = [
    "ID", "TITLE", "STATUS_ID", "STATUS_SEMANTIC_ID",
    "DATE_CREATE", "DATE_MODIFY", "ASSIGNED_BY_ID",
    "SOURCE_ID", "OPPORTUNITY", "CURRENCY_ID",
]
PAGE       = 50
BATCH_CMDS = 50

FILT = {
    "filter[>=DATE_CREATE]": f"{config.YEAR}-01-01T00:00:00",
    "filter[<=DATE_CREATE]": f"{config.YEAR}-12-31T23:59:59",
}


def http_post(url, data, timeout=config.TIMEOUT):
    body = urllib.parse.urlencode(data, doseq=True).encode()
    req  = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def build_qs(start):
    p = {"start": start, "order[ID]": "ASC", **FILT}
    for i, f in enumerate(SELECT):
        p[f"select[{i}]"] = f
    return urllib.parse.urlencode(p, doseq=True)


def fetch_leads(n_batches):
    os.makedirs(config.LEADS_PAGES, exist_ok=True)
    state = {"next_start": 0, "total": None}
    if os.path.exists(config.LEADS_STATE):
        state = json.load(open(config.LEADS_STATE, encoding="utf-8"))

    if state["total"] is None:
        r = http_post(
            config.BASE + "crm.lead.list.json",
            {**FILT, "start": 0, **{f"select[{i}]": v for i, v in enumerate(SELECT)}},
        )
        if "result" not in r:
            print(f"ERR: {r}", file=sys.stderr)
            return False
        state["total"] = r.get("total", 0)
        json.dump(r["result"], open(f"{config.LEADS_PAGES}/p_0.json", "w", encoding="utf-8"), ensure_ascii=False)
        state["next_start"] = PAGE
        json.dump(state, open(config.LEADS_STATE, "w", encoding="utf-8"))
        print(f"[LEADS] total={state['total']}  первая страница сохранена")

    total = state["total"]
    done  = 0
    while state["next_start"] < total and done < n_batches:
        chunk = []
        s = state["next_start"]
        while s < total and len(chunk) < BATCH_CMDS:
            chunk.append(s)
            s += PAGE

        cmd = {f"cmd[c{i}]": "crm.lead.list?" + build_qs(st) for i, st in enumerate(chunk)}
        cmd["halt"] = "0"
        t0 = time.time()
        r  = http_post(config.BASE + "batch.json", cmd)
        res = r.get("result", {}).get("result", {}) or {}
        got = 0
        for i, st in enumerate(chunk):
            arr = res.get(f"c{i}", []) or []
            json.dump(arr, open(f"{config.LEADS_PAGES}/p_{st}.json", "w", encoding="utf-8"), ensure_ascii=False)
            got += len(arr)
        state["next_start"] = chunk[-1] + PAGE
        json.dump(state, open(config.LEADS_STATE, "w", encoding="utf-8"))
        print(f"[LEADS] batch {chunk[0]}..{chunk[-1]}  got={got}  "
              f"progress={state['next_start']}/{total}  dt={time.time()-t0:.1f}s")
        done += 1

    done_flag = state["next_start"] >= total
    print(f"[LEADS] {'ЗАВЕРШЕНО' if done_flag else 'пауза'}  "
          f"progress={state['next_start']}/{total}  файлов={len(os.listdir(config.LEADS_PAGES))}")
    return done_flag


def reset_state():
    if os.path.exists(config.LEADS_STATE):
        os.remove(config.LEADS_STATE)
        print(f"Сброшен: {config.LEADS_STATE}")
    import shutil
    if os.path.exists(config.LEADS_PAGES):
        shutil.rmtree(config.LEADS_PAGES)
        print(f"Удалена папка: {config.LEADS_PAGES}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Инкрементальная выгрузка лидов Битрикс24")
    ap.add_argument("--batches", type=int, default=1)
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    if args.reset:
        reset_state()

    done = fetch_leads(args.batches)
    if done:
        print("\nЛиды выгружены полностью.")
    else:
        print("\nЗапустите fetch_leads.py снова для следующей порции.")
