"""
fetch_kom_enrich.py — дозагрузка UF_* полей для определения КОМ через REST API.

Export API не возвращает UF_CRM_* поля. Этот скрипт:
1. Берёт ID оплаченных сделок из deals_NEW.json
2. Через REST API batch (crm.deal.get) догружает: UF_CRM_1683882427069, UF_FORMAT,
   UF_CRM_1498466811, UF_CRM_1765896709800
3. Сохраняет обновлённый deals_NEW.json

REST API: https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/
"""
import json, sys, os, time
from urllib.request import Request, urlopen
from urllib.parse import urlencode

# Пути
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR  = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'cache'))
DEALS_FILE = os.path.join(CACHE_DIR, 'deals_NEW.json')
DICTS_FILE = os.path.join(CACHE_DIR, 'dicts.json')

WEBHOOK = "https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/"

# Поля для дозагрузки (только те, что нужны для is_kom_deal)
KOM_FIELDS = [
    'ID',
    'UF_CRM_1683882427069',   # Галочка КОМ
    'UF_FORMAT',               # Формат (инфоблок)
    'UF_CRM_1498466811',       # Направление
    'UF_CRM_1765896709800',    # Тип обучения
]

def rest_call(method, params=None):
    """Базовый вызов REST API Bitrix24."""
    url = WEBHOOK + method
    if params:
        if isinstance(params, dict):
            data = json.dumps(params).encode('utf-8')
            req = Request(url, data=data, method='POST')
            req.add_header('Content-Type', 'application/json')
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode('utf-8'))
        elif isinstance(params, list):
            # params = [cmd_dict] — для batch
            data = json.dumps(params[0]).encode('utf-8')
            req = Request(url, data=data, method='POST')
            req.add_header('Content-Type', 'application/json')
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode('utf-8'))
    req = Request(url)
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))

def batch_get(deals_ids):
    """
    Загружает сделки через batch crm.deal.get.
    batch по 50 команд (лимит REST API).
    """
    results = {}
    batch_size = 50
    for i in range(0, len(deals_ids), batch_size):
        batch_ids = deals_ids[i:i+batch_size]
        cmds = {}
        for j, did in enumerate(batch_ids):
            cmd_name = f"d{j}"
            cmds[cmd_name] = f"crm.deal.get?id={did}"
        
        cmd_data = {
            'cmd': cmds,
            'halt': 0
        }
        
        try:
            resp = rest_call('batch', [cmd_data])
            top_result = resp.get('result', {})
            command_results = top_result.get('result', {}) if isinstance(top_result, dict) else {}
            cmd_errors = top_result.get('result_error', {}) if isinstance(top_result, dict) else {}
            
            for j, did in enumerate(batch_ids):
                cmd_name = f"d{j}"
                if cmd_name in command_results:
                    deal = command_results[cmd_name]
                    if deal and isinstance(deal, dict) and 'ID' in deal:
                        results[did] = deal
                elif cmd_name in cmd_errors:
                    pass  # ошибка, пропускаем
            
            print(f"  batch {i//batch_size + 1}/{(len(deals_ids)-1)//batch_size + 1}: {len(batch_ids)} сд. → получено {len(results)}")
            
        except Exception as e:
            print(f"  batch {i//batch_size + 1} ERROR: {e}")
        
        # Пауза между batch (лимит ~2 запроса/сек)
        time.sleep(0.5)
    
    return results


def main():
    print("== Загрузка deals_NEW.json ==")
    deals = json.load(open(DEALS_FILE, encoding='utf-8'))
    print(f"  Всего: {len(deals)} сделок")
    
    # Словарь ID→сделка для быстрого доступа
    deals_dict = {x['ID']: x for x in deals}
    
    # Определяем текущее состояние КОМ-полей
    def has_kom_fields(x):
        """Проверяет, есть ли у сделки КОМ-поля."""
        return bool(x.get('UF_CRM_1683882427069') or x.get('UF_FORMAT') or 
                    x.get('UF_CRM_1498466811') or x.get('UF_CRM_1765896709800'))
    
    # Сделки без КОМ-полей (нужно догрузить)
    need_fetch = [x for x in deals if not has_kom_fields(x)]
    print(f"  Без КОМ-полей: {len(need_fetch)}")
    
    if not need_fetch:
        print("  ✅ Все сделки уже имеют КОМ-поля")
        return
    
    # Ограничим: только оплаченные (UF_DATE_PAY_1C) — чтобы не дёргать API зря
    need_fetch_paid = [x for x in need_fetch if x.get('UF_DATE_PAY_1C')]
    print(f"  Из них оплаченных: {len(need_fetch_paid)}")
    
    # Для теста: возьмём сначала небольшую партию
    test_mode = '--test' in sys.argv
    if test_mode:
        need_fetch_paid = need_fetch_paid[:50]
        print(f"  ТЕСТОВЫЙ режим: {len(need_fetch_paid)}")
    
    if not need_fetch_paid:
        print("  Нечего догружать")
        return
    
    ids = [x['ID'] for x in need_fetch_paid]
    print(f"\n== Догружаем КОМ-поля через REST API ({len(ids)} сд.) ==")
    
    enriched = batch_get(ids)
    print(f"\n  Получено: {len(enriched)} сделок")
    
    # Обогащаем deals
    updated = 0
    for did, deal in enriched.items():
        if did in deals_dict:
            x = deals_dict[did]
            for f in KOM_FIELDS:
                if f in deal:
                    x[f] = deal[f]
            updated += 1
    
    # Сохраняем
    if updated > 0:
        # Сохраняем в новый файл
        output = DEALS_FILE
        if test_mode:
            output = DEALS_FILE.replace('.json', '_ENRICHED.json')
        
        # Сохраняем deals как список (тот же порядок)
        with open(output, 'w', encoding='utf-8') as f:
            json.dump(deals, f, ensure_ascii=False, indent=None, separators=(',', ':'))
        
        print(f"\n  ✅ Сохранено: {output} ({updated} сделок обновлено)")
        
        # Проверяем результат
        d2 = json.load(open(output, encoding='utf-8'))
        kom = sum(1 for x in d2 if 
                  x.get('UF_CRM_1683882427069') in ('Y','1',True) or 
                  str(x.get('UF_FORMAT',''))=='19042498' or
                  int(x.get('CATEGORY_ID',0))==19)
        print(f"  Определено как КОМ после обогащения: {kom}")
    else:
        print("  Нет обновлений")


if __name__ == '__main__':
    main()
