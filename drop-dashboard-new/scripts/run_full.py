"""
run_full.py — ПОЛНАЯ пересборка с нуля (новая логика).

Выгружает все сделки через CRM Export API (новая точка доступа),
затем запускает новый анализ.

Используйте:
    - при первом запуске на новом сервере
    - в начале нового года (смените YEAR в config.py)
    - при подозрении на битые данные

Запуск:  python run_full.py

Порядок шагов:
    1. fetch_refresh.py  — выгрузка сделок через CRM Export API
    2. fetch_dicts.py    — справочники
    3. analyze_new.py    — новый анализ (agen_new.json)
    4. build_xlsx.py     — Excel-отчёт
"""
import subprocess, sys, os, time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

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
print("ПОЛНАЯ ВЫГРУЗКА — НОВАЯ ЛОГИКА")
print("CRM Export API → analyze_new → agg_new.json")
print("=" * 60)

# --- Шаг 1: Сделки через CRM Export API ---
run("fetch_refresh.py")

# --- Шаг 2: Справочники ---
run("fetch_dicts.py")

# --- Шаг 3: Новый анализ ---
run("analyze_new.py")

# --- Шаг 4: Excel ---
run("build_xlsx.py")

print("\n" + "=" * 60)
print("✅  Полная выгрузка завершена!")
import config
print(f"    agg_new.json  обновлён")
print(f"    Excel: {config.OUTPUT_DIR}/{config.XLSX_FILE}")
print("=" * 60)
