"""
run_full.py — ПОЛНАЯ ПЕРЕСБОРКА (новая схема)

Порядок шагов:
    1. fetch_rest.py               — REST API crm.deal.list (основной)
    2. fetch_export.py             — Export API (дополняет по ID)
    3. fetch_dicts.py              — справочники
    4. analyze_new.py              — анализ -> agg_new.json
    5. build_xlsx.py               — Excel-отчёт
"""
import subprocess, sys, os, time, shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'cache'))

def run(script, args=""):
    cmd = [sys.executable, os.path.join(SCRIPT_DIR, script)] + (args.split() if args else [])
    print(f"\n{'='*60}")
    print(f">  {' '.join(cmd)}")
    print('='*60)
    t0 = time.time()
    result = subprocess.run(cmd, cwd=SCRIPT_DIR, check=False)
    elapsed = time.time() - t0
    if result.returncode != 0:
        print(f"\nX  {script} завершился с ошибкой (код {result.returncode})")
        sys.exit(result.returncode)
    print(f"v  {script} — {elapsed:.1f}s")


print("=" * 60)
print("ПОЛНАЯ ВЫГРУЗКА — REST + Export + analyze_new")
print("=" * 60)

# --- Шаг 1: REST API (основной источник) ---
run("fetch_rest.py")

# --- Шаг 2: Export API (дополняет по ID) ---
run("fetch_export.py")

# --- Шаг 3: Справочники ---
run("fetch_dicts.py")

# --- Шаг 4: Анализ ---
run("analyze_new.py")

# --- Копируем agg_new.json -> agg.json (сервер читает agg.json) ---
src = os.path.join(CACHE_DIR, 'agg_new.json')
dst = os.path.join(CACHE_DIR, 'agg.json')
if os.path.exists(src):
    shutil.copy2(src, dst)
    print(f"v  agg_new.json -> agg.json (скопирован)")

# --- Шаг 5: Excel ---
run("build_xlsx.py")

print("\n" + "=" * 60)
print("ПОЛНАЯ ВЫГРУЗКА ЗАВЕРШЕНА!")
import config
print(f"    agg.json обновлён")
print(f"    Excel: {config.OUTPUT_DIR}/{config.XLSX_FILE}")
print("=" * 60)
