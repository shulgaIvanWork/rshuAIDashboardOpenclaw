"""
run_full.py — ПОЛНАЯ пересборка с нуля.

Удаляет все кэшированные данные и выгружает всё заново из Битрикс24.
Используйте:
    - при первом запуске на новом сервере
    - в начале нового года (смените YEAR в config.py)
    - при подозрении на битые данные

Запуск:  python run_full.py

Порядок шагов:
    1. Сброс состояния
    2. fetch_deals.py --reset  (все батчи, до конца)
    3. fetch_leads.py --reset  (все батчи, до конца)
    4. merge.py
    5. fetch_dicts.py
    6. analyze.py
    7. build_html.py
    8. build_xlsx.py
"""
import subprocess, sys, os, time

def run(script, args=""):
    cmd = [sys.executable, script] + (args.split() if args else [])
    print(f"\n{'='*60}")
    print(f"▶  {' '.join(cmd)}")
    print('='*60)
    t0 = time.time()
    result = subprocess.run(cmd, check=False)
    elapsed = time.time() - t0
    if result.returncode != 0:
        print(f"\n❌  {script} завершился с ошибкой (код {result.returncode})")
        sys.exit(result.returncode)
    print(f"✓  {script} — {elapsed:.1f}s")


print("=" * 60)
print("ПОЛНАЯ ВЫГРУЗКА — удаляем кэш и загружаем заново")
print("=" * 60)

# --- Шаг 1: Сделки (оба потока, все батчи) ---
# --batches 9999 = загружать до исчерпания
run("fetch_deals.py", "--reset --batches 9999")

# --- Шаг 2: Лиды ---
run("fetch_leads.py", "--reset --batches 9999")

# --- Шаг 3: Слияние ---
run("merge.py")

# --- Шаг 4: Справочники (после deals_2026.json — нужны UID) ---
run("fetch_dicts.py")

# --- Шаг 5: Анализ ---
run("analyze.py")

# --- Шаг 6: Отчёты ---
run("build_html.py")
run("build_xlsx.py")

print("\n" + "=" * 60)
print("✅  Полная выгрузка завершена!")
import config
print(f"    HTML:  {config.OUTPUT_DIR}/{config.HTML_FILE}")
print(f"    Excel: {config.OUTPUT_DIR}/{config.XLSX_FILE}")
print("=" * 60)
