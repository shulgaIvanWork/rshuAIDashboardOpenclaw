/**
 * rshu-management-dashboard — фронтенд «Управленческого дашборда» (разбит на модули).
 *
 * ЗАЧЕМ: сводка для руководства за произвольный период — KPI по каналам, воронка
 *   регистраций/источников, графики, блок аномалий данных.
 *
 * Грузится несколькими <script defer> (общий global-scope) В ТАКОМ ПОРЯДКЕ:
 *   app-core.js   — Chart-guard, состояние, календари периода/сравнения, periodModes, loadArtifacts (ЭТОТ файл)
 *   app-data.js   — loadAll + фильтр периода: renderFilteredData, applyPeriodKpi, updateCompareToField
 *   app-render.js — renderPageMainNew: KPI-карточки, таблицы, графики (Chart.js)
 *   app-boot.js   — запуск loadAll() (грузится ПОСЛЕДНИМ)
 *
 * Хелперы escapeHtml/api/fmt/fmtPct/initTableSort — в /shared.js.
 */

function loadArtifacts(mgr) {
  fetch((window.BASE_PATH || '') + '/api/artifacts' + (mgr && mgr !== 'all' ? '?mgr=' + encodeURIComponent(mgr) : '')).then(function(r) {
    if (r.status === 403) return null;
    return r.json();
  }).then(function(d) {
    var el = document.getElementById('newArtifactsBlock');
    if (!el || !d) return;
    var s = d.summary || {};
    var hasAny = s.returns?.cnt || s.inProgressPaid?.cnt || s.wonNoPay?.cnt || s.negativeDuration?.cnt ||
      s.otherCatPaid?.cnt || s.nextYear?.cnt || s.formatRule2?.cnt || s.oldActive?.cnt ||
      s.mmbaDeals?.cnt || s.noTypeEdu?.cnt || s.autopayDeals?.cnt || s.overdueAgreed?.cnt;
    if (!hasAny) {
      el.innerHTML = '<div style="padding:8px;color:#475569;font-size:12px">Аномалий не обнаружено ✅</div>';
      return;
    }
    var h = '<div style="font-size:12px;background:#F1F3F6;border-radius:8px;padding:12px;margin:8px 0">';
    h += '<b>⚠ Аномалии данных</b><table style="width:100%;margin-top:8px;font-size:12px;border-collapse:collapse">';
    if (s.returns?.cnt)        h += '<tr><td>🔙 Возвраты (LOSE+PAY)</td><td style="text-align:right">'+s.returns.cnt+' шт.</td><td style="text-align:right;color:#C62828">'+fmt(s.returns.sum)+' ₽</td></tr>';
    if (s.inProgressPaid?.cnt) h += '<tr><td>📌 В работе + оплата</td><td style="text-align:right">'+s.inProgressPaid.cnt+' шт.</td><td style="text-align:right;color:#E65100">'+fmt(s.inProgressPaid.sum)+' ₽</td></tr>';
    if (s.wonNoPay?.cnt)       h += '<tr><td>✅ WON без даты оплаты</td><td style="text-align:right">'+s.wonNoPay.cnt+' шт.</td><td style="text-align:right;color:#1565C0">'+fmt(s.wonNoPay.sum)+' ₽</td></tr>';
    if (s.negativeDuration?.cnt) h += '<tr><td>⏪ Оплата раньше создания</td><td style="text-align:right">'+s.negativeDuration.cnt+' шт.</td><td style="text-align:right;color:#6A1B9A">'+fmt(s.negativeDuration.sum)+' ₽</td></tr>';
    if (s.otherCatPaid?.cnt)   h += '<tr><td>📂 Др. категории с оплатой</td><td style="text-align:right">'+s.otherCatPaid.cnt+' шт.</td><td style="text-align:right">'+fmt(s.otherCatPaid.sum)+' ₽</td></tr>';
    if (s.nextYear?.cnt)       h += '<tr><td>📅 «Следующий год»</td><td style="text-align:right">'+s.nextYear.cnt+' шт.</td><td style="text-align:right">'+fmt(s.nextYear.sum)+' ₽</td></tr>';
    if (s.formatRule2?.cnt)    h += '<tr><td>🏷 Формат без UF_FORMAT</td><td style="text-align:right">'+s.formatRule2.cnt+' шт.</td><td style="text-align:right;color:#FF8A65">'+fmt(s.formatRule2.sum)+' ₽</td></tr>';
    if (s.oldActive?.cnt)      h += '<tr><td>⏳ Старые сделки Sale в работе</td><td style="text-align:right">'+s.oldActive.cnt+' шт.</td><td style="text-align:right;color:#E65100">'+fmt(s.oldActive.sum)+' ₽</td></tr>';
    if (s.mmbaDeals?.cnt)      h += '<tr><td>📋 MMBA→СДО</td><td style="text-align:right">'+s.mmbaDeals.cnt+' шт.</td><td style="text-align:right;color:#9C27B0">'+fmt(s.mmbaDeals.sum)+' ₽</td></tr>';
    if (s.noTypeEdu?.cnt)      h += '<tr><td>📝 Без типа обучения</td><td style="text-align:right">'+s.noTypeEdu.cnt+' шт.</td><td style="text-align:right;color:#00bcd4">'+fmt(s.noTypeEdu.sum)+' ₽</td></tr>';
    if (s.autopayDeals?.cnt)   h += '<tr><td>🔄 Автооплаты (без даты счёта)</td><td style="text-align:right">'+s.autopayDeals.cnt+' шт.</td><td style="text-align:right;color:#3079D2">'+fmt(s.autopayDeals.sum)+' ₽</td></tr>';
    if (s.overdueAgreed?.cnt)  h += '<tr><td>⏰ Просрочена согласованная дата оплаты</td><td style="text-align:right">'+s.overdueAgreed.cnt+' шт.</td><td style="text-align:right;color:#F57C00">'+fmt(s.overdueAgreed.sum)+' ₽</td></tr>';
    h += '</table></div>';
    el.innerHTML = h;
  }).catch(function() {});
}

// Защита от падения, если CDN с Chart.js не загрузился
if (typeof Chart !== 'undefined' && Chart.register && typeof ChartDataLabels !== 'undefined') {
  try { Chart.register(ChartDataLabels); } catch(e) {}
}

let chartInstances = {};
let dataCache = null;
let dateFromCache = null;
let dateToCache = null;

// Календарики на полях периода/сравнения (свой RangeCalendar, /vendor/range-calendar/)
// #dateFrom/#dateTo/#compareFrom — скрытые поля с ISO-значением (как и раньше читает весь код ниже);
// периодDisplay/compareDisplay — видимые поля, на которые повешен попап-календарь.
var rcPeriod = RangeCalendar.attach(document.getElementById('periodDisplay'), {
  mode: 'range',
  onApply: function(startISO, endISO) {
    document.getElementById('dateFrom').value = startISO;
    document.getElementById('dateTo').value = endISO;
    renderFilteredData();
  }
});
var rcCompare = RangeCalendar.attach(document.getElementById('compareDisplay'), {
  mode: 'single',
  onApply: function(startISO) {
    document.getElementById('compareFrom').value = startISO;
    renderFilteredData();
  }
});

// Переключатель Недели/Месяцы для понедельных графиков и таблицы
window.periodModes = window.periodModes || { pos: 'weeks', funnel: 'weeks', table: 'weeks' };
let lastRenderData = null;
window.setPeriodMode = function(block, m) {
  window.periodModes[block] = m;
  if (lastRenderData) renderPageMainNew(lastRenderData);
};
