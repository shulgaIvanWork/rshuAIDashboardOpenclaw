/**
 * app-render.js — renderPageMainNew(): вся отрисовка страницы.
 *
 * KPI-секции (Итого/ООМ/КОМ с дельтами к периоду сравнения), блок «Отчёт по менеджерам»
 * (Таблица 1/2 + горизонтальные срезы), поступления (Дни/Недели/Месяцы), две воронки,
 * KPI регистрации, недельная/месячная таблица и графики Chart.js (в setTimeout).
 * Переключатель Дни/Недели/Месяцы — через window.periodModes (app-core.js) и setPeriodMode().
 */

// ── Блок «Продажи по менеджерам» ─────────────────────────────────────────────
// mgr — ответ /api/managers-sales: {managers, groups, labels, total, period, prev_period}.
// Одна таблица: менеджеры продаж + строки-группы (Автооплаты, ОЗК, Прочие) без
// расшифровки состава + общая строка ИТОГО (как во всех таблицах дашборда).
function renderManagersBlock(mgr) {
  // Строка менеджера или группы (у группы gname — название, иначе имя менеджера)
  function rowHtml(name, m, opts) {
    var dCls = 'delta-flat', dSym = '→', dTxt = '—';
    if (m.prev_postupleniya > 0) {
      dCls = m.delta_pct >= 0 ? 'delta-up' : 'delta-down';
      dSym = m.delta_pct >= 0 ? '▲' : '▼';
      dTxt = Math.abs(m.delta_pct).toFixed(1) + '%';
    } else if (m.postupleniya > 0) {
      dTxt = 'новый';
    }
    return '<tr' + (opts && opts.cls ? ' class="' + opts.cls + '"' : '') + '>'
      + '<td>' + escapeHtml(name) + '</td>'
      + '<td>' + fmt(m.won_cnt) + '</td>'
      + '<td>' + fmt(m.postupleniya) + ' ₽</td>'
      + '<td>' + fmt(m.avg_check) + ' ₽</td>'
      + '<td>' + (m.avg_close_days_won || 0).toFixed(1) + '</td>'
      + '<td>' + fmt(m.leads) + '</td>'
      + '<td>' + fmt(m.mql) + '</td>'
      + '<td><span class="' + dCls + '">' + dSym + ' ' + dTxt + '</span></td>'
      + '<td>' + (m.share_pct || 0).toFixed(1) + '%</td>'
      + '</tr>';
  }
  // Сумма по группе менеджеров (без расшифровки состава)
  function sumGroup(arr) {
    var s = arr.reduce(function (a, m) {
      return { postupleniya: a.postupleniya + m.postupleniya, won_cnt: a.won_cnt + m.won_cnt, leads: a.leads + (m.leads || 0), mql: a.mql + (m.mql || 0), prev: a.prev + (m.prev_postupleniya || 0), durSum: a.durSum + (m.avg_close_days_won || 0) * (m.won_cnt || 0) };
    }, { postupleniya: 0, won_cnt: 0, leads: 0, mql: 0, prev: 0, durSum: 0 });
    var deltaAbs = s.postupleniya - s.prev;
    var deltaPct = s.prev > 0 ? (deltaAbs / s.prev * 1000 / 10) : (s.postupleniya > 0 ? 100 : 0);
    return {
      won_cnt: s.won_cnt,
      postupleniya: s.postupleniya,
      avg_check: s.won_cnt ? Math.round(s.postupleniya / s.won_cnt) : 0,
      avg_close_days_won: s.won_cnt ? Math.round(s.durSum / s.won_cnt * 10) / 10 : 0,
      leads: s.leads, mql: s.mql,
      prev_postupleniya: s.prev, delta_pct: deltaPct,
    };
  }

  var managers = mgr.managers || [];
  var grpAuto = ((mgr.groups || {}).autopay || []).filter(function (m) { return m.postupleniya > 0; });
  var grpOzk   = ((mgr.groups || {}).ozk   || []).filter(function (m) { return m.postupleniya > 0; });
  var grpOther = ((mgr.groups || {}).other || []).filter(function (m) { return m.postupleniya > 0; });
  var ga = sumGroup(grpAuto);
  var go = sumGroup(grpOzk);
  var gp = sumGroup(grpOther);

  // Общие итоги по всем строкам таблицы
  var totM = managers.reduce(function (a, m) { return { p: a.p + m.postupleniya, c: a.c + m.won_cnt, l: a.l + (m.leads || 0), q: a.q + (m.mql || 0) }; }, { p: 0, c: 0, l: 0, q: 0 });
  var totSum = totM.p + ga.postupleniya + go.postupleniya + gp.postupleniya;
  var totCnt = totM.c + ga.won_cnt + go.won_cnt + gp.won_cnt;
  var totLeads = totM.l + ga.leads + go.leads + gp.leads;
  var totMql = totM.q + ga.mql + go.mql + gp.mql;

  // Доли — от общей суммы строк таблицы (ИТОГО = 100%) — до построения строк
  if (totSum > 0) {
    managers.forEach(function (m) { m.share_pct = m.postupleniya / totSum * 100; });
    ga.share_pct = ga.postupleniya / totSum * 100;
    go.share_pct = go.postupleniya / totSum * 100;
    gp.share_pct = gp.postupleniya / totSum * 100;
  }

  // Строки: менеджеры + группы (Автооплаты, ОЗК, Прочие) — после пересчёта долей
  var rows = [];
  managers.forEach(function (m) { rows.push(rowHtml(m.name, m, {})); });
  if (grpAuto.length)  rows.push(rowHtml('Автооплаты', ga, { cls: 'mgr-group-row' }));
  if (grpOzk.length)   rows.push(rowHtml('ОЗК', go, { cls: 'mgr-group-row' }));
  if (grpOther.length) rows.push(rowHtml('Прочие (уволенные)', gp, { cls: 'mgr-group-row' }));

  var head ='<tr><th class="sort" data-col="0">Менеджер</th><th class="sort" data-col="1">Сделок</th><th class="sort" data-col="2">Поступления</th><th class="sort" data-col="3">Ср. чек</th><th class="sort" data-col="4">Цикл, дн</th><th class="sort" data-col="5">Лиды</th><th class="sort" data-col="6">MQL</th><th class="sort" data-col="7">Δ к пред.</th><th class="sort" data-col="8">Доля</th></tr>';
  var totDur = [ga, go, gp].reduce(function (a, g) { return a + (g.avg_close_days_won || 0) * (g.won_cnt || 0); }, managers.reduce(function (a, m) { return a + (m.avg_close_days_won || 0) * (m.won_cnt || 0); }, 0));
  var totDurV = totCnt ? Math.round(totDur / totCnt * 10) / 10 : 0;
  var h = '<div class="card" style="margin-top:8px"><h2>Продажи по менеджерам <span style="font-size:12px;color:#475569;font-weight:400">(за выбранный период · пред.: ' + mgr.prev_period.from + ' — ' + mgr.prev_period.to + ')</span></h2>';
  h += '<div class="scroll-x"><table class="table table-sm sortable" id="mgrTableMain" style="font-size:11px;margin-bottom:0"><thead>' + head + '</thead><tbody>';
  h += '<tr class="total-row" style="background:#eef1f8;font-weight:700;border-top:2px solid #1f2a44;border-bottom:2px solid #1f2a44"><td>ИТОГО</td><td>' + fmt(totCnt) + '</td><td>' + fmt(totSum) + ' ₽</td><td>' + fmt(totCnt ? Math.round(totSum / totCnt) : 0) + ' ₽</td><td>' + totDurV.toFixed(1) + '</td><td>' + fmt(totLeads) + '</td><td>' + fmt(totMql) + '</td><td>—</td><td>100%</td></tr>';
  rows.forEach(function (r) { h += r; });
  h += '</tbody></table></div></div>';
  return h;
}

// ── Фильтры Таблиц 1/2: форма обучения + трафик ─────────────────────────────
// Перезапрашивают /api/managers-report с параметрами form/traffic и перерисовывают
// весь блок (таблицы + срезы). Состояние сохраняется при смене периода (app-data.js).
window.mgrReportFilter = window.mgrReportFilter || { form: 'all', traffic: 'all' };
function mgrReportFilterHtml() {
  var f = window.mgrReportFilter;
  function opt(v, l, cur) { return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + l + '</option>'; }
  return '<span style="float:right;font-weight:400;font-size:12px">'
    + '<select onchange="setMgrReportFilter(\'form\',this.value)" style="padding:3px 8px;font-size:12px">'
      + opt('all', 'Все формы', f.form) + opt('oom', 'Открытое обучение', f.form) + opt('kom', 'Корпоративное обучение', f.form)
    + '</select>'
    + '<select onchange="setMgrReportFilter(\'traffic\',this.value)" style="padding:3px 8px;font-size:12px;margin-left:6px">'
      + opt('all', 'Весь трафик', f.traffic) + opt('internal', 'Внутренняя база', f.traffic) + opt('market', 'Маркетинговый трафик', f.traffic)
    + '</select></span>';
}
window.setMgrReportFilter = function (kind, val) {
  window.mgrReportFilter[kind] = val;
  var from = (document.getElementById('dateFrom') || {}).value || '';
  var to   = (document.getElementById('dateTo') || {}).value || '';
  var qs = [];
  if (from && to) qs.push('from=' + from, 'to=' + to);
  qs.push('form=' + window.mgrReportFilter.form, 'traffic=' + window.mgrReportFilter.traffic);
  // Срезы живут на «Продажах» (#mgrReportSlices), таблицы 1/2 — на dev-вкладке (#mgrReportDevTables)
  var wrap = document.getElementById('mgrReportSlices');
  var wrapDev = document.getElementById('mgrReportDevTables');
  if (wrap) wrap.style.opacity = '0.5';
  api('/api/managers-report?' + qs.join('&')).then(function (rep) {
    if (lastRenderData) lastRenderData.mgr_report = rep;
    if (window.Chart && Chart.instances) {
      Object.keys(Chart.instances).forEach(function (k) { var c = Chart.instances[k]; if (c.canvas && wrap && wrap.contains(c.canvas)) c.destroy(); });
    }
    if (wrap) wrap.outerHTML = renderMgrReportBlock(rep, 'slices');
    if (wrapDev) wrapDev.outerHTML = renderMgrReportBlock(rep, 'tables');
    initTableSort('mgrTab1'); initTableSort('mgrTab2');
    if (window.Chart) { try { initMgrReportCharts(rep, (lastRenderData && lastRenderData.weeks) || []); } catch (e) {} }
  }).catch(function (e) { console.error('managers-report filter error:', e); var w = document.getElementById('mgrReportSlices'); if (w) w.style.opacity = '1'; });
};

