/**
 * app-data.js — загрузка и фильтрация данных по периоду.
 *
 * loadAll(): первичная загрузка /api/data + период по умолчанию (год → сегодня).
 * renderFilteredData(): по выбранному периоду тянет /api/kpi и /api/reg-funnel (текущий +
 *   период сравнения), склеивает через applyPeriodKpi() и отдаёт в renderPageMainNew().
 * Общее состояние (dataCache, rcPeriod, lastRenderData) объявлено в app-core.js.
 */

async function loadAll() {
  var areaNew = document.getElementById('contentAreaNew');
  if (!areaNew) return;

  try {
    const d = await api('/api/data');
    if (!d || !d.ytd) return;
    dataCache = d;

    // Дата обновления в заголовке
    var dateEl = document.getElementById('updateDate');
    if (dateEl && d._loadedAt) {
      var dt = new Date(d._loadedAt);
      var dtStr = dt.toLocaleDateString('ru-RU') + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      dateEl.textContent = '(Данные на: ' + dtStr + ')';
    }

    var yearFrom = (d.year || new Date().getFullYear()) + '-01-01';
    var todayStr = new Date().toISOString().substring(0, 10);
    document.getElementById('dateFrom').value = yearFrom;
    document.getElementById('dateTo').value = todayStr;
    rcPeriod.setRange(yearFrom, todayStr);
    dateFromCache = yearFrom;
    dateToCache = todayStr;

    renderFilteredData();
  } catch (e) {
    console.error('loadAll error:', e);
    if (areaNew) areaNew.innerHTML = '<div class="alert alert-danger">❌ Ошибка загрузки: '+escapeHtml(e.message)+'</div>';
  }
}

