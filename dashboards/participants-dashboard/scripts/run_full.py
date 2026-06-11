"""
run_full.py — ПОЛНАЯ пересборка с нуля.

Выгружает сделки, компании, контакты, лиды, справочники,
затем запускает анализ и сборку Excel.

Запуск:  python run_full.py

Порядок шагов:
    1. fetch_refresh.py               — сделки через CRM Export API
    2. fetch_dicts.py                 — справочники
    3. fetch_companies_ext_batch.py   — компании (адреса, регионы)
    4. fetch_contacts_batch.py        — контакты (расширенные данные)
    5. fetch_leads.py                 — лиды
    6. analyze_new.py                 — анализ → agg_new.json
    7. build_xlsx.py                  — Excel-отчёт
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
print("ПОЛНАЯ ВЫГРУЗКА — НОВАЯ ЛОГИКА")
print("CRM Export API → analyze_new → Excel")
print("=" * 60)

# --- Шаг 1: Сделки через CRM Export API ---
run("fetch_refresh.py")

# --- Шаг 2: Справочники ---
run("fetch_dicts.py")

# --- Шаг 3: Компании ---
run("fetch_companies_ext_batch.py")

# --- Шаг 4: Контакты ---
run("fetch_contacts_batch.py")

# --- Шаг 5: Лиды ---
run("fetch_leads.py")

# --- Шаг 6: Анализ ---
run("analyze_new.py")

# --- Копируем agg_new.json → agg.json (сервер читает agg.json) ---
src = os.path.join(CACHE_DIR, 'agg_new.json')
dst = os.path.join(CACHE_DIR, 'agg.json')
if os.path.exists(src):
    shutil.copy2(src, dst)
    print(f"✓  agg_new.json → agg.json (скопирован)")

# --- Шаг 7: Excel ---
run("build_xlsx.py")

print("\n" + "=" * 60)
print("✅  Полная выгрузка завершена!")
import config
print(f"    ag.json  обновлён")
print(f"    Excel: {config.OUTPUT_DIR}/{config.XLSX_FILE}")
print("=" * 60)