// ── Отчёт по менеджерам: Таблицы 1/2 уехали на dev-вкладку, срезы остались на «Продажах».
// renderMgrReportBlock(rep, mode): 'tables' → dev; 'slices' → «Продажи»; 'all' — целиком.
// rep — ответ /api/managers-report: {managers:[...], period}. Менеджеры уже
// сгруппированы (индивид. + Автооплаты/ОЗК/Прочие). Перенос из manager-report-dev.
function renderMgrReportBlock(rep, mode) {
  // mode: 'tables' (на dev-вкладку: Таблицы 1/2) | 'slices' (на «Продажи»: срезы) | 'all'
  var mgrs = (rep.managers || []).filter(function (m) { return m.paid || m.created || m.in_work_start; });
  if (!mgrs.length) return '';

  function bdg(v, lo, hi) { return v >= hi ? 'green' : v <= lo ? 'red' : 'yellow'; }
  function sK(arr, k) { return arr.reduce(function (s, x) { return s + (x[k] || 0); }, 0); }
  function wavgK(arr, k, w) { var nn = 0, dd = 0; arr.forEach(function (x) { nn += (x[k] || 0) * (x[w] || 0); dd += x[w] || 0; }); return dd ? nn / dd : 0; }
  function pc(v) { return (v || 0).toFixed(1) + '%'; }

  // ── Таблица 1: Основные показатели ──
  var cols1 = [
    { k: 'name', l: 'Менеджер' }, { k: 'in_work_start', l: 'В работе(н)' },
    { k: 'created', l: 'Создано' }, { k: 'na_kvalifikatsii', l: 'На квал-и' },
    { k: 'mql', l: 'MQL' }, { k: 'sql', l: 'SQL' }, { k: 'invoice_cnt', l: 'Счёт' },
    { k: 'paid', l: 'Оплачено' }, { k: 'kval_lost', l: 'Квал отказы' },
    { k: 'nekval_lost', l: 'Не квал' }, { k: 'in_work_end', l: 'В работе(к)' },
    { k: 'paid_sum', l: 'Пост-я' }, { k: 'avg_check', l: 'Ср.чек' },
    { k: 'avg_dur', l: 'Цикл' }, { k: 'conv_pct', l: 'Конв.%' },
  ];
  function cell1(k, v) {
    if (k === 'paid_sum') return '<b>' + fmt(v) + '</b> ₽';
    if (k === 'avg_check') return fmt(v) + ' ₽';
    if (k === 'avg_dur') return v ? v.toFixed(1) : '-';
    if (k === 'conv_pct') return '<span class="mgr-badge mgr-badge-' + bdg(v, 30, 60) + '">' + pc(v) + '</span>';
    return fmt(v);
  }
  var T1 = {};
  cols1.forEach(function (c) {
    if (c.k === 'name') return;
    if (c.k === 'avg_check') T1[c.k] = Math.round(sK(mgrs, 'paid_sum') / (sK(mgrs, 'paid') || 1));
    else if (c.k === 'avg_dur') T1[c.k] = wavgK(mgrs, 'avg_dur', 'paid');
    else if (c.k === 'conv_pct') { var pd = sK(mgrs, 'paid'), lo = sK(mgrs, 'kval_lost') + sK(mgrs, 'nekval_lost'); T1[c.k] = (pd + lo) ? pd / (pd + lo) * 100 : 0; }
    else T1[c.k] = sK(mgrs, c.k);
  });
  var t1 = '<table class="table table-sm sortable" id="mgrTab1" style="font-size:11px"><thead><tr>';
  cols1.forEach(function (c, i) { t1 += '<th class="sort" data-col="' + i + '">' + c.l + '</th>'; });
  t1 += '</tr></thead><tbody>';
  t1 += '<tr class="total-row" style="background:#eef1f8;font-weight:700;border-top:2px solid #1f2a44;border-bottom:2px solid #1f2a44"><td><b>ИТОГО</b></td>';
  cols1.forEach(function (c) { if (c.k !== 'name') t1 += '<td>' + cell1(c.k, T1[c.k]) + '</td>'; });
  t1 += '</tr>';
  mgrs.forEach(function (m) {
    t1 += '<tr><td><b>' + escapeHtml(m.name) + '</b></td>';
    cols1.forEach(function (c) { if (c.k !== 'name') t1 += '<td>' + cell1(c.k, m[c.k] || 0) + '</td>'; });
    t1 += '</tr>';
  });
  t1 += '</tbody></table>';

  // ── Таблица 2: Конверсии и отклонения от среднего ──
  var allLost = sK(mgrs, 'kval_lost') + sK(mgrs, 'nekval_lost');
  var st = {
    conv_lead_mql: sK(mgrs, 'created') ? sK(mgrs, 'mql') / sK(mgrs, 'created') * 100 : 0,
    conv_mql_sql:  sK(mgrs, 'mql') ? sK(mgrs, 'sql') / sK(mgrs, 'mql') * 100 : 0,
    conv_sql_inv:  sK(mgrs, 'sql') ? sK(mgrs, 'invoice_cnt') / sK(mgrs, 'sql') * 100 : 0,
    conv_inv_paid: sK(mgrs, 'invoice_cnt') ? sK(mgrs, 'paid') / sK(mgrs, 'invoice_cnt') * 100 : 0,
    conv_pct:      (sK(mgrs, 'paid') + allLost) ? sK(mgrs, 'paid') / (sK(mgrs, 'paid') + allLost) * 100 : 0,
    avg_dur:       wavgK(mgrs, 'avg_dur', 'paid'),
    avg_check:     sK(mgrs, 'paid') ? sK(mgrs, 'paid_sum') / sK(mgrs, 'paid') : 0,
    paid_sum:      sK(mgrs, 'paid_sum'),
  };
  var cols2 = [
    { k: 'name', l: 'Менеджер' }, { k: 'conv_lead_mql', l: 'Создано→MQL' },
    { k: 'conv_mql_sql', l: 'MQL→SQL' }, { k: 'conv_sql_inv', l: 'SQL→Счёт' },
    { k: 'conv_inv_paid', l: 'Счёт→Оплата' }, { k: 'conv_pct', l: 'Конв.%' },
    { k: 'avg_dur', l: 'Цикл', rev: true }, { k: 'avg_check', l: 'Ср.чек' },
    { k: 'paid_sum', l: 'Пост-я' },
  ];
  function cell2(k, v) {
    if (k === 'paid_sum') return '<b>' + fmt(v) + '</b> ₽';
    if (k === 'avg_check') return fmt(v) + ' ₽';
    if (k === 'avg_dur') return v ? v.toFixed(1) : '-';
    if (k.indexOf('conv') === 0) return pc(v);
    return fmt(v);
  }
  var t2 = '<table class="table table-sm sortable" id="mgrTab2" style="font-size:11px"><thead><tr>';
  cols2.forEach(function (c, i) { t2 += '<th class="sort" data-col="' + i + '" style="font-size:9px">' + c.l + '</th>'; });
  t2 += '</tr></thead><tbody>';
  t2 += '<tr class="total-row" style="background:#eef1f8;font-weight:700;border-top:2px solid #1f2a44;border-bottom:2px solid #1f2a44"><td><b>СРЕДНЕЕ</b></td>';
  cols2.forEach(function (c) { if (c.k !== 'name') t2 += '<td><b>' + cell2(c.k, st[c.k]) + '</b></td>'; });
  t2 += '</tr>';
  mgrs.forEach(function (m) {
    t2 += '<tr><td><b>' + escapeHtml(m.name) + '</b></td>';
    cols2.forEach(function (c) {
      if (c.k === 'name') return;
      var v = m[c.k] || 0, avg = st[c.k];
      var diff = avg ? (v - avg) / avg * 100 : 0;
      var cls = 'yellow';
      if (Math.abs(diff) > 10) cls = c.rev ? (v < avg ? 'green' : 'red') : (v > avg ? 'green' : 'red');
      t2 += '<td class="mgr-hl-' + cls + '">' + cell2(c.k, v) + '</td>';
    });
    t2 += '</tr>';
  });
  t2 += '</tbody></table>';

  var h = '';
  // Таблицы 1/2 — на dev-вкладку (если mode не 'slices')
  if (mode !== 'slices') {
    h += '<div class="card" style="margin-top:8px"><h2>Таблица 1: Основные показатели по менеджерам' + mgrReportFilterHtml() + '</h2><div class="scroll-x">' + t1 + '</div></div>';
    h += '<div class="card" style="margin-top:8px"><h2>Таблица 2: Конверсии и отклонения от среднего' + mgrReportFilterHtml() + ' <span style="font-size:12px;color:#475569;font-weight:400">(цвет — отклонение от среднего по отделу)</span></h2><div class="scroll-x">' + t2 + '</div></div>';
  }
  // Срезы — остаются на «Продажах» (если mode не 'tables')
  if (mode !== 'tables') {
    // Компактная сетка 2×2 — все 4 среза помещаются на один экран десктопа
    var barH = Math.max(210, mgrs.length * 15 + 70);
    var slice = function (title, id) {
      return '<div><h3 style="font-size:13px;margin:0 0 6px;color:#1f2a44">' + title + '</h3>'
        + '<div style="height:' + barH + 'px;position:relative"><canvas id="' + id + '"></canvas></div></div>';
    };
    h += '<div class="card" style="margin-top:8px"><h2>Срезы по менеджерам' + mgrReportFilterHtml() + ' <span style="font-size:12px;color:#475569;font-weight:400">(горизонтальные полосы, сортировка по сумме)</span></h2>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px 22px">';
    h += slice('B2B vs B2C', 'mgrBarsB2b');
    h += slice('Источники (внутренняя база vs маркетинг)', 'mgrBarsSrc');
    h += slice('Форматы обучения', 'mgrBarsFmt');
    h += slice('Тип обучения', 'mgrBarsEdu');
    h += '</div></div>';
  }
  var wrapId = mode === 'tables' ? 'mgrReportDevTables' : (mode === 'slices' ? 'mgrReportSlices' : 'mgrReportBlock');
  return '<div id="' + wrapId + '">' + h + '</div>';
}

