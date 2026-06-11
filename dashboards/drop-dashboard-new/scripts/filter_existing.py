"""
filter_existing.py — фильтрует существующие сделки до 3 воронок (0, 8, 19)
за 2025-2026 годы, чистит кэш страниц и запускает merge → analyze → build.

БЕЗ перезагрузки из API — использует уже загруженные данные.

Запуск: python filter_existing.py
"""
import json, os, sys, shutil, subprocess

import config

NEEDED_CATS = {0, 8, 19}
CAT_NAMES = {0: "Sale", 8: "Pre Sale", 19: "КОМ (Sale)"}

def main():
    print("=" * 60)
    print("ФИЛЬТРАЦИЯ сделок: Sale(0), Pre Sale(8), КОМ Sale(19)")
    print(f"Период: 2025-2026 (по DATE_CREATE)")
    print("=" * 60)
    
    all_deals_path = os.path.join(config.CACHE_DIR, 'deals_all.json')
    deals_path = config.DEALS_JSON
    
    # Создаём бэкап полных данных, если ещё нет
    if not os.path.exists(all_deals_path) and os.path.exists(deals_path):
        print(f"\nСоздаю бэкап полных данных → {all_deals_path}")
        shutil.copy2(deals_path, all_deals_path)
        print(f"  OK ({os.path.getsize(all_deals_path)//1024//1024} MB)")
    
    # Загружаем
    print(f"\nЗагрузка {deals_path}...")
    deals = json.load(open(deals_path, encoding='utf-8'))
    print(f"  Всего сделок: {len(deals)}")
    
    # Фильтр
    print(f"\nФильтрация...")
    filtered = []
    cats_found = {}
    years_found = {}
    
    for d in deals:
        cat = int(d.get('CATEGORY_ID', 0))
        if cat not in NEEDED_CATS:
            continue
        
        dc = d.get('DATE_CREATE', '')
        year = dc[:4] if dc and len(dc) >= 4 else ''
        
        if year not in ('2025', '2026'):
            continue
        
        filtered.append(d)
        cats_found[cat] = cats_found.get(cat, 0) + 1
        years_found[year] = years_found.get(year, 0) + 1
    
    print(f"\n  Отфильтровано: {len(filtered)} сделок")
    print(f"  По категориям:")
    for c in sorted(NEEDED_CATS):
        n = cats_found.get(c, 0)
        pct = n/len(filtered)*100 if filtered else 0
        print(f"    {CAT_NAMES[c]} (id {c}): {n} ({pct:.1f}%)")
    print(f"  По годам:")
    for y in sorted(years_found):
        print(f"    {y}: {years_found[y]}")
    
    # Очищаем старые страницы и сохраняем новые
    print(f"\nОчистка и сохранение страниц...")
    for d in [config.PAGES_CREATE, config.PAGES_CLOSE]:
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)
    
    batch_size = 1000
    deals_sorted = sorted(filtered, key=lambda d: int(d['ID']))
    for i in range(0, len(deals_sorted), batch_size):
        chunk = deals_sorted[i:i + batch_size]
        json.dump(chunk, open(f"{config.PAGES_CREATE}/p_{i}.json", "w", encoding="utf-8"), ensure_ascii=False)
    
    print(f"  Сохранено в {config.PAGES_CREATE}/")
    
    # Запускаем пайплайн
    script_dir = config.SCRIPT_DIR
    scripts = ['merge.py', 'analyze.py', 'build_html.py']
    
    for script in scripts:
        print(f"\n{'='*60}")
        print(f"Запуск {script}...")
        print('='*60)
        result = subprocess.run(
            [sys.executable, os.path.join(script_dir, script)],
            cwd=script_dir,
            capture_output=False
        )
        if result.returncode != 0:
            print(f"❌ {script} завершился с ошибкой (код {result.returncode})")
            sys.exit(1)
        print(f"✓ {script} завершён")
    
    print(f"\n{'='*60}")
    print("✅ ГОТОВО! Дашборд обновлён.")
    print(f"   Данные: {len(filtered)} сделок по 3 воронкам за 2025-2026")
    print('='*60)

if __name__ == "__main__":
    main()
