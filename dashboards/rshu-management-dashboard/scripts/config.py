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
AGG_JSON   = os.path.join(CACHE_DIR, 'agg_new.json')

# Таймаут HTTP-запросов (сек)
TIMEOUT = 90

# SSL-контекст (MSYS2-Python не имеет системных CA — отключаем проверку)
import ssl as _ssl
import urllib.request as _urllib_request
import json as _json

SSL_CTX = _ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = _ssl.CERT_NONE

def http_post(url, body: bytes, headers: dict = None, timeout=TIMEOUT):
    """POST-запрос с обходом проверки SSL-сертификата."""
    req = _urllib_request.Request(url, data=body, method='POST')
    if headers and 'Content-Type' in headers:
        req.add_header('Content-Type', headers['Content-Type'])
        extra = {k: v for k, v in headers.items() if k != 'Content-Type'}
    else:
        req.add_header('Content-Type', 'application/json')
        extra = headers or {}
    for k, v in extra.items():
        req.add_header(k, v)
    with _urllib_request.urlopen(req, context=SSL_CTX, timeout=timeout) as r:
        return _json.loads(r.read().decode())