// Графики блока «Отчёт по менеджерам»: срезы (верт. stacked bar) + воронка (stack2 по неделям).
function initMgrReportCharts(rep, weeks) {
  if (!window.Chart) return;
  var mgrs = (rep.managers || []).filter(function (m) { return m.paid || m.created || m.in_work_start; });

  var slices = [
    { id: 'mgrBarsB2b', items: [ { k: 'b2b_sum', label: 'B2B', color: '#1f2a44' }, { k: 'b2c_sum', label: 'B2C', color: '#00bcd4' } ] },
    { id: 'mgrBarsSrc', items: [ { k: 'src_int_sum', label: 'Внутренняя база', color: '#2e7d32' }, { k: 'src_mkt_sum', label: 'Маркетинг', color: '#ff9800' } ] },
    { id: 'mgrBarsFmt', items: [ { k: 'fmt_oom_sum', label: 'ООМ (Очное)', color: '#1565c0' }, { k: 'fmt_om_sum', label: 'ОМ (Онлайн)', color: '#7b1fa2' }, { k: 'fmt_sdo_sum', label: 'СДО', color: '#e65100' } ] },
    { id: 'mgrBarsEdu', items: [ { k: 'edu_pk_sum', label: 'Повышение квалификации', color: '#1565c0' }, { k: 'edu_pp_sum', label: 'Проф. переподготовка', color: '#00897b' }, { k: 'edu_kom_sum', label: 'Корпоративное обучение', color: '#ff9800' } ] },
  ];
  slices.forEach(function (sl) {
    var el = document.getElementById(sl.id);
    if (!el) return;
    var rows = mgrs.map(function (m) {
      var tot = 0; sl.items.forEach(function (it) { tot += m[it.k] || 0; });
      return { name: m.name, tot: tot, m: m };
    }).filter(function (r) { return r.tot > 0; }).sort(function (a, b) { return b.tot - a.tot; });
    var datasets = sl.items.map(function (it) {
      return { label: it.label, data: rows.map(function (r) { return r.m[it.k] || 0; }), backgroundColor: it.color, borderRadius: 3 };
    });
    try {
      new Chart(el, {
        type: 'bar',
        data: { labels: rows.map(function (r) { return r.name; }), datasets: datasets },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: { size: 10 } } },
            datalabels: { display: false },
            tooltip: { callbacks: { label: function (ctx) {
              var tot = rows[ctx.dataIndex] ? rows[ctx.dataIndex].tot : 0, v = ctx.raw || 0;
              var p = tot > 0 ? (v / tot * 100).toFixed(1) : 0;
              return ctx.dataset.label + ': ' + v.toLocaleString('ru-RU') + ' ₽ (' + p + '%)';
            } } },
          },
          scales: { x: { stacked: true, beginAtZero: true, ticks: { font: { size: 10 } } }, y: { stacked: true, ticks: { font: { size: 10 } } } },
        },
      });
    } catch (e) {}
  });

  // Воронка «фиксация состояния» (mgrFunnelReport) инициализируется в основном
  // рендере renderPageMainNew — рядом с «Воронка по неделям», а не здесь.
}

// ── Недельная/месячная таблица + фильтр по менеджеру ─────────────────────────
// Строит HTML таблицы из корзин (недели или месяцы), ИТОГО первой строкой.
function buildWeekTableHtml(buckets, monthsMode) {
  buckets = buckets || [];
  var tL=0,tM=0,tS=0,tInv=0,tO=0,tP0=0;
  for (var i=0;i<buckets.length;i++){var w=buckets[i];tL+=w.leads||0;tM+=w.mql||0;tS+=w.sql||0;tInv+=w.invoice_cnt||0;tO+=w.oplata||0;tP0+=w.postupleniya||0;}
  var tAvgChk = tO>0 ? tP0/tO : 0;
  var tDurNum=0,tDurDen=0;
  buckets.forEach(function(w){ tDurNum += (w.avg_dur||0)*(w.oplata||0); tDurDen += w.oplata||0; });
  var tAvgDur = tDurDen>0 ? tDurNum/tDurDen : 0;
  var tCl=tL>0?tM/tL*100:0, tCs=tM>0?tS/tM*100:0, tSi=tS>0?tInv/tS*100:0, tIo=tInv>0?tO/tInv*100:0, tLo=tL>0?tO/tL*100:0;
  var colHeaders = [
    {l:monthsMode?'Месяц':'Неделя'},
    {l:'Лиды'},{l:'MQL'},{l:'SQL'},{l:'Счёт'},{l:'Сделки'},
    {l:'Поступл.'},{l:'Ср.чек'},{l:'Цикл'},
    {l:'Лиды→MQL'},{l:'MQL→SQL'},{l:'SQL→Счёт'},{l:'Счёт→Сделка'},{l:'Лид→Сделка'}
  ];
  var s = '<table class="table table-sm sortable" style="font-size:11px"><thead><tr>';
  colHeaders.forEach(function(h,i){ s += '<th class="sort" data-col="'+i+'">'+h.l+'</th>'; });
  s += '</tr></thead><tbody>';
  s += '<tr class="total-row" style="background:#eef1f8;font-weight:700;border-top:2px solid #1f2a44;border-bottom:2px solid #1f2a44"><td><b>ИТОГО</b></td><td>'+tL+'</td><td>'+tM+'</td><td>'+tS+'</td><td>'+tInv+'</td><td>'+tO+'</td><td>'+fmt(tP0)+'</td><td>'+fmt(tAvgChk)+'</td><td>'+(tAvgDur||0).toFixed(1)+'</td><td>'+tCl.toFixed(1)+'%</td><td>'+tCs.toFixed(1)+'%</td><td>'+tSi.toFixed(1)+'%</td><td>'+tIo.toFixed(1)+'%</td><td>'+tLo.toFixed(1)+'%</td></tr>';
  for (var j=buckets.length-1;j>=0;j--){
    var w = buckets[j];
    s += '<tr><td>'+(w.label_dates||'Неделя'+String(w.week).padStart(2,'0'))+'</td><td>'+(w.leads||0)+'</td><td>'+(w.mql||0)+'</td><td>'+(w.sql||0)+'</td><td>'+(w.invoice_cnt||0)+'</td><td>'+(w.oplata||0)+'</td><td>'+fmt(w.postupleniya)+'</td><td>'+fmt(w.avg_check||0)+'</td><td>'+(w.avg_dur||0).toFixed(1)+'</td><td>'+(w.conv_lead_mql||0).toFixed(1)+'%</td><td>'+(w.conv_mql_sql||0).toFixed(1)+'%</td><td>'+(w.conv_sql_invoice||0).toFixed(1)+'%</td><td>'+(w.conv_invoice_oplata||0).toFixed(1)+'%</td><td>'+((w.leads||0)>0?(w.oplata/w.leads*100).toFixed(1):'0.0')+'%</td></tr>';
  }
  s += '</tbody></table>';
  return s;
}

// Состояние фильтра менеджера (id или 'all') + кеш данных по менеджеру (за весь год).
window.mgrWeekFilter = window.mgrWeekFilter || { id: 'all', cache: {} };

function mgrWeekTableMode() { var d = lastRenderData || {}; return window.periodModes && window.periodModes.table === 'months' && (d.months||[]).length > 0; }

function currentWeekBuckets(d) {
  var f = window.mgrWeekFilter, months = mgrWeekTableMode();
  if (f.id !== 'all' && f.cache[f.id]) return months ? (f.cache[f.id].months||[]) : (f.cache[f.id].weeks||[]);
  return months ? (d.months||[]) : (d.weeks||[]);
}

function renderWeekTableEl() {
  var d = lastRenderData; if (!d) return;
  var el = document.getElementById('newWeekTable'); if (!el) return;
  el.innerHTML = buildWeekTableHtml(currentWeekBuckets(d), mgrWeekTableMode());
  initTableSort('newWeekTable');
}

// Смена менеджера в селекте: 'all' → общие данные; иначе тянем /api/manager-weeks (с кешем).
window.setMgrWeekFilter = function(id) {
  window.mgrWeekFilter.id = id || 'all';
  if (id && id !== 'all' && !window.mgrWeekFilter.cache[id]) {
    var el = document.getElementById('newWeekTable');
    if (el) el.innerHTML = '<div class="muted" style="padding:12px">Загрузка…</div>';
    api('/api/manager-weeks?mgr=' + encodeURIComponent(id)).then(function(r){
      window.mgrWeekFilter.cache[id] = { weeks: r.weeks||[], months: r.months||[] };
      renderWeekTableEl();
    }).catch(function(e){ console.error('/api/manager-weeks error:', e); renderWeekTableEl(); });
  } else {
    renderWeekTableEl();
  }
};

// Список менеджеров для селекта (id+имя) — из /api/managers-sales (все группы).
function mgrWeekSelectHtml(d) {
  var seen = {}, list = [];
  var groups = (d.mgr_sales && d.mgr_sales.groups) || {};
  Object.keys(groups).forEach(function(g){ (groups[g]||[]).forEach(function(m){ if (m.id && !seen[m.id] && (m.won_cnt||m.postupleniya||m.leads)) { seen[m.id]=1; list.push(m); } }); });
  list.sort(function(a,b){ return (b.postupleniya||0)-(a.postupleniya||0); });
  var opts = '<option value="all">Все менеджеры</option>';
  list.forEach(function(m){ opts += '<option value="'+m.id+'"'+(window.mgrWeekFilter.id===String(m.id)?' selected':'')+'>'+escapeHtml(m.name)+'</option>'; });
  return '<span style="font-size:12px;font-weight:400;color:#475569;margin-left:10px">Менеджер:</span>'
    + '<select id="mgrTableFilter" onchange="setMgrWeekFilter(this.value)" style="margin-left:6px;padding:3px 8px;font-size:12px;font-weight:400">'+opts+'</select>';
}

