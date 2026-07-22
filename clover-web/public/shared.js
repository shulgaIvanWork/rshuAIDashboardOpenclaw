/**
 * shared.js — общие фронтенд-хелперы для всех дашбордов.
 *
 * Подключается в index.html каждого дашборда ПЕРЕД app.js:
 *   <script src="/shared.js"></script>
 *   <script src="app.js"></script>
 *
 * Раньше эти функции были скопированы в каждый app.js и понемногу расходились.
 * Правки — только здесь; в app.js оставляйте только логику конкретного дашборда.
 */

// ── BASE_PATH ─────────────────────────────────────────────────────────────────
// Автоопределение префикса: дашборд работает и самостоятельным сайтом,
// и как sub-app клевера (/participants-dashboard/...).
(function () {
  if (typeof window.BASE_PATH !== 'undefined') return; // уже задан вручную
  var m = window.location.pathname.match(/^\/([^/]+?)(?:\/|$)/);
  window.BASE_PATH = m ? '/' + m[1] : '';
})();

// ── API ───────────────────────────────────────────────────────────────────────
// fetch с таймаутом 30с и редиректом на /login, если сессия протухла.
async function api(path) {
  var url = (window.BASE_PATH || '') + path;
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 30000);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (r.redirected || r.url.endsWith('/login')) { window.location.href = '/login'; throw new Error('redirect'); }
    var text = await r.text();
    if (text.startsWith('<!DOCTYPE')) { window.location.href = '/login'; throw new Error('redirect'); }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Форматирование ────────────────────────────────────────────────────────────
function fmt(n) {
  if (n === undefined || n === null || n === 0) return '0';
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function fmtPct(n) {
  if (n === undefined || n === null) return '0.0';
  return Number(n).toFixed(1);
}

function escapeHtml(s) {
  return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
}

// ── Сокращение организационно-правовых форм компаний ──────────────────────────
// «ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ Ромашка» → «ООО Ромашка».
// Раньше было скопировано в participants и ratings app.js и разошлось —
// единый источник здесь (тот же приём, что deal-rules.js на бэке).
var COMPANY_PREFIXES = [
  // Самое длинное — первым (startsWith проверит по порядку)
  ['ИНОСТРАННОЕ ПРЕДПРИЯТИЕ ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ', 'ИП ООО'],
  ['ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ ВЫСШЕГО ОБРАЗОВАНИЯ', 'ФГБОУ ВО'],
  ['ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ', 'ФГБОУ'],
  ['ЧАСТНОЕ ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ ДОПОЛНИТЕЛЬНОГО ПРОФЕССИОНАЛЬНОГО ОБРАЗОВАНИЯ', 'ЧОУ ДПО'],
  ['ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ ПРОФЕССИОНАЛЬНОЕ ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ', 'ГБПОУ'],
  ['ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ', 'ГБОУ'],
  ['ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ', 'ООО'],
  ['МУНИЦИПАЛЬНОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ', 'МУП'],
  ['ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО', 'ПАО'],
  ['АВТОНОМНАЯ НЕКОММЕРЧЕСКАЯ ОРГАНИЗАЦИЯ', 'АНО'],
  ['НЕКОММЕРЧЕСКАЯ ОРГАНИЗАЦИЯ', 'НО'],
  ['НЕКОММЕРЧЕСКОЕ ПАРТНЕРСТВО', 'НП'],
  ['ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ', 'ОУ'],
  ['ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ', 'ИП'],
  ['ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО', 'ЗАО'],
  ['АКЦИОНЕРНОЕ ОБЩЕСТВО', 'АО'],
];

function shortCompany(name) {
  if (!name) return name;
  var s = name.toUpperCase();
  for (var i = 0; i < COMPANY_PREFIXES.length; i++) {
    var full = COMPANY_PREFIXES[i][0], short = COMPANY_PREFIXES[i][1];
    if (s.startsWith(full)) return short + name.substring(full.length);
  }
  // Форма в скобках в конце: Банк ВТБ (публичное акционерное общество) → Банк ВТБ (ПАО)
  return name
    .replace(/\(публичное акционерное общество\)/gi, '(ПАО)')
    .replace(/\(акционерное общество\)/gi, '(АО)')
    .replace(/\(общество с ограниченной ответственностью\)/gi, '(ООО)');
}

// ── Сортировка таблиц (клик по заголовку th.sort с data-col) ──────────────────
// initTableSort()          — навешивает на все <table class="sortable"> на странице
// initTableSort('tableId') — только на конкретную таблицу
// Строки <tr class="total-row"> всегда остаются сверху.
function initTableSort(tableId) {
  var tables = tableId
    ? [document.getElementById(tableId)].filter(Boolean)
    : Array.from(document.querySelectorAll('table.sortable'));
  tables.forEach(function (tbl) {
    var ths = tbl.querySelectorAll('thead th.sort');
    ths.forEach(function (th) {
      th.addEventListener('click', function () {
        var col = parseInt(th.dataset.col);
        var tbody = tbl.querySelector('tbody');
        if (!tbody) return;
        var rows = Array.from(tbody.querySelectorAll('tr:not(.total-row)'));
        var totalRows = Array.from(tbody.querySelectorAll('tr.total-row'));
        var isAsc = th.classList.contains('asc');
        ths.forEach(function (h) { h.classList.remove('asc', 'desc'); });
        th.classList.add(isAsc ? 'desc' : 'asc');
        rows.sort(function (a, b) {
          var va = ((a.cells[col] || {}).innerText || '').trim();
          var vb = ((b.cells[col] || {}).innerText || '').trim();
          var na = parseFloat(va.replace(/[^\d\-.,]/g, '').replace(',', ''));
          var nb = parseFloat(vb.replace(/[^\d\-.,]/g, '').replace(',', ''));
          if (!isNaN(na) && !isNaN(nb)) return isAsc ? na - nb : nb - na;
          return isAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        });
        totalRows.concat(rows).forEach(function (r) { tbody.appendChild(r); });
      });
    });
  });
}
