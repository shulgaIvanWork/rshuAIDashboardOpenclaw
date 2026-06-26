"""
run_full.py — обновление данных для manager-report-dev.

Копирует свежие данные из rshu-management-dashboard (там самый полный пайплайн).
"""
import os, shutil, sys, json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'cache'))

SRC_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', '..', 'rshu-management-dashboard', 'cache'))

def emit_progress(msg):
    line = f"###PROGRESS:{json.dumps(msg, ensure_ascii=False)}"
    print(line, flush=True)

FILES = ['deals_NEW.json', 'dicts.json', 'agg.json']

print("=" * 60)
print("ОБНОВЛЕНИЕ ДАННЫХ manager-report-dev")
print(f"Источник: {SRC_DIR}")
print("=" * 60)

emit_progress({"type": "step_start", "idx": 0, "key": "copy_rshu", "label": "Копирование данных из rshu-management", "weight": 100})

for i, fname in enumerate(FILES):
    src = os.path.join(SRC_DIR, fname)
    dst = os.path.join(CACHE_DIR, fname)
    if os.path.exists(src):
        sz = os.path.getsize(src)
        shutil.copy2(src, dst)
        print(f"  ✓ {fname} — {sz:,} байт")
    else:
        print(f"  ⚠ {fname} — не найден в {SRC_DIR}")
    emit_progress({"type": "deals_loaded", "count": (i+1) * len(FILES) * 100 // len(FILES), "origin_step": 0})

emit_progress({"type": "step_done", "idx": 0})
emit_progress({"type": "all_done"})

print()
print("=" * 60)
print("ОБНОВЛЕНИЕ ЗАВЕРШЕНО!")
print(f"    agg.json: обновлён")
print(f"    deals_NEW.json: обновлён ({sum(os.path.getsize(os.path.join(CACHE_DIR, f)) for f in FILES if os.path.exists(os.path.join(CACHE_DIR, f))):,} байт всего)")
print("=" * 60)
