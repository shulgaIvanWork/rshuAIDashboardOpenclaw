# =============================================================
#  КОНФИГУРАЦИЯ — все настройки меняются только здесь
# =============================================================
import os

# Корень скриптов
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Кэш-директория (данные, доступные серверу)
CACHE_DIR = os.path.join(SCRIPT_DIR, '..', 'cache')

# Bitrix24 REST-endpoint (BASE + метод + .json)
BASE = "https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/"

# Отчётный год
YEAR = 2026

# Минимальная сумма сделки для учёта в поступлениях
MIN_OPP = 11.0

# ---------------------------------------------------------------
# Выходная папка для готовых файлов (HTML + Excel)
# ---------------------------------------------------------------
OUTPUT_DIR = os.path.join(CACHE_DIR, 'output')

HTML_FILE = "Отчёт_продажи_2026.html"
XLSX_FILE = "Отчёт_продажи_2026.xlsx"

# ---------------------------------------------------------------
# Промежуточные папки (создаются автоматически)
# ---------------------------------------------------------------
PAGES_CREATE = os.path.join(CACHE_DIR, 'pages_CREATE')
PAGES_CLOSE  = os.path.join(CACHE_DIR, 'pages_CLOSE')
LEADS_PAGES  = os.path.join(CACHE_DIR, 'leads_pages')

# ---------------------------------------------------------------
# Файлы состояния инкрементальной выгрузки
# ---------------------------------------------------------------
STATE_CREATE = os.path.join(CACHE_DIR, 'state_CREATE.json')
STATE_CLOSE  = os.path.join(CACHE_DIR, 'state_CLOSE.json')
LEADS_STATE  = os.path.join(CACHE_DIR, 'leads_state.json')

# ---------------------------------------------------------------
# Промежуточные JSON-файлы
# ---------------------------------------------------------------
DEALS_JSON = os.path.join(CACHE_DIR, 'deals_2026.json')
DICTS_JSON = os.path.join(CACHE_DIR, 'dicts.json')
CC_JSON    = os.path.join(CACHE_DIR, 'company_contact.json')
AGG_JSON   = os.path.join(CACHE_DIR, 'agg.json')

# Таймаут HTTP-запросов (сек)
TIMEOUT = 90
