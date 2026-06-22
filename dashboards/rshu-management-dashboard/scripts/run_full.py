"""
run_full.py — ПОЛНАЯ ПЕРЕСБОРКА

Порядок шагов:
    1. fetch_rest.py               — REST API crm.deal.list (основной)
    2. fetch_export.py             — Export API (дополняет по ID)
    3. fetch_dicts.py              — справочники
    4. analyze_new.py              — анализ -> agg_new.json

Вывод прогресса в stdout строкой вида:
    ###PROGRESS:{json}
"""
import subprocess, sys, os, time, shutil, json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'cache'))

def emit_progress(msg):
    """Печатает JSON-строку прогресса, читаемую сервером."""
    line = f"###PROGRESS:{json.dumps(msg, ensure_ascii=False)}"
    print(line, flush=True)

STEPS = [
    {"idx": 0, "key": "fetch_rest",   "label": "REST API: выгрузка сделок",         "weight": 40},
    {"idx": 1, "key": "fetch_export", "label": "Export API: дополнение сделок",     "weight": 10},
    {"idx": 2, "key": "fetch_dicts",  "label": "Загрузка справочников",             "weight": 10},
    {"idx": 3, "key": "analyze_new",  "label": "Анализ данных",                      "weight": 40},
]

def run_step(step, args=""):
    """Запускает скрипт шага с релеем ###PROGRESS: строк из stdout."""
    script = step["key"] + ".py"
    cmd = [sys.executable, os.path.join(SCRIPT_DIR, script)] + (args.split() if args else [])
    
    emit_progress({"type": "step_start", "idx": step["idx"]})
    
    # Отключаем буферизацию Python, чтобы ###PROGRESS: строки доходили сразу
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
    
    # Читаем stdout построчно
    for line in proc.stdout:
        line = line.rstrip("\n")
        # Релеим ###PROGRESS: строки из дочернего процесса
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
        # Показываем последние 500 символов stderr
        if stderr:
            tail = stderr[-500:]
            print(f"  stderr: {tail}")
        emit_progress({"type": "step_error", "idx": step["idx"], "stderr": stderr[-200:] if stderr else ""})
        sys.exit(rc)
    
    emit_progress({"type": "step_done", "idx": step["idx"]})
    print(f"✓  {script} — {elapsed:.1f}s")


# === Главный цикл ===
print("=" * 60)
print("ПОЛНАЯ ВЫГРУЗКА — REST + Export + analyze_new")
print("=" * 60)

for step in STEPS:
    run_step(step)

# --- Финализация: копируем agg_new.json -> agg.json ---
emit_progress({"type": "finalizing"})
src = os.path.join(CACHE_DIR, 'agg_new.json')
dst = os.path.join(CACHE_DIR, 'agg.json')
if os.path.exists(src):
    shutil.copy2(src, dst)
    print(f"✓  agg_new.json -> agg.json (скопирован)")
else:
    print(f"⚠  agg_new.json не найден — agg.json не обновлён")

# --- Сигнал завершения ---
emit_progress({"type": "all_done"})

print()
print("=" * 60)
print("ПОЛНАЯ ВЫГРУЗКА ЗАВЕРШЕНА!")
print(f"    agg.json обновлён")
print("=" * 60)
