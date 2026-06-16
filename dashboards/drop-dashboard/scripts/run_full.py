"""
run_full.py — ПОЛНАЯ ПЕРЕСБОРКА для нового дашборда (Новая логика).

Обновляет сделки через CRM Export API (fetch_refresh.py),
справочники (fetch_dicts.py), затем запускает новый анализ (analyze_new.py).

Используйте:
    - при первом запуске на новом сервере
    - при подозрении на битые данные
    - по кнопке «Обновить» на дашборде

Запуск:  python run_full.py

Порядок шагов:
    1. fetch_refresh.py   — обновление сделок через CRM Export API
    2. fetch_dicts.py     — обновление справочников Bitrix24
    3. analyze_new.py     — новый анализ (agg_new.json)
"""
import subprocess, sys, os, time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def run(script, args=""):
    full_path = os.path.join(SCRIPT_DIR, script)
    if not os.path.exists(full_path):
        print(f"\n❌  {full_path} не найден, пропускаем")
        return
    cmd = [sys.executable, full_path] + (args.split() if args else [])
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
print("ПОЛНАЯ ПЕРЕСБОРКА (новая логика)")
print("=" * 60)

# --- Шаг 1: Сделки через CRM Export API (быстро) ---
run("fetch_refresh.py")

# --- Шаг 2: Справочники ---
run("fetch_dicts.py")

# --- Шаг 3: Новый анализ (agg_new.json) ---
run("analyze_new.py")

print("\n" + "=" * 60)
print("✅  Полная пересборка завершена!")
print("    agg_new.json — готов к загрузке на дашборд")
print("=" * 60)
