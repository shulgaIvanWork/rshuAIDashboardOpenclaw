"""
run_full.py — обновление данных для manager-report-dev.

Копирует свежие данные из rshu-management-dashboard (там самый полный пайплайн).
"""
import os, shutil, sys, json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'cache'))

SRC_RSHU = os.path.normpath(os.path.join(SCRIPT_DIR, '..', '..', 'rshu-management-dashboard', 'cache'))
SRC_PARTS = os.path.normpath(os.path.join(SCRIPT_DIR, '..', '..', 'participants-dashboard', 'cache'))

def emit_progress(msg):
    line = f"###PROGRESS:{json.dumps(msg, ensure_ascii=False)}"
    print(line, flush=True)

# Файлы из rshu-management
FILES = ['deals_NEW.json', 'agg.json']
# dicts.json из participants (там есть users)
DICTS_SRC = os.path.join(SRC_PARTS, 'dicts.json')

print("=" * 60)
print("ОБНОВЛЕНИЕ ДАННЫХ manager-report-dev")
print(f"Источник: {SRC_DIR}")
print("=" * 60)

emit_progress({"type": "step_start", "idx": 0, "key": "copy_rshu", "label": "Копирование данных из rshu-management", "weight": 100})

for i, fname in enumerate(FILES):
    src = os.path.join(SRC_RSHU, fname)
    dst = os.path.join(CACHE_DIR, fname)
    if os.path.exists(src):
        sz = os.path.getsize(src)
        shutil.copy2(src, dst)
        print(f"  ✓ {fname} — {sz:,} байт")
    else:
        print(f"  ⚠ {fname} — не найден в {SRC_RSHU}")
    emit_progress({"type": "deals_loaded", "count": (i+1) * len(FILES) * 100 // len(FILES), "origin_step": 0})

# dicts.json — из participants (там есть users)
dst_dicts = os.path.join(CACHE_DIR, 'dicts.json')
if os.path.exists(DICTS_SRC):
    sz = os.path.getsize(DICTS_SRC)
    shutil.copy2(DICTS_SRC, dst_dicts)
    print(f"  ✓ dicts.json — {sz:,} байт (из participants-dashboard)")
else:
    print(f"  ⚠ dicts.json — не найден")
emit_progress({"type": "deals_loaded", "count": 100, "origin_step": 0})

emit_progress({"type": "step_done", "idx": 0})
emit_progress({"type": "all_done"})

print()
print("=" * 60)
print("ОБНОВЛЕНИЕ ЗАВЕРШЕНО!")
print(f"    agg.json: обновлён")
print(f"    deals_NEW.json: обновлён ({sum(os.path.getsize(os.path.join(CACHE_DIR, f)) for f in FILES if os.path.exists(os.path.join(CACHE_DIR, f))):,} байт всего)")
print("=" * 60)
