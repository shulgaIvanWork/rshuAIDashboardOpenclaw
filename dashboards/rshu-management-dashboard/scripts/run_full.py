"""
run_full.py — АНАЛИЗ ДАННЫХ

Данные берутся из data-service/cache/ (deals.json + dicts.json).
Этот скрипт только агрегирует — выгрузку делает data-service (npm run fetch).

Вывод прогресса в stdout строкой вида:
    ###PROGRESS:{json}
"""
import subprocess, sys, os, time, shutil, json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'cache'))

def emit_progress(msg):
    line = f"###PROGRESS:{json.dumps(msg, ensure_ascii=False)}"
    print(line, flush=True)

STEPS = [
    {"idx": 0, "key": "analyze_new", "label": "Анализ данных", "weight": 100},
]

def run_step(step):
    script = step["key"] + ".py"
    cmd = [sys.executable, os.path.join(SCRIPT_DIR, script)]

    emit_progress({"type": "step_start", "idx": step["idx"]})

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    t0 = time.time()
    proc = subprocess.Popen(
        cmd,
        cwd=SCRIPT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=env,
    )

    for line in proc.stdout:
        line = line.rstrip("\n")
        if line.startswith("###PROGRESS:"):
            try:
                payload = json.loads(line[len("###PROGRESS:"):])
                payload["origin_step"] = step["idx"]
                emit_progress(payload)
            except json.JSONDecodeError:
                pass
        else:
            print(line)

    proc.stdout.close()
    stderr = proc.stderr.read()
    proc.stderr.close()
    rc = proc.wait()

    elapsed = time.time() - t0

    if rc != 0:
        print(f"\nX  {script} завершился с ошибкой (код {rc})")
        if stderr:
            print(f"  stderr: {stderr[-500:]}")
        emit_progress({"type": "step_error", "idx": step["idx"], "stderr": stderr[-200:] if stderr else ""})
        sys.exit(rc)

    emit_progress({"type": "step_done", "idx": step["idx"]})
    print(f"OK {script} — {elapsed:.1f}s")


print("=" * 60)
print("АНАЛИЗ ДАННЫХ (data-service/cache/)")
print("=" * 60)

for step in STEPS:
    run_step(step)

emit_progress({"type": "finalizing"})
src = os.path.join(CACHE_DIR, 'agg_new.json')
dst = os.path.join(CACHE_DIR, 'agg.json')
if os.path.exists(src):
    shutil.copy2(src, dst)
    print("OK agg_new.json -> agg.json")
else:
    print("WARN agg_new.json не найден")

emit_progress({"type": "all_done"})
print("=" * 60)
print("ГОТОВО")
print("=" * 60)