function fmtDMY(iso) {
  var p = iso.split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

// Пересчитывает конец периода сравнения по длине основного периода и показывает
// весь диапазон «start—end» в одном поле compareDisplay (как и «Период»)
function updateCompareToField() {
  var dateFrom = document.getElementById('dateFrom').value;
  var dateTo = document.getElementById('dateTo').value;
  var compareFrom = document.getElementById('compareFrom').value;
  var compareDisplayEl = document.getElementById('compareDisplay');
  if (!dateFrom || !dateTo || !compareFrom) { compareDisplayEl.value = ''; return; }
  var lenMs = new Date(dateTo).getTime() - new Date(dateFrom).getTime();
  var compareTo = new Date(new Date(compareFrom).getTime() + lenMs);
  var compareToIso = compareTo.toISOString().substring(0, 10);
  compareDisplayEl.value = fmtDMY(compareFrom) + '—' + fmtDMY(compareToIso);
}

async function renderFilteredData() {
  var d = dataCache;
  if (!d) return;
  var dateFrom = document.getElementById('dateFrom').value;
  var dateTo = document.getElementById('dateTo').value;
  var compareFrom = document.getElementById('compareFrom').value;
  dateFromCache = dateFrom;
  dateToCache = dateTo;
  updateCompareToField();

  // Недельные графики и таблица всегда показывают полный год — фильтр их не трогает.
  // KPI-карточки и донаты считаются сервером точно по дням выбранного периода.
  var filteredData = JSON.parse(JSON.stringify(d));

  if (dateFrom && dateTo) {
    try {
      var kpiParams = '/api/kpi?from=' + dateFrom + '&to=' + dateTo;
      if (compareFrom) kpiParams += '&compare_from=' + compareFrom;
      var kpi = await api(kpiParams);
      applyPeriodKpi(filteredData, kpi);
    } catch (e) { console.error('/api/kpi error:', e); }
  }

  // Воронка регистраций — фильтруется по DATE_CREATE через отдельный endpoint
  try {
    var params = '';
    if (dateFrom) params += (params ? '&' : '?') + 'from=' + dateFrom;
    if (dateTo)   params += (params ? '&' : '?') + 'to='   + dateTo;
    var regData = await api('/api/reg-funnel' + params);
    filteredData.reg_ytd = regData;
  } catch (e) { /* fallback: оставляем оригинальные данные */ }

  // Воронка регистраций за период сравнения (по умолчанию — та же длина вплотную назад;
  // если задан compareFrom — от него)
  try {
    var msFrom = new Date(dateFrom).getTime();
    var msTo   = new Date(dateTo).getTime();
    var dur    = msTo - msFrom;
    var ppFrom, ppTo;
    if (compareFrom) {
      ppFrom = new Date(compareFrom);
      ppTo   = new Date(ppFrom.getTime() + dur);
    } else {
      ppTo   = new Date(msFrom - 86400000);
      ppFrom = new Date(ppTo.getTime() - dur);
    }
    var ppRegParams = '?from=' + ppFrom.toISOString().substring(0,10) + '&to=' + ppTo.toISOString().substring(0,10);
    var ppRegData = await api('/api/reg-funnel' + ppRegParams);
    ppRegData.avg_check  = ppRegData.total_paid > 0 ? Math.round(ppRegData.total_paid_sum / ppRegData.total_paid) : 0;
    ppRegData.conv       = ppRegData.total > 0 ? parseFloat((ppRegData.total_paid / ppRegData.total * 100).toFixed(1)) : 0;
    ppRegData.lose_pct   = ppRegData.total > 0 ? parseFloat((ppRegData.lose / ppRegData.total * 100).toFixed(1)) : 0;
    filteredData.pp_reg_ytd = ppRegData;
  } catch (e) { filteredData.pp_reg_ytd = null; }

  // Обновляем info
  var infoEl = document.getElementById('filterInfo');
  if (infoEl && dateFrom && dateTo) {
    var days = Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1;
    infoEl.textContent = 'период: ' + days + ' дн. (пред.: ' + (filteredData.pp && filteredData.pp.label || '—') + ')';
  }

  lastRenderData = filteredData;
  renderPageMainNew(filteredData);
}

// Накладывает точные данные периода из /api/kpi поверх годовых агрегатов
function applyPeriodKpi(out, kpi) {
  var c = kpi.current, p = kpi.previous;
  function block(t) {
    return {
      postupleniya: t.postupleniya, won_relevant_cnt: t.won_relevant_cnt,
      avg_check: t.avg_check, avg_close_days_won: t.avg_close_days_won,
      paid_created_same_pct: t.paid_created_same_pct
    };
  }
  out.ytd     = Object.assign({}, out.ytd,     block(c.total));
  out.oom_ytd = Object.assign({}, out.oom_ytd, block(c.oom));
  out.kom_ytd = Object.assign({}, out.kom_ytd, block(c.kom));
  out.leads_ytd = c.total.leads;   out.qual_lead_ytd = c.total.mql;
  out.oom_leads_ytd = c.oom.leads; out.oom_qual_lead_ytd = c.oom.mql;
  out.kom_leads_ytd = c.kom.leads; out.kom_qual_lead_ytd = c.kom.mql;

  function fmtD(s) { var p = s.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  out.pp = {
    ytd: block(p.total), oom_ytd: block(p.oom), kom_ytd: block(p.kom),
    leads_ytd: p.total.leads, qual_lead_ytd: p.total.mql,
    oom_leads_ytd: p.oom.leads, oom_qual_lead_ytd: p.oom.mql,
    kom_leads_ytd: p.kom.leads, kom_qual_lead_ytd: p.kom.mql,
    label: fmtD(kpi.prev_period.from) + ' — ' + fmtD(kpi.prev_period.to),
    splits: p.splits || {}
  };

  // Донаты — структура продаж за выбранный период
  var s = c.splits || {};
  out.fmt_ytd   = Object.assign({ period: 'период' }, s.fmt || {});
  out.edu_ytd   = Object.assign({ period: 'период' }, s.edu || {});
  out.btype_ytd = Object.assign({ period: 'период' }, s.btype || {});
  out.src_split_ytd = { period: 'период', internal: (s.src || {}).internal || { cnt: 0, sum: 0 }, marketing: (s.src || {}).marketing || { cnt: 0, sum: 0 } };
}
