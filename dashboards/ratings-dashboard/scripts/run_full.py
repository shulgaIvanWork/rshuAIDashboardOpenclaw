"""
run_full.py — ПОЛНАЯ пересборка с нуля.

Выгружает сделки, справочники, компании, лиды,
затем запускает анализ.

Запуск:  python run_full.py

Порядок шагов:
    1. fetch_refresh.py               — сделки через CRM Export API
    2. fetch_dicts.py                 — справочники
    3. fetch_companies_ext_batch.py   — компании (адреса, регионы)
    4. fetch_leads.py                 — лиды
    5. analyze_new.py                 — анализ → agg_new.json → agg.json
"""
import subprocess, sys, os, time, shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'cache'))

def run(script, args=""):
    cmd = [sys.executable, os.path.join(SCRIPT_DIR, script)] + (args.split() if args else [])
    print(f"\n{'='*60}")
    print(f"▶  {' '.join(cmd)}")
    print('='*60)
    t0 = time.time()
    result = subprocess.run(cmd, cwd=SCRIPT_DIR, check=False)
    elapsed = time.time() - t0
    if result.returncode != 0:
        print(f"\n❌  {script} завершился с ошибкой (код {result.returncode})")
        sys.exit(result.returncode)
    print(f"✓  {script} — {elapsed:.1f}s")


print("=" * 60)
print("ПОЛНАЯ ВЫГРУЗКА")
print("fetch_refresh → fetch_dicts → companies_ext → leads → analyze")
print("=" * 60)

# --- Шаг 1: Сделки через CRM Export API ---
run("fetch_refresh.py")

# --- Шаг 2: Справочники ---
run("fetch_dicts.py")

# --- Шаг 3: Компании ---
run("fetch_companies_ext_batch.py")

# --- Шаг 4: Лиды ---
run("fetch_leads.py")

# --- Шаг 5: Анализ ---
run("analyze_new.py")

# --- Копируем agg_new.json → agg.json (сервер читает agg.json) ---
src = os.path.join(CACHE_DIR, 'agg_new.json')
dst = os.path.join(CACHE_DIR, 'agg.json')
if os.path.exists(src):
    shutil.copy2(src, dst)
    print(f"✓  agg_new.json → agg.json (скопирован)")

print("\n" + "=" * 60)
print("✅  Полная выгрузка завершена!")
print(f"    agg.json  обновлён")
print("=" * 60)
