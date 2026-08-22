/**
 * ratings-dashboard — фронтенд дашборда «Рейтинги» (разбит на модули).
 *
 * ЗАЧЕМ: рейтинги по продуктам/источникам/компаниям за период. Таблицы считаются
 *   НА КЛИЕНТЕ (buildFilteredData из недельных weeks[].by_prod/by_src/by_company),
 *   поэтому фильтры (исключить КОМ и т.п.) должны быть и в недельной агрегации
 *   analyze.js — иначе на дашборде не сработают (см. README).
 *
 * Грузится несколькими classic-скриптами (общий global-scope) В ТАКОМ ПОРЯДКЕ:
 *   app-core.js        — состояние, safeFetch, date-хелперы, loadAll, renderFilteredData (ЭТОТ файл)
 *   app-build-data.js  — buildFilteredData: клиентская агрегация среза за период
 *   app-render.js      — renderPageMainNew: отрисовка таблиц (продукты/источники/компании/МВА)
 *   app-export.js      — календарь периода, Excel-экспорт, запуск loadAll() (грузится ПОСЛЕДНИМ)
 *
 * Общие хелперы (escapeHtml/api/fmt/fmtPct/initTableSort/shortCompany/BASE_PATH) —
 * в /shared.js. Здесь — только специфичные для рейтингов (safeFetch и т.п.).
 */

async function safeFetch(url, opts) {
  var resp = await fetch(url, opts);
  if (resp.redirected || resp.url.endsWith('/login')) { window.location.href = '/login'; throw new Error('redirect'); }
  var text = await resp.text();
  if (text.startsWith('<!DOCTYPE')) { window.location.href = '/login'; throw new Error('redirect'); }
  return JSON.parse(text);
}

// --- Общее состояние (объявлено здесь, используется всеми модулями) ---
let dataCache = null;
let dateFromCache = null;
let dateToCache = null;
let userRole = 'guest';
var lastRatingsData = null; // последний отрисованный срез (для Excel-экспорта за выбранный период)
var rcPeriod = null;        // виджет календаря периода (инициализируется в app-export.js)

// --- Date helpers ---
function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}
function weeksInRange(weeks, dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return weeks;
  var wnFrom = getWeekNumber(new Date(dateFrom)).week;
  var wnTo = getWeekNumber(new Date(dateTo)).week;
  return weeks.filter(function(w) {
    return w.week >= wnFrom && w.week <= wnTo;
  });
}

async function loadAll() {
  // Fetch user role first
  try {
    var u = await safeFetch((window.BASE_PATH || '') + '/api/user');
    if (u && u.role) userRole = u.role;
  } catch(e) {}


  var areaNew = document.getElementById('contentAreaNew');
  if (!areaNew) return;
  try {
    const d = await api('/api/data/new');
    if (!d || !d.ytd) return;
    dataCache = d;

    // Устанавливаем dateFrom/dateTo по умолчанию: с 01.01.2026 до today
    var dateFromDefault = '2026-01-01';
    document.getElementById('dateFrom').value = dateFromDefault;
    var todayStr = new Date().toISOString().substring(0, 10);
    document.getElementById('dateTo').value = todayStr;
    dateFromCache = document.getElementById('dateFrom').value;
    dateToCache = document.getElementById('dateTo').value;
    if (rcPeriod) rcPeriod.setRange(dateFromDefault, todayStr);

    renderFilteredData();

    var dateEl = document.getElementById('updateDate');
    if (dateEl && d._loadedAt) {
      var dt = new Date(d._loadedAt);
      dateEl.textContent = '(Данные на: ' + dt.toLocaleDateString('ru-RU') + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ')';
    }

  } catch (e) {
    console.error('loadAll error:', e);
    if (areaNew) areaNew.innerHTML = '<div class="error-state">❌ Ошибка загрузки: '+escapeHtml(e.message)+'<br>Нажмите «🔄 Обновить данные»</div>';
  }
}

function renderFilteredData() {
  var d = dataCache;
  if (!d) return;
  var dateFrom = document.getElementById('dateFrom').value;
  var dateTo = document.getElementById('dateTo').value;
  dateFromCache = dateFrom;
  dateToCache = dateTo;

  // Фильтруем недели по диапазону
  var allWeeks = d.weeks || [];
  var filtered = allWeeks;
  if (dateFrom && dateTo) {
    filtered = weeksInRange(allWeeks, dateFrom, dateTo);
  }

  // Пересчитываем KPI из отфильтрованных недель
  var filteredData = buildFilteredData(d, filtered);

  // Обновляем info
  var infoEl = document.getElementById('filterInfo');
  if (filtered.length === allWeeks.length) {
    infoEl.textContent = 'все недели (' + allWeeks.length + ')';
  } else {
    infoEl.textContent = 'недели ' + String(filtered[0]?.week||'').padStart(2,'0') + '—' + String(filtered[filtered.length-1]?.week||'').padStart(2,'0') + ' (' + filtered.length + ' из ' + allWeeks.length + ')';
  }

  renderPageMainNew(filteredData);
}
