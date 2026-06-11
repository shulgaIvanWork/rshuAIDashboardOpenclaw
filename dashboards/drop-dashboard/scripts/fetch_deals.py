"""
fetch_deals.py — инкрементальная выгрузка сделок из Битрикс24.

Запуск:
    python fetch_deals.py             # один батч-запрос CREATE + один CLOSE
    python fetch_deals.py --batches 5 # 5 батч-запросов каждого типа
    python fetch_deals.py --reset     # сбросить состояние и начать сначала

Сохраняет страницы в pages_CREATE/ и pages_CLOSE/.
Состояние хранится в state_CREATE.json / state_CLOSE.json — можно вызывать
несколько раз, каждый раз подгружая следующую порцию данных.
После завершения обоих потоков запустите merge.py.
"""
import urllib.request, urllib.parse, json, os, sys, time, argparse
import config

SELECT = [
    "ID", "TITLE", "STAGE_ID", "STAGE_SEMANTIC_ID", "CATEGORY_ID",
    "OPPORTUNITY", "CURRENCY_ID", "DATE_CREATE", "CLOSEDATE",
    "CLOSED", "ASSIGNED_BY_ID", "SOURCE_ID", "UTM_SOURCE",
    "COMPANY_ID", "CONTACT_ID", "LEAD_ID",
    "UF_DATE_PAY_1C", "UF_CRM_1753341391806",
    "UF_CRM_DATE_START_LEARN", "UF_CRM_DATE_END_LEARN",
    "BEGINDATE",
]
PAGE       = 50
BATCH_CMDS = 10  # reduced from 50 for reliability


def http_post(url, data, timeout=config.TIMEOUT):
    body = urllib.parse.urlencode(data, doseq=True).encode()
    req  = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def base_filter(which):
    """Фильтр по году — только сделки 2026 (основной дашборд)."""
    if which == "CREATE":
        return {">=DATE_CREATE": f"{config.YEAR}-01-01T00:00:00", "<=DATE_CREATE": f"{config.YEAR}-12-31T23:59:59"}
    else:
        return {">=CLOSEDATE": f"{config.YEAR}-01-01T00:00:00", "<=CLOSEDATE": f"{config.YEAR}-12-31T23:59:59"}


def build_qs(which, start):
    p = {"start": start, "order[ID]": "ASC"}
    p.update(base_filter(which))
    for i, f in enumerate(SELECT):
        p[f"select[{i}]"] = f
    return urllib.parse.urlencode(p, doseq=True)


def fetch_stream(which, n_batches):
    """Загружает n_batches батчей для потока CREATE или CLOSE."""
    outdir     = config.PAGES_CREATE if which == "CREATE" else config.PAGES_CLOSE
    state_file = config.STATE_CREATE  if which == "CREATE" else config.STATE_CLOSE
    os.makedirs(outdir, exist_ok=True)

    state = {"next_start": 0, "total": None}
    if os.path.exists(state_file):
        state = json.load(open(state_file, encoding="utf-8"))

    # Первый запрос — узнаём total и сохраняем 1-ю страницу
    if state["total"] is None:
        filt = base_filter(which)
        r    = http_post(
            config.BASE + "crm.deal.list.json",
            {**filt, "start": 0, **{f"select[{i}]": v for i, v in enumerate(SELECT)}},
        )
        if "result" not in r:
            print(f"[{which}] ERR: {r}", file=sys.stderr)
            return False
        state["total"] = r.get("total", 0)
        json.dump(r["result"], open(f"{outdir}/p_0.json", "w", encoding="utf-8"), ensure_ascii=False)
        state["next_start"] = PAGE
        json.dump(state, open(state_file, "w", encoding="utf-8"))
        print(f"[{which}] total={state['total']}  первая страница сохранена")

    total      = state["total"]
    done       = 0
    while state["next_start"] < total and done < n_batches:
        chunk = []
        s = state["next_start"]
        while s < total and len(chunk) < BATCH_CMDS:
            chunk.append(s)
            s += PAGE

        cmd = {f"cmd[c{i}]": "crm.deal.list?" + build_qs(which, st)
               for i, st in enumerate(chunk)}
        cmd["halt"] = "0"
        t0 = time.time()
        r  = http_post(config.BASE + "batch.json", cmd)
        res = r.get("result", {}).get("result", {}) or {}
        got = 0
        for i, st in enumerate(chunk):
            arr = res.get(f"c{i}", []) or []
            json.dump(arr, open(f"{outdir}/p_{st}.json", "w", encoding="utf-8"), ensure_ascii=False)
            got += len(arr)
        state["next_start"] = chunk[-1] + PAGE
        json.dump(state, open(state_file, "w", encoding="utf-8"))
        print(f"[{which}] batch {chunk[0]}..{chunk[-1]}  got={got}  "
              f"progress={state['next_start']}/{total}  dt={time.time()-t0:.1f}s")
        done += 1

    done_flag = state["next_start"] >= total
    print(f"[{which}] {'ЗАВЕРШЕНО' if done_flag else 'пауза'}  "
          f"progress={state['next_start']}/{total}  файлов={len(os.listdir(outdir))}")
    return done_flag


def reset_state():
    for f in [config.STATE_CREATE, config.STATE_CLOSE]:
        if os.path.exists(f):
            os.remove(f)
            print(f"Сброшен: {f}")
    import shutil
    for d in [config.PAGES_CREATE, config.PAGES_CLOSE]:
        if os.path.exists(d):
            shutil.rmtree(d)
            print(f"Удалена папка: {d}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Инкрементальная выгрузка сделок Битрикс24")
    ap.add_argument("--batches", type=int, default=1,
                    help="Кол-во батч-запросов за один запуск (default=1, каждый = 50 страниц × 50 сделок)")
    ap.add_argument("--reset", action="store_true",
                    help="Сбросить состояние и начать выгрузку с нуля")
    args = ap.parse_args()

    if args.reset:
        reset_state()

    done_c = fetch_stream("CREATE", args.batches)
    done_l = fetch_stream("CLOSE",  args.batches)

    if done_c and done_l:
        print("\nОба потока завершены. Запустите: python merge.py")
    else:
        print("\nЕщё не все данные загружены. Запустите fetch_deals.py снова.")