// Ленивая загрузка дневного ряда поступлений (/api/day-series) в кэш + перерисовка.
function ensurePosDays() {
  if (window.posDayLoading || window.posDayCache) return;
  window.posDayLoading = true;
  api('/api/day-series').then(function (r) {
    window.posDayCache = r.days || [];
    window.posDayLoading = false;
    if (lastRenderData) renderPageMainNew(lastRenderData);
  }).catch(function (e) { window.posDayLoading = false; console.error('/api/day-series error:', e); });
}

async function renderPageMainNew(d) {
  var areaNew = document.getElementById('contentAreaNew');
  if (!areaNew) return;
  try {
    if (!d) d = await api('/api/data');
    if (!d || !d.ytd) { areaNew.innerHTML = '<div class="alert alert-danger">Нет данных</div>'; return; }

        function kpi(label, val, sub, cls) {
      var kpiCls = cls === 'oom' ? 'kpi-oom' : (cls === 'kom' ? 'kpi-kom' : 'kpi-total');
      return '<div class="kpi '+kpiCls+'"><div class="lbl">'+label+'</div><div class="val">'+val+'</div><div class="sub">'+(sub||'')+'</div></div>';
    }
    function delta(a,b) {
      if (!b) return '';
      var p = b>0?((a-b)/b*100).toFixed(1):0, s=(p>0?'\u2191':(p<0?'\u2193':'\u2192'));
      var cl = p>0?'text-success':(p<0?'text-danger':'text-body-secondary');
      return ' <span class="'+cl+'">'+s+' '+Math.abs(p)+'%</span>';
    }
    // \u0418\u043d\u0432\u0435\u0440\u0441\u043d\u0430\u044f \u0434\u0435\u043b\u044c\u0442\u0430 \u0434\u043b\u044f \u043c\u0435\u0442\u0440\u0438\u043a \u00ab\u043c\u0435\u043d\u044c\u0448\u0435 = \u043b\u0443\u0447\u0448\u0435\u00bb (\u0446\u0438\u043a\u043b \u0441\u0434\u0435\u043b\u043a\u0438):
    // \u0440\u043e\u0441\u0442 \u043f\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u044f \u2014 \u043a\u0440\u0430\u0441\u043d\u044b\u0439, \u0441\u043d\u0438\u0436\u0435\u043d\u0438\u0435 \u2014 \u0437\u0435\u043b\u0451\u043d\u044b\u0439
    function deltaInv(a,b) {
      if (!b) return '';
      var p = b>0?((a-b)/b*100).toFixed(1):0, s=(p>0?'\u2191':(p<0?'\u2193':'\u2192'));
      var cl = p>0?'text-danger':(p<0?'text-success':'text-body-secondary');
      return ' <span class="'+cl+'">'+s+' '+Math.abs(p)+'%</span>';
    }
    function section(title, ytd, cur, prev, cls, leadsYtd, leadsCur, leadsPrev, qualLeads, mqlCur, mqlPrev, ppYtd, ppLeads, ppQual) {
      var cc = cls==='kom'?'c-kom':(cls==='oom'?'c-oom':'c-total');
      var kc = cls==='kom'?'kpi-kom':(cls==='oom'?'kpi-oom':'kpi-total');
      function pctDelta(a, b) {
        if (!b || b === 0) return '';
        var p = ((a - b) / b * 100).toFixed(1);
        var s = p > 0 ? '↑' : (p < 0 ? '↓' : '→');
        var cl = p > 0 ? 'text-success' : (p < 0 ? 'text-danger' : 'text-body-secondary');
        return ' <span class="'+cl+'">'+s+' '+Math.abs(p)+'%</span>';
      }
      function pctDeltaInv(a, b) {
        if (!b || b === 0) return '';
        var p = ((a - b) / b * 100).toFixed(1);
        var s = p > 0 ? '↑' : (p < 0 ? '↓' : '→');
        var cl = p > 0 ? 'text-danger' : (p < 0 ? 'text-success' : 'text-body-secondary');
        return ' <span class="'+cl+'">'+s+' '+Math.abs(p)+'%</span>';
      }
      var ppL = ppYtd ? (ppLeads || 0) : 0;
      var curLeadsVal = leadsYtd != null ? leadsYtd : ytd.won_relevant_cnt;
      var curConv = leadsYtd>0?(ytd.won_relevant_cnt/leadsYtd*100):0;
      var ppConv  = ppYtd && ppL>0?(ppYtd.won_relevant_cnt/ppL*100):0;
      function pp(val) { return ppYtd ? '<div class="pp-val">'+val+'</div>' : ''; }
      var r = '<div class="kpis"><div class="kpi-header '+cc+'">'+title+'</div>'
        + '<div class="kpi '+kc+'"><div class="lbl">Поступления, ₽</div><div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline"><div class="val-big">'+fmt(ytd.postupleniya)+'</div>'+(ppYtd?pctDelta(ytd.postupleniya,ppYtd.postupleniya):'')+'</div>'+pp(fmt(ppYtd&&ppYtd.postupleniya))+'</div>'
        + '<div class="kpi '+kc+'"><div class="lbl">Сделки</div><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="val-big">'+fmt(ytd.won_relevant_cnt)+'</div>'+(ppYtd?pctDelta(ytd.won_relevant_cnt,ppYtd.won_relevant_cnt):'')+'</div>'+pp(fmt(ppYtd&&ppYtd.won_relevant_cnt))+'</div>'
        + '<div class="kpi '+kc+'"><div class="lbl">Лиды</div><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="val-big">'+fmt(curLeadsVal)+'</div>'+(ppYtd?pctDelta(curLeadsVal,ppL):'')+'</div>'+pp(fmt(ppL))+'</div>'
        + '<div class="kpi '+kc+'"><div class="lbl">Конверсия</div><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="val-big">'+fmtPct(curConv)+'%</div>'+(ppYtd?pctDelta(curConv,ppConv):'')+'</div>'+pp(fmtPct(ppConv)+'%')+'</div>'
        + '<div class="kpi '+kc+'"><div class="lbl">Оплаченные в&nbsp;периоде</div><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="val-big">'+fmtPct(ytd.paid_created_same_pct)+'%</div>'+(ppYtd?pctDelta(ytd.paid_created_same_pct,ppYtd.paid_created_same_pct):'')+'</div>'+pp(fmtPct(ppYtd&&ppYtd.paid_created_same_pct)+'%')+'</div>'
        + '<div class="kpi '+kc+'"><div class="lbl">Средний чек, ₽</div><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="val-big">'+fmt(ytd.avg_check)+'</div>'+(ppYtd?pctDelta(ytd.avg_check,ppYtd.avg_check):'')+'</div>'+pp(fmt(ppYtd&&ppYtd.avg_check))+'</div>'
        + '<div class="kpi '+kc+'"><div class="lbl">Цикл сделки</div><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="val-big">'+(ytd.avg_close_days_won||0).toFixed(1)+' дн.</div>'+(ppYtd?pctDeltaInv(ytd.avg_close_days_won||0,ppYtd.avg_close_days_won||0):'')+'</div>'+pp((ppYtd&&ppYtd.avg_close_days_won||0).toFixed(1)+' дн.')+'</div>'
        + '</div>';
      return r;
    }

    var weeks = d.weeks||[], labels = weeks.map(function(w){return w.label_dates || w.label_short || 'Неделя'+String(w.week).padStart(2,'0');});
    // Недели или месяцы — независимо для каждого блока (Поступления/Воронка/таблица)
    var monthsArr = d.months || [];
    function mkLabels(arr) { return arr.map(function(w){return w.label_dates || w.label_short || 'Неделя'+String(w.week).padStart(2,'0');}); }
    function isMonths(block) { return window.periodModes[block] === 'months' && monthsArr.length > 0; }
    function perToggle(block, withDays) {
      var mode = window.periodModes[block];
      function btn(m, l) { return "<button class=\"tab"+(mode===m?' active':'')+"\" style=\"padding:4px 12px;font-size:12px\" onclick=\"setPeriodMode('"+block+"','"+m+"')\">"+l+"</button>"; }
      return '<span style="float:right;font-weight:400">'
        + (withDays ? btn('days', 'Дни') : '')
        + btn('weeks', 'Недели') + btn('months', 'Месяцы')
        + '</span>';
    }
    // «Поступления»: Дни/Недели/Месяцы. Дни грузятся лениво (/api/day-series) в кэш.
    var posMode = window.periodModes.pos;
    var posBuckets;
    if (posMode === 'days') {
      if (window.posDayCache) posBuckets = window.posDayCache;
      else { posBuckets = []; ensurePosDays(); }
    } else { posBuckets = isMonths('pos') ? monthsArr : weeks; }
    var posLabels = mkLabels(posBuckets);
    var funBuckets = isMonths('funnel') ? monthsArr : weeks, funLabels = mkLabels(funBuckets);
    var fmtKeys = Object.keys(d.fmt_ytd||{}).filter(function(k){return k!=='period';});

    // Используем последнюю ПОЛНУЮ неделю (пропускаем текущую, если в ней 0 оплат)
    var lastIdx = weeks.length - 1;
    while (lastIdx > 0 && weeks[lastIdx] && weeks[lastIdx].postupleniya === 0 && weeks[lastIdx].oplata === 0) {
      lastIdx--;
    }
    var wkCur = weeks[lastIdx] || {};
    var wkPrev = weeks[lastIdx - 1] || {};
    var wkCurData = { postupleniya: wkCur.postupleniya || 0, won_relevant_cnt: wkCur.oplata || 0 };
    var wkPrevData = { postupleniya: wkPrev.postupleniya || 0, won_relevant_cnt: wkPrev.oplata || 0 };
    var wkCurLeads = wkCur.leads || 0;
    var wkPrevLeads = wkPrev.leads || 0;
    var oomCurData = { postupleniya: wkCur.oom_postupleniya || 0, won_relevant_cnt: wkCur.oom_won_cnt || 0 };
    var oomPrevData = { postupleniya: wkPrev.oom_postupleniya || 0, won_relevant_cnt: wkPrev.oom_won_cnt || 0 };
    var komCurData = { postupleniya: wkCur.kom_postupleniya || 0, won_relevant_cnt: wkCur.kom_won_cnt || 0 };
    var komPrevData = { postupleniya: wkPrev.kom_postupleniya || 0, won_relevant_cnt: wkPrev.kom_won_cnt || 0 };
    var oomMqlCur = wkCur.oom_mql || 0;
    var oomMqlPrev = wkPrev.oom_mql || 0;
    var komMqlCur = (wkCur.mql || 0) - oomMqlCur;
    var komMqlPrev = (wkPrev.mql || 0) - oomMqlPrev;

    var html = '';
    // KPI sections
    html += section('ИТОГО В ПЕРИОДЕ (все типы и форматы)', d.ytd, wkCurData, wkPrevData, null, d.leads_ytd, wkCurLeads, wkPrevLeads, d.qual_lead_ytd, wkCur.mql || 0, wkPrev.mql || 0, d.pp && d.pp.ytd, d.pp && d.pp.leads_ytd, d.pp && d.pp.qual_lead_ytd);
    html += section('Открытое обучение (очное, онлайн и видеокурсы)', d.oom_ytd, oomCurData, oomPrevData, 'oom', d.oom_leads_ytd, wkCur.oom_leads || 0, wkPrev.oom_leads || 0, d.oom_qual_lead_ytd, oomMqlCur, oomMqlPrev, d.pp && d.pp.oom_ytd, d.pp && d.pp.oom_leads_ytd, d.pp && d.pp.oom_qual_lead_ytd);
    html += section('Корпоративное обучение (КОМ)', d.kom_ytd, komCurData, komPrevData, 'kom', d.kom_leads_ytd, (wkCur.leads||0) - (wkCur.oom_leads||0), (wkPrev.leads||0) - (wkPrev.oom_leads||0), d.kom_qual_lead_ytd, komMqlCur, komMqlPrev, d.pp && d.pp.kom_ytd, d.pp && d.pp.kom_leads_ytd, d.pp && d.pp.kom_qual_lead_ytd);
    // 👥 Продажи по менеджерам — сравнение за выбранный период (остаётся, не заменяется)
    if (d.mgr_sales) html += renderManagersBlock(d.mgr_sales);
    // Treemap «Вклад менеджеров» + лидеры периода + скидки (на данных managers-sales)
    if (d.mgr_sales) {
      html += renderContributionBarCard(d.mgr_sales);
      html += renderLeadersCard(d.mgr_sales);
    }
    // Структура среднего чека (распределение оплат по диапазонам; данные /api/kpi → check_dist)
    if (d.check_dist) html += renderCheckDistCard(d.check_dist);
    if (d.mgr_sales) html += renderDiscountsCard(d.mgr_sales);
    // 📋 Отчёт по менеджерам: на «Продажах» остаются СРЕЗЫ; Таблицы 1/2 и воронки — на dev-вкладке
    if (d.mgr_report) html += renderMgrReportBlock(d.mgr_report, 'slices');
    // Поступления по неделям/месяцам (на всю ширину) + переключатель
    var posTitle = posMode==='days' ? 'по дням' : (isMonths('pos') ? 'по месяцам' : 'по неделям');
    html += '<div class="card" style="margin-top:8px"><h2>Поступления '+posTitle+perToggle('pos', true)+'</h2><div style="height:440px;position:relative"><canvas id="newChPos"></canvas></div></div>';
    // Конверсии


        // MBA — перенесён на ratings-dashboard

    // Регистрация — над недельной таблицей
    html += '<div class="kpis kpis-8" id="newRegKpis" style="margin-top:16px"></div>';
    html += '<div class="card"><h2>'+(isMonths('table')?'Таблица по месяцам':'Недельная таблица')+mgrWeekSelectHtml(d)+perToggle('table')+'</h2><div class="scroll-x"><div id="newWeekTable"></div></div></div>';

    // ── Вкладка «🧪 В разработке»: перенесённые с «Продаж» блоки (не теряем):
    //    Таблицы 1/2 (отчёт менеджеров) + 2 воронки. Период/сравнение — как у «Продаж». ──
    var devEl = document.getElementById('devAreaNew');
    if (devEl) {
      var devHtml = '';
      if (d.mgr_report) devHtml += renderMgrReportBlock(d.mgr_report, 'tables');
      devHtml += '<div class="card" style="margin-top:8px"><h2>Воронка '+(isMonths('funnel')?'по месяцам':'по неделям')+' <span style="font-size:12px;color:#475569;font-weight:400">(созданные и зафиксированные на стадии '+(isMonths('funnel')?'в том же месяце':'на той же неделе')+')</span>'+perToggle('funnel')+'</h2><div style="height:600px;position:relative"><canvas id="newChFunnel2"></canvas></div></div>';
      devHtml += '<div class="card" style="margin-top:8px"><h2>Воронка <span style="font-size:12px;color:#475569;font-weight:400">(фиксация состояния в периоде с учётом переходящего остатка)</span></h2><div style="height:600px;position:relative"><canvas id="mgrFunnelReport"></canvas></div></div>';
      devEl.innerHTML = devHtml || '<div class="text-secondary" style="font-size:13px">Перенесённые блоки появятся после загрузки данных (вкладка «Продажи»)</div>';
      if (d.mgr_report) { initTableSort('mgrTab1'); initTableSort('mgrTab2'); }
    }

    // Блоки «Ключевые выводы» и «Артефакты данных» удалены. reg нужен ниже для KPI регистрации.
    var reg = d.reg_ytd || {};

    // Batch update all at once
    areaNew.innerHTML = html;

    // Сортировка таблицы блока «Продажи по менеджерам» (после вставки HTML)
    if (d.mgr_sales) initTableSort('mgrTableMain');


    // Регистрации: KPI (reg уже объявлен выше, в «Ключевых выводах»).
    // Тот же вид, что у верхних KPI-блоков: значение + дельта, предыдущий период серым снизу.
    var pp_reg = d.pp_reg_ytd||null;
    function regCard(lbl, val, deltaHtml, ppVal, extra) {
      return '<div class="kpi kpi-reg"><div class="lbl">'+lbl+'</div>'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline"><div class="val-big">'+val+'</div>'+(deltaHtml||'')+'</div>'
        + (extra||'')
        + (pp_reg?'<div class="pp-val">'+ppVal+'</div>':'')
        + '</div>';
    }
    // Сдвоенная широкая карточка: шт. и ₽ одной метрики бок о бок (значение/пред.период/дельта — построчно)
    function regCardPair(lblSht, lblRub, val1, delta1, ppVal1, val2, delta2, ppVal2) {
      return '<div class="kpi kpi-reg kpi-wide"><div class="lbl">'+lblSht+' | '+lblRub+'</div>'
        + '<div style="display:flex;gap:24px"><div class="val-big" style="flex:1">'+val1+'</div><div class="val-big" style="flex:1">'+val2+'</div></div>'
        + (pp_reg?'<div style="display:flex;gap:24px"><div class="pp-val" style="flex:1">'+ppVal1+'</div><div class="pp-val" style="flex:1">'+ppVal2+'</div></div>':'')
        + '<div style="display:flex;gap:24px"><div style="flex:1">'+(delta1||'')+'</div><div style="flex:1">'+(delta2||'')+'</div></div>'
        + '</div>';
    }
    var regKpis = '<div class="kpi-header c-reg">📥 Динамика по источнику «Регистрация»</div>'
      + regCardPair(
          'Регистраций пришло, шт.', '₽',
          fmt(reg.total), pp_reg?delta(reg.total,pp_reg.total):'', pp_reg?fmt(pp_reg.total):'',
          fmt(reg.total_sum), pp_reg?delta(reg.total_sum,pp_reg.total_sum):'', pp_reg?fmt(pp_reg.total_sum):'')
      + regCardPair(
          'Поступления, шт.', '₽',
          fmt(reg.total_paid), pp_reg?delta(reg.total_paid,pp_reg.total_paid):'', pp_reg?fmt(pp_reg.total_paid):'',
          fmt(reg.total_paid_sum), pp_reg?delta(reg.total_paid_sum,pp_reg.total_paid_sum):'', pp_reg?fmt(pp_reg.total_paid_sum):'')
      + regCard('Конверсия в сделку', reg.conv+'%', pp_reg?delta(reg.conv,pp_reg.conv):'', pp_reg?pp_reg.conv+'%':'')
      + regCard('Доля отказов', reg.lose_pct+'%', pp_reg?delta(reg.lose_pct,pp_reg.lose_pct):'', pp_reg?pp_reg.lose_pct+'%':'')
      + regCard('Средний чек, ₽', fmt(reg.avg_check), pp_reg?delta(reg.avg_check,pp_reg.avg_check):'', pp_reg?fmt(pp_reg.avg_check):'')
      + regCard('Цикл сделки', reg.avg_dur+' дн.', pp_reg?deltaInv(reg.avg_dur,pp_reg.avg_dur):'', pp_reg?pp_reg.avg_dur+' дн.':'');
    var regEl = document.getElementById('newRegKpis'); if(regEl) regEl.innerHTML = regKpis;



    // Недельная/месячная таблица — с учётом выбранного менеджера (ИТОГО сверху)
    renderWeekTableEl();



    // Destroy orphaned chart instances before creating new ones
    if (window.Chart && Chart.instances) {
      Object.keys(Chart.instances).forEach(function(k) {
        var chart = Chart.instances[k];
        if (chart.canvas && !document.contains(chart.canvas)) {
          chart.destroy();
        }
      });
    }

    // Charts (canvas elements now exist)
    setTimeout(function(){
      if (window.Chart) {
        // Отчёт по менеджерам: срезы (верт. stacked bar) + воронка
        if (d.mgr_report) { try { initMgrReportCharts(d.mgr_report, weeks); } catch(e){} }
        try {
          if (document.getElementById('newChFunnel2')) new Chart(document.getElementById('newChFunnel2'), {type:'bar', data:{labels:funLabels,datasets:[{label:'Отказы неКвал',data:funBuckets.map(function(w){return w.stack2_rej_nq||0;}),backgroundColor:'#880E4F',borderRadius:4,seg:'rej_nq'},{label:'Отказы',data:funBuckets.map(function(w){return w.stack2_rej||0;}),backgroundColor:'#E53935',borderRadius:4,seg:'rej'},{label:'Не квал',data:funBuckets.map(function(w){return w.stack2_nq||0;}),backgroundColor:'#FFD54F',borderRadius:4,seg:'nq'},{label:'MQL',data:funBuckets.map(function(w){return w.stack2_mql||0;}),backgroundColor:'#42A5F5',borderRadius:4,seg:'mql'},{label:'SQL',data:funBuckets.map(function(w){return w.stack2_sql||0;}),backgroundColor:'#1A237E',borderRadius:4,seg:'sql'},{label:'Счёт',data:funBuckets.map(function(w){return w.stack2_inv||0;}),backgroundColor:'#7E57C2',borderRadius:4,seg:'inv'},{label:'Сделка',data:funBuckets.map(function(w){return w.stack2_pay||0;}),backgroundColor:'#43A047',borderRadius:4,seg:'pay'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}},datalabels:{display:function(ctx){return ctx.datasetIndex===ctx.chart.data.datasets.length-1?'auto':false;},color:'#333',anchor:'end',align:'end',font:{weight:'bold',size:10},formatter:function(v,ctx){var i=ctx.dataIndex;var tot=0;['stack2_rej','stack2_rej_nq','stack2_nq','stack2_mql','stack2_sql','stack2_inv','stack2_pay'].forEach(function(k){tot+=funBuckets[i][k]||0;});return tot?tot+' сд.':'';}},tooltip:{callbacks:{label:function(ctx){var l=ctx.dataset.label||'';var v=ctx.raw||0;var w=funBuckets[ctx.dataIndex]||{};var s=ctx.dataset.seg||'';var sumKey=s?'stack2_'+s+'_sum':'';var sumVal=sumKey?(w[sumKey]||0):0;var tot=0;['stack2_rej','stack2_rej_nq','stack2_nq','stack2_mql','stack2_sql','stack2_inv','stack2_pay'].map(function(k){tot+=w[k]||0;});var pct=tot>0?(v/tot*100).toFixed(1):0;var txt=l+': '+v+' сд. ('+pct+'%)';if(s==='sql'||s==='inv'||s==='pay'){txt+=' · '+sumVal.toLocaleString('ru-RU')+' ₽';}return txt;}}}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}},plugins:[{id:'legendSpacer',beforeLayout(chart){var leg=chart.legend;if(leg&&!leg.__spacer30){var of=leg.fit.bind(leg);leg.fit=function(){of();this.height+=30;};leg.__spacer30=true;}}}] });
        } catch(e){}
        try {
          if (document.getElementById('mgrFunnelReport')) new Chart(document.getElementById('mgrFunnelReport'), {type:'bar', data:{labels:weeks.map(function(w){return w.label_dates||('Нед.'+String(w.week).padStart(2,'0'));}),datasets:[{label:'Отказы неКвал',data:weeks.map(function(w){return w.stack2_rej_nq||0;}),backgroundColor:'#880E4F',borderRadius:4},{label:'Отказы',data:weeks.map(function(w){return w.stack2_rej||0;}),backgroundColor:'#E53935',borderRadius:4},{label:'Не квал',data:weeks.map(function(w){return w.stack2_nq||0;}),backgroundColor:'#FFD54F',borderRadius:4},{label:'MQL',data:weeks.map(function(w){return w.stack2_mql||0;}),backgroundColor:'#42A5F5',borderRadius:4},{label:'SQL',data:weeks.map(function(w){return w.stack2_sql||0;}),backgroundColor:'#1A237E',borderRadius:4},{label:'Счёт',data:weeks.map(function(w){return w.stack2_inv||0;}),backgroundColor:'#7E57C2',borderRadius:4},{label:'Оплата',data:weeks.map(function(w){return w.stack2_pay||0;}),backgroundColor:'#43A047',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}},datalabels:{display:false}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
        } catch(e){}
        try {
          if (document.getElementById('newChConv')) new Chart(document.getElementById('newChConv'), {type:'line', data:{labels:labels,datasets:[{label:'Лиды\u2192MQL %',data:weeks.map(function(w){return w.conv_lead_mql||0;}),borderColor:'#B0BEC5',tension:0.3,fill:false},{label:'MQL\u2192SQL %',data:weeks.map(function(w){return w.conv_mql_sql||0;}),borderColor:'#3079D2',tension:0.3,fill:false},{label:'SQL\u2192Счёт %',data:weeks.map(function(w){return w.conv_sql_invoice||0;}),borderColor:'#43A047',tension:0.3,fill:false},{label:'Счёт\u2192Сделка %',data:weeks.map(function(w){return w.conv_sql_oplata||0;}),borderColor:'#2E7D32',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
        } catch(e){}
        try {
          if (document.getElementById('newChPos')) new Chart(document.getElementById('newChPos'), {type:'bar', data:{labels:posLabels,datasets:[{label:'ООМ',data:posBuckets.map(function(w){return w.oom_postupleniya||0;}),backgroundColor:'#00bcd4',borderRadius:4},{label:'КОМ',data:posBuckets.map(function(w){return w.kom_postupleniya||0;}),backgroundColor:'#9C27B0',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10}}},datalabels:{display:false},tooltip:{callbacks:{label:function(ctx){var i=ctx.dataIndex;var v=ctx.raw||0;var oom=posBuckets[i].oom_postupleniya||0;var kom=posBuckets[i].kom_postupleniya||0;var tot=oom+kom;if(ctx.datasetIndex===0) return ctx.dataset.label+': '+v.toLocaleString('ru-RU')+' ₽ из '+tot.toLocaleString('ru-RU')+' ₽';if(ctx.datasetIndex===1) return ctx.dataset.label+': '+v.toLocaleString('ru-RU')+' ₽ из '+tot.toLocaleString('ru-RU')+' ₽';return ctx.dataset.label+': '+v.toLocaleString('ru-RU')+' ₽';}}}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
          // qual funnel
          if (document.getElementById('ch_funnel_new_qual')) new Chart(document.getElementById('ch_funnel_new_qual'), {type:'bar', data:{labels:labels,datasets:[{label:'MQL',data:weeks.map(function(w){return w.mql||0;}),backgroundColor:'#3079D2',borderRadius:4},{label:'SQL',data:weeks.map(function(w){return w.sql||0;}),backgroundColor:'#9A7B3F',borderRadius:4},{label:'Оплачено',data:weeks.map(function(w){return w.oplata||0;}),backgroundColor:'#2E7D32',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
          if (document.getElementById('ch_conv_new_qual')) new Chart(document.getElementById('ch_conv_new_qual'), {type:'line', data:{labels:labels,datasets:[{label:'MQL→SQL %',data:weeks.map(function(w){return w.conv_mql_sql||0;}),borderColor:'#3079D2',tension:0.3,fill:false},{label:'SQL→Сделки %',data:weeks.map(function(w){return w.conv_sql_oplata||0;}),borderColor:'#2E7D32',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
        } catch(e){}
        try {
          if (document.getElementById('newChDur')) new Chart(document.getElementById('newChDur'),{type:'line',data:{labels:labels,datasets:[{label:'Цикл сделки, дн.',data:weeks.map(function(w){return w.avg_dur||0;}),borderColor:'#9A7B3F',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
        } catch(e){}
        try {
          if (document.getElementById('newChPreSale')) new Chart(document.getElementById('newChPreSale'),{type:'line',data:{labels:labels,datasets:[{label:'Pre Sale, дн.',data:weeks.map(function(w){return w.avg_presale_dur||0;}),borderColor:'#43A047',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
        } catch(e){}
        try { if (d.mgr_sales) renderDiscountsChart(d.mgr_sales); } catch (e) { console.error('discounts chart error:', e); }
        try { if (d.check_dist) renderCheckDistChart(d.check_dist); } catch (e) { console.error('checkdist chart error:', e); }
      }
    }, 100);

  } catch(e) {
    areaNew.innerHTML = '<div class="alert alert-danger" style="cursor:pointer" onclick="this.style.display=\'none\'\">\u274c <b>Ошибка вкладки «Новая логика»</b><br>'+escapeHtml(e.message)+'<br><br><small style="color:#999">(нажмите чтобы закрыть, время: ' + new Date().toLocaleTimeString('ru-RU') + ')</small></div>';
    console.error('renderPageMainNew error:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Обзорный экран «Продажи»: treemap «Вклад менеджеров», лидеры периода,
// «Продажи со скидками». Данные — /api/managers-sales (период «Продаж»).
// Цвета — из действующей палитры дашборда.
// ═══════════════════════════════════════════════════════════════════════════

function fmtM(v) { v = v || 0; return v >= 1e6 ? (v / 1e6).toFixed(1) + ' млн' : v >= 1e3 ? Math.round(v / 1e3) + ' тыс' : fmt(v); }

// Строки «вклад менеджеров»: действующие + агрегаты групп (Автооплаты/ОЗК/Прочее/Артефакт)
function treemapEntries(mgr) {
  var out = [];
  (mgr.managers || []).forEach(function (m) {
    out.push({ name: m.name, v: Math.round(m.postupleniya || 0), won: m.won_cnt || 0, check: m.avg_check || 0, color: '#3079D2' });
  });
  var g = mgr.groups || {};
  function agg(label, color, arrs) {
    var list = [];
    arrs.forEach(function (a) { (a || []).forEach(function (m) { list.push(m); }); });
    var sum = list.reduce(function (s, m) { return s + (m.postupleniya || 0); }, 0);
    if (sum <= 0) return;
    var won = list.reduce(function (s, m) { return s + (m.won_cnt || 0); }, 0);
    out.push({ name: label, v: Math.round(sum), won: won, check: won ? Math.round(sum / won) : 0, color: color, group: true });
  }
  agg('Автооплаты', '#00897B', [g.autopay]);
  agg('ОЗК', '#E65100', [g.ozk]);
  agg('Прочее', '#7B1FA2', [g.other]);
  agg('Артефакт', '#94A3B8', [g.bond, g.afanasyev, g.tech]);
  return out.filter(function (e) { return e.v > 0; });
}

// ── Вклад менеджеров: 100% horizontal stacked bar (одна полоса = поступления отдела) ──
// Сегменты = строки таблицы «Продажи по менеджерам» (main + Автооплаты/ОЗК/Прочее)
// + Артефакт (bond/afanasyev/tech). Цвета из палитры дашборда.
var CONTRIB_COLORS = ['#093EB4', '#3079D2', '#00bcd4', '#1565C0', '#5B21B6', '#7B1FA2', '#3F8BCD', '#2E2D93'];
var CONTRIB_GROUP_COLORS = { autopay: '#00897B', ozk: '#E65100', other: '#F57C00', artifact: '#94A3B8' };

function contributionSegments(mgr) {
  var segs = [];
  (mgr.managers || []).forEach(function (m) {
    if ((m.postupleniya || 0) <= 0) return;
    segs.push({ name: m.name, v: Math.round(m.postupleniya || 0), won: m.won_cnt || 0, check: m.avg_check || 0, color: CONTRIB_COLORS[segs.length % CONTRIB_COLORS.length] });
  });
  var g = mgr.groups || {};
  function agg(label, color, arrs) {
    var list = [];
    arrs.forEach(function (a) { (a || []).forEach(function (m) { list.push(m); }); });
    var sum = list.reduce(function (s, m) { return s + (m.postupleniya || 0); }, 0);
    if (sum <= 0) return;
    var won = list.reduce(function (s, m) { return s + (m.won_cnt || 0); }, 0);
    segs.push({ name: label, v: Math.round(sum), won: won, check: won ? Math.round(sum / won) : 0, color: color, group: true });
  }
  agg('Автооплаты', CONTRIB_GROUP_COLORS.autopay, [g.autopay]);
  agg('ОЗК', CONTRIB_GROUP_COLORS.ozk, [g.ozk]);
  agg('Прочее', CONTRIB_GROUP_COLORS.other, [g.other]);
  agg('Артефакт', CONTRIB_GROUP_COLORS.artifact, [g.bond, g.afanasyev, g.tech]);
  return segs;
}

function renderContributionBarCard(mgr) {
  var segs = contributionSegments(mgr);
  if (!segs.length) return '';
  var total = segs.reduce(function (s, e) { return s + e.v; }, 0);
  var pct = function (v) { return total > 0 ? (v / total * 100) : 0; };
  // Полоса: сегменты с % ширины; подпись — только в крупных (≥ 8% или ≥ 90px)
  var bar = '<div style="display:flex;width:100%;height:56px;border-radius:8px;overflow:hidden;margin:10px 0 6px">';
  segs.forEach(function (s) {
    var w = pct(s.v);
    if (w <= 0) return;
    var tip = s.name + ': ' + s.v.toLocaleString('ru-RU') + ' ₽ (' + w.toFixed(1) + '%) · оплат: ' + s.won + ' · средний чек: ' + (s.check || 0).toLocaleString('ru-RU') + ' ₽';
    var showTxt = w >= 8;
    bar += '<div title="' + escapeHtml(tip) + '" style="width:' + w + '%;background:' + s.color + ';display:flex;align-items:center;justify-content:center;overflow:hidden;border-right:2px solid #fff;box-sizing:border-box">'
      + (showTxt ? '<span style="color:#fff;font-size:11px;font-weight:700;white-space:nowrap;padding:0 4px">' + escapeHtml(s.name) + ' · ' + w.toFixed(1) + '%</span>' : '') + '</div>';
  });
  bar += '</div>';
  // Легенда: менеджер — сумма — доля
  var legend = segs.map(function (s) {
    var w = pct(s.v);
    return '<span style="display:inline-flex;align-items:center;gap:5px;margin:3px 12px 3px 0;font-size:12px">'
      + '<span style="width:10px;height:10px;border-radius:2px;background:' + s.color + '"></span>'
      + '<b>' + escapeHtml(s.name) + '</b> ' + s.v.toLocaleString('ru-RU') + ' ₽ · ' + w.toFixed(1) + '%</span>';
  }).join('');
  return '<div class="card" style="margin-top:8px"><h2>Вклад менеджеров <span style="font-size:12px;color:#475569;font-weight:400">(100% полоса: доля в поступлениях отдела за период · действующие поимённо, Автооплаты/ОЗК/Прочее/Артефакт — агрегатами · итог совпадает со строками таблицы)</span></h2>'
    + bar
    + '<div style="display:flex;flex-wrap:wrap;margin-bottom:4px">' + legend + '</div>'
    + '<div class="filter-info">Итого по сегментам: ' + total.toLocaleString('ru-RU') + ' ₽ · ' + segs.reduce(function (s, e) { return s + e.won; }, 0) + ' оплат</div></div>';
}

function renderTreemapCard(mgr) {
  if (!mgr || !mgr.managers || !mgr.managers.length) return '';
  var tot = (mgr.total && mgr.total.postupleniya) || 0;
  return '<div class="card" style="margin-top:8px"><h2>Вклад менеджеров <span style="font-size:12px;color:#475569;font-weight:400">(treemap · площадь = поступления за период · действующие — поимённо, группы — агрегатами · наведите на блок для деталей)</span></h2>'
    + '<div id="mgrTreemap" style="position:relative;width:100%;height:420px;background:#EDEFF5;border-radius:8px;overflow:hidden"></div>'
    + '<div class="filter-info">Итого поступлений за период: ' + fmt(tot) + ' ₽</div></div>';
}

// Раскладка treemap: бинарное деление области по сумме (slice-and-dice с балансом)
function treemapLayout(areas, W, H) {
  var res = [];
  var sumOf = function (idxs) { return idxs.reduce(function (s, i) { return s + areas[i]; }, 0); };
  function place(idxs, x, y, w, h) {
    if (idxs.length === 1) { res[idxs[0]] = { x: x, y: y, w: w, h: h }; return; }
    var total = sumOf(idxs);
    // разрез, максимально близкий к половине суммы (по отсортированному списку)
    var acc = 0, best = null;
    for (var k = 0; k < idxs.length - 1; k++) {
      acc += areas[idxs[k]];
      var diff = Math.abs(total - 2 * acc);
      if (!best || diff < best.diff) best = { k: k + 1, diff: diff };
    }
    var cut = best.k;
    var left = idxs.slice(0, cut), right = idxs.slice(cut);
    var lsum = sumOf(left);
    if (w >= h) { // режем по вертикали
      var lw = w * lsum / total;
      place(left, x, y, lw, h);
      place(right, x + lw, y, w - lw, h);
    } else {
      var lh = h * lsum / total;
      place(left, x, y, w, lh);
      place(right, x, y + lh, w, h - lh);
    }
  }
  place(areas.map(function (_, i) { return i; }), 0, 0, W, H);
  return res;
}

function renderTreemapTiles(mgr) {
  var el = document.getElementById('mgrTreemap');
  if (!el) return;
  var entries = treemapEntries(mgr);
  if (!entries.length) { el.innerHTML = '<div class="text-secondary" style="padding:12px">Нет поступлений за период</div>'; return; }
  var W = el.clientWidth || 800, H = el.clientHeight || 420;
  var total = entries.reduce(function (s, e) { return s + e.v; }, 0);
  var areas = entries.map(function (e) { return e.v / total * (W * H); });
  var rects = treemapLayout(areas, W, H);
  var html = '';
  entries.forEach(function (e, idx) {
    var r = rects[idx];
    if (!r) return;
    var pct = total > 0 ? (e.v / total * 100) : 0;
    var tip = e.name + ': ' + e.v.toLocaleString('ru-RU') + ' ₽ (' + pct.toFixed(1) + '%) · оплат: ' + e.won + ' · средний чек: ' + (e.check || 0).toLocaleString('ru-RU') + ' ₽';
    var showTxt = r.w > 90 && r.h > 34;
    var inner = showTxt
      ? '<div style="padding:6px 8px;line-height:1.25"><div style="font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(e.name) + '</div>'
        + '<div style="font-size:11px;color:rgba(255,255,255,.85)">' + fmtM(e.v) + ' ₽ · ' + pct.toFixed(1) + '%</div></div>'
      : '';
    html += '<div title="' + escapeHtml(tip) + '" style="position:absolute;left:' + Math.round(r.x + 2) + 'px;top:' + Math.round(r.y + 2) + 'px;width:' + Math.round(r.w - 4) + 'px;height:' + Math.round(r.h - 4) + 'px;background:' + e.color + ';border-radius:5px;overflow:hidden;box-sizing:border-box">' + inner + '</div>';
  });
  el.innerHTML = html;
}

// ── Лидеры периода: 4 компактные карточки ──
function renderLeadersCard(mgr) {
  var ms = (mgr.managers || []).filter(function (m) { return m.postupleniya > 0; });
  if (!ms.length) return '';
  var byPost = ms.slice().sort(function (a, b) { return b.postupleniya - a.postupleniya; })[0];
  var byCnt = ms.slice().sort(function (a, b) { return (b.won_cnt || 0) - (a.won_cnt || 0); })[0];
  var byCheck = ms.slice().filter(function (m) { return (m.won_cnt || 0) >= 5; }).sort(function (a, b) { return (b.avg_check || 0) - (a.avg_check || 0); })[0];
  var byConv = ms.slice().filter(function (m) { return (m.pf_available || 0) > 0; }).sort(function (a, b) { return ((b.pf_paid || 0) / b.pf_available) - ((a.pf_paid || 0) / a.pf_available); })[0];
  var card = function (label, val, name, sub) {
    return '<div class="kpi kpi-total"><div class="lbl">' + label + '</div>'
      + '<div class="val-big" style="font-size:19px">' + val + '</div>'
      + '<div class="sub" style="font-size:12px;color:#0F172A;font-weight:600">' + escapeHtml(name || '—') + '</div>'
      + (sub ? '<div class="pp-val" style="font-size:10px">' + sub + '</div>' : '') + '</div>';
  };
  var convName = byConv ? byConv.name : '';
  var convSub = byConv ? 'оплаты ' + (byConv.pf_paid || 0) + ' ÷ портфель ' + byConv.pf_available : '';
  return '<div class="card" style="margin-top:8px"><h2>Лидеры периода <span style="font-size:12px;color:#475569;font-weight:400">(действующие менеджеры · конверсия портфеля в оплату = оплаченные в периоде ÷ (остаток на начало + созданные + возвращённые в работу), логика портфеля кат. 0 — не путать с когортной конверсией воронки)</span></h2>'
    + '<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin:0">'
    + card('Лидер по поступлениям', fmtM(byPost.postupleniya) + ' ₽', byPost.name)
    + card('Лидер по количеству оплат', fmt(byCnt.won_cnt || 0), byCnt.name)
    + card('Лидер по среднему чеку', byCheck ? fmtM(byCheck.avg_check) + ' ₽' : '—', byCheck ? byCheck.name : '')
    + card('Лидер по конверсии портфеля', byConv ? (byConv.pf_paid / byConv.pf_available * 100).toFixed(1) + '%' : '—', convName, convSub)
    + '</div></div>';
}

// ── Продажи со скидками: 100% stacked bar по менеджерам ──
// Процент скидки = UF_DISCOUNT («Скидка (из счёта)»); 0/пусто = без скидки.
// Сумма скидки ₽ = opp × pct/(100−pct) (расчёт на сервере, disc_abs_sum).
function discountRows(mgr) {
  var rows = [];
  (mgr.managers || []).forEach(function (m) { if ((m.postupleniya || 0) > 0) rows.push({ name: m.name, m: m, group: false }); });
  var g = mgr.groups || {};
  function agg(label, arrs) {
    var list = [];
    arrs.forEach(function (a) { (a || []).forEach(function (m) { list.push(m); }); });
    var sum = list.reduce(function (s, m) { return s + (m.postupleniya || 0); }, 0);
    if (sum <= 0) return;
    rows.push({ name: label, m: {
      postupleniya: sum,
      won_cnt: list.reduce(function (s, m) { return s + (m.won_cnt || 0); }, 0),
      disc_cnt: list.reduce(function (s, m) { return s + (m.disc_cnt || 0); }, 0),
      disc_sum: list.reduce(function (s, m) { return s + (m.disc_sum || 0); }, 0),
      disc_abs_sum: list.reduce(function (s, m) { return s + (m.disc_abs_sum || 0); }, 0),
      disc_pct_sum: list.reduce(function (s, m) { return s + (m.disc_pct_sum || 0); }, 0),
      nodisc_cnt: list.reduce(function (s, m) { return s + (m.nodisc_cnt || 0); }, 0),
      nodisc_sum: list.reduce(function (s, m) { return s + (m.nodisc_sum || 0); }, 0),
    }, group: true });
  }
  agg('Автооплаты', [g.autopay]);
  agg('ОЗК', [g.ozk]);
  agg('Прочее', [g.other]);
  agg('Артефакт', [g.bond, g.afanasyev, g.tech]);
  return rows;
}

function renderDiscountsCard(mgr) {
  var rows = discountRows(mgr).filter(function (r) { return (r.m.postupleniya || 0) > 0; });
  if (!rows.length) return '';
  var H = Math.max(220, rows.length * 30 + 60);
  return '<div class="card" style="margin-top:8px"><h2>Продажи со скидками <span style="font-size:12px;color:#475569;font-weight:400">(100% stacked: доля поступлений без скидки | со скидкой · справа — доля сделок со скидкой и средний % скидки · скидка = UF_DISCOUNT «Скидка (из счёта)»)</span></h2>'
    + '<div style="height:' + H + 'px;position:relative"><canvas id="mgrDiscChart"></canvas></div></div>';
}

function renderDiscountsChart(mgr) {
  var ctx = document.getElementById('mgrDiscChart');
  if (!ctx || !window.Chart) return;
  var rows = discountRows(mgr).filter(function (r) { return (r.m.postupleniya || 0) > 0; });
  if (!rows.length) return;
  function share(r, k) { var t = (r.m.disc_sum || 0) + (r.m.nodisc_sum || 0); return t > 0 ? (r.m[k] / t * 100) : 0; }  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map(function (r) { return r.name; }),
      datasets: [
        { label: 'Без скидки', data: rows.map(function (r) { return Math.round(share(r, 'nodisc_sum') * 10) / 10; }), backgroundColor: '#2E7D32', stack: 'd' },
        { label: 'Со скидкой', data: rows.map(function (r) { return Math.round(share(r, 'disc_sum') * 10) / 10; }), backgroundColor: '#F57C00', stack: 'd' },
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } }, y: { stacked: true } },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: function (c) {
              var r = rows[c.dataIndex];
              if (c.datasetIndex === 1) {
                var avg = r.m.disc_cnt ? r.m.disc_pct_sum / r.m.disc_cnt : 0;
                return 'Со скидкой: ' + r.m.disc_cnt + ' сд. · ' + Math.round(r.m.disc_sum).toLocaleString('ru-RU') + ' ₽ · сумма скидок ' + Math.round(r.m.disc_abs_sum).toLocaleString('ru-RU') + ' ₽ (ср. ' + avg.toFixed(1) + '%)';
              }
              return 'Без скидки: ' + r.m.nodisc_cnt + ' сд. · ' + Math.round(r.m.nodisc_sum).toLocaleString('ru-RU') + ' ₽';
            },
            footer: function (items) {
              var r = rows[items[0].dataIndex];
              return 'Всего: ' + ((r.m.disc_cnt || 0) + (r.m.nodisc_cnt || 0)) + ' сд. · ' + Math.round((r.m.disc_sum || 0) + (r.m.nodisc_sum || 0)).toLocaleString('ru-RU') + ' ₽';
            }
          }
        },
        datalabels: {
          display: function (c) { return c.datasetIndex === 1 && rows[c.dataIndex].m.disc_sum > 0; },
          anchor: 'end', align: 'end',
          color: '#0F172A', font: { weight: 600, size: 10 },
          formatter: function (v, c) {
            var r = rows[c.dataIndex];
            var deals = ((r.m.disc_cnt || 0) / ((r.m.disc_cnt || 0) + (r.m.nodisc_cnt || 0)) * 100);
            var avg = r.m.disc_cnt ? r.m.disc_pct_sum / r.m.disc_cnt : 0;
            return 'доля сделок со скидкой ' + deals.toFixed(0) + '% · ср. скидка ' + avg.toFixed(1) + '%';
          }
        }
      }
    }
  });
}

// ── Структура оплаченных сделок по размеру чека: два donut (кол-во | сумма) ──
// Диапазоны фиксированные; один диапазон — один цвет в обоих графиках.
var CHECK_BUCKET_COLORS = ['#9C27B0', '#00bcd4', '#F57C00', '#1565C0', '#2E7D32'];
var CHECK_BUCKET_LABELS = ['до 30 000', '30 000–50 000', '50 000–100 000', '100 000–300 000', 'более 300 000'];

function renderCheckDistCard(cd) {
  if (!cd || !cd.buckets || !cd.buckets.length) return '';
  var h = '<div class="card" style="margin-top:8px"><h2>Структура оплаченных сделок по размеру чека <span style="font-size:12px;color:#475569;font-weight:400">(' + fmt(cd.total.cnt) + ' оплат на ' + fmt(cd.total.sum) + ' ₽)</span></h2>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px">';
  h += '<div><h3 style="font-size:13px;margin:4px 0;color:#1f2a44">По количеству оплаченных сделок</h3><div style="height:300px;position:relative"><canvas id="chCheckCnt"></canvas></div></div>';
  h += '<div><h3 style="font-size:13px;margin:4px 0;color:#1f2a44">По сумме поступлений</h3><div style="height:300px;position:relative"><canvas id="chCheckSum"></canvas></div></div>';
  h += '</div></div>';
  return h;
}

// Плагин: текст в центре donut
var centerTextPlugin = {
  id: 'centerText',
  afterDraw: function (chart) {
    if (chart.config.options.centerText === false) return;
    var lines = chart.config.options.centerText || [];
    var ctx = chart.ctx;
    var meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data.length) return;
    var x = meta.data[0].x, y = meta.data[0].y;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 16px -apple-system, Segoe UI, Roboto, sans-serif';
    lines.forEach(function (line, i) {
      ctx.fillText(line, x, y + (i - (lines.length - 1) / 2) * 18);
    });
    ctx.restore();
  }
};
if (window.Chart && !Chart.registry.plugins.get('centerText')) Chart.register(centerTextPlugin);

function renderCheckDistChart(cd) {
  if (!window.Chart) return;
  var totalSum = cd.total.sum || 1;
  var tooltipCb = function (c) {
    var b = cd.buckets[c.dataIndex];
    var pCnt = cd.total.cnt > 0 ? (b.cnt / cd.total.cnt * 100).toFixed(1) : 0;
    var pSum = totalSum > 0 ? (b.sum / totalSum * 100).toFixed(1) : 0;
    return b.label + ' ₽: оплат ' + b.cnt + ' (' + pCnt + '%) · сумма ' + fmt(b.sum) + ' ₽ (' + pSum + '%)';
  };
  var doughnut = function (id, vals, center) {
    var el = document.getElementById(id);
    if (!el) return;
    var totalV = vals.reduce(function (a, b) { return a + b; }, 0) || 1;
    new Chart(el, {
      type: 'doughnut',
      data: {
        labels: cd.buckets.map(function (b, i) { return CHECK_BUCKET_LABELS[i] + ' — ' + (vals[i] / totalV * 100).toFixed(1) + '%'; }),
        datasets: [{ data: vals, backgroundColor: CHECK_BUCKET_COLORS.slice(0, vals.length), borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '58%',
        centerText: center,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: tooltipCb } },
          datalabels: { display: false }
        }
      }
    });
  };
  doughnut('chCheckCnt', cd.buckets.map(function (b) { return b.cnt; }), [fmt(cd.total.cnt), 'оплат']);
  doughnut('chCheckSum', cd.buckets.map(function (b) { return b.sum; }), [fmtM(cd.total.sum), '₽']);
}
