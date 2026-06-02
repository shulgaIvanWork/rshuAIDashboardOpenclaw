"""
run_daily.py — ЕЖЕДНЕВНОЕ обновление дашборда.

Не сбрасывает уже скачанные страницы — докачивает только новые.
Оптимально запускать по расписанию (cron/планировщик).

Запуск:  python run_daily.py

Пример cron (каждый день в 07:00):
    0 7 * * * cd /путь/к/скриптам && python run_daily.py >> logs/daily.log 2>&1

Порядок:
    1. fetch_deals.py --batches 3   (быстро подгружает новые страницы)
    2. fetch_leads.py --batches 3
    3. merge.py                     (перестраивает deals_2026.json)
    4. analyze.py
    5. build_html.py
    6. build_xlsx.py
"""
import subprocess, sys, time

DEAL_BATCHES  = 3   # сделок ~7500 за запуск (3 батча × 50 команд × 50 сделок)
LEADS_BATCHES = 3   # лидов  ~7500 за запуск


def run(script, args=""):
    cmd = [sys.executable, script] + (args.split() if args else [])
    print(f"\n{'='*55}")
    print(f"▶  {' '.join(cmd)}")
    print('='*55)
    t0 = time.time()
    result = subprocess.run(cmd, check=False)
    elapsed = time.time() - t0
    if result.returncode != 0:
        print(f"❌  {script} завершился с ошибкой (код {result.returncode})")
        sys.exit(result.returncode)
    print(f"✓  {script} — {elapsed:.1f}s")


from datetime import datetime
print(f"\n⏰  Дата: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 55)
print("ЕЖЕДНЕВНОЕ ОБНОВЛЕНИЕ")
print("=" * 55)

run("fetch_deals.py",  f"--batches {DEAL_BATCHES}")
run("fetch_leads.py",  f"--batches {LEADS_BATCHES}")
run("merge.py")
run("analyze.py")
run("build_html.py")
run("build_xlsx.py")

print("\n" + "=" * 55)
print("✅  Обновление завершено!")
import config
print(f"    HTML:  {config.OUTPUT_DIR}/{config.HTML_FILE}")
print(f"    Excel: {config.OUTPUT_DIR}/{config.XLSX_FILE}")
print("=" * 55)
