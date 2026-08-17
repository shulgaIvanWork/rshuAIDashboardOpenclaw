/**
 * app-render.js — renderPageMainNew(): вся отрисовка страницы.
 *
 * KPI-секции (Итого/ООМ/КОМ с дельтами к периоду сравнения), донаты (форматы/тип обучения/
 * B2B/источники) с таблицами, «Ключевые выводы», KPI регистрации, недельная/месячная таблица
 * и графики Chart.js (в setTimeout, после вставки canvas). Вызывает loadArtifacts() (app-core.js).
 * Переключатель Недели/Месяцы — через window.periodModes (app-core.js) и setPeriodMode().
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
  if (grpAuto.length)  rows.push(rowHtml('🤖 Автооплаты', ga, { cls: 'mgr-group-row' }));
  if (grpOzk.length)   rows.push(rowHtml('🏭 ОЗК', go, { cls: 'mgr-group-row' }));
  if (grpOther.length) rows.push(rowHtml('🗂 Прочие (уволенные)', gp, { cls: 'mgr-group-row' }));

  var head ='<tr><th class="sort" data-col="0">Менеджер</th><th class="sort" data-col="1">Сделок</th><th class="sort" data-col="2">Поступления</th><th class="sort" data-col="3">Ср. чек</th><th class="sort" data-col="4">Цикл, дн</th><th class="sort" data-col="5">Лиды</th><th class="sort" data-col="6">MQL</th><th class="sort" data-col="7">Δ к пред.</th><th class="sort" data-col="8">Доля</th></tr>';
  var totDur = [ga, go, gp].reduce(function (a, g) { return a + (g.avg_close_days_won || 0) * (g.won_cnt || 0); }, managers.reduce(function (a, m) { return a + (m.avg_close_days_won || 0) * (m.won_cnt || 0); }, 0));
  var totDurV = totCnt ? Math.round(totDur / totCnt * 10) / 10 : 0;
  var h = '<div class="card" style="margin-top:8px"><h2>👥 Продажи по менеджерам <span style="font-size:12px;color:#475569;font-weight:400">(за выбранный период · пред.: ' + mgr.prev_period.from + ' — ' + mgr.prev_period.to + ')</span></h2>';
  h += '<div class="scroll-x"><table class="table table-sm sortable" id="mgrTableMain" style="font-size:11px;margin-bottom:0"><thead>' + head + '</thead><tbody>';
  h += '<tr class="total-row" style="background:#eef1f8;font-weight:700;border-top:2px solid #1f2a44;border-bottom:2px solid #1f2a44"><td>📊 ИТОГО</td><td>' + fmt(totCnt) + '</td><td>' + fmt(totSum) + ' ₽</td><td>' + fmt(totCnt ? Math.round(totSum / totCnt) : 0) + ' ₽</td><td>' + totDurV.toFixed(1) + '</td><td>' + fmt(totLeads) + '</td><td>' + fmt(totMql) + '</td><td>—</td><td>100%</td></tr>';
  rows.forEach(function (r) { h += r; });
  h += '</tbody></table></div></div>';
  return h;
}

// ── Отчёт по менеджерам: Таблица 1 (показатели), Таблица 2 (конверсии), срезы, воронка ──
// rep — ответ /api/managers-report: {managers:[...], period}. Менеджеры уже
// сгруппированы (индивид. + Автооплаты/ОЗК/Прочие). Перенос из manager-report-dev.
function renderMgrReportBlock(rep) {
  var mgrs = (rep.managers || []).filter(function (m) { return m.paid || m.created || m.in_work_start; });
  if (!mgrs.length) return '';

  function bdg(v, lo, hi) { return v >= hi ? 'green' : v <= lo ? 'red' : 'yellow'; }
  function sK(arr, k) { return arr.reduce(function (s, x) { return s + (x[k] || 0); }, 0); }
  function wavgK(arr, k, w) { var nn = 0, dd = 0; arr.forEach(function (x) { nn += (x[k] || 0) * (x[w] || 0); dd += x[w] || 0; }); return dd ? nn / dd : 0; }
  function pc(v) { return (v || 0).toFixed(1) + '%'; }

  // ── Таблица 1: Основные показатели ──
  var cols1 = [
    { k: 'name', l: 'Менеджер' }, { k: 'in_work_start', l: '📦 В работе(н)' },
    { k: 'created', l: '➕ Создано' }, { k: 'na_kvalifikatsii', l: '🔍 На квал-и' },
    { k: 'mql', l: '🎯 MQL' }, { k: 'sql', l: '📊 SQL' }, { k: 'invoice_cnt', l: '📄 Счёт' },
    { k: 'paid', l: '✅ Оплачено' }, { k: 'kval_lost', l: '❌ Квал отказы' },
    { k: 'nekval_lost', l: '❌ Не квал' }, { k: 'in_work_end', l: '🔄 В работе(к)' },
    { k: 'paid_sum', l: '💰 Пост-я' }, { k: 'avg_check', l: '💵 Ср.чек' },
    { k: 'avg_dur', l: '⏱ Цикл' }, { k: 'conv_pct', l: '📊 Конв.%' },
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
  t1 += '<tr class="total-row" style="background:#eef1f8;font-weight:700;border-top:2px solid #1f2a44;border-bottom:2px solid #1f2a44"><td><b>📊 ИТОГО</b></td>';
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
    { k: 'name', l: 'Менеджер' }, { k: 'conv_lead_mql', l: '📊 Создано→MQL' },
    { k: 'conv_mql_sql', l: '📊 MQL→SQL' }, { k: 'conv_sql_inv', l: '📊 SQL→Счёт' },
    { k: 'conv_inv_paid', l: '📊 Счёт→Оплата' }, { k: 'conv_pct', l: '📊 Конв.%' },
    { k: 'avg_dur', l: '⏱ Цикл', rev: true }, { k: 'avg_check', l: '💵 Ср.чек' },
    { k: 'paid_sum', l: '💰 Пост-я' },
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
  t2 += '<tr class="total-row" style="background:#eef1f8;font-weight:700;border-top:2px solid #1f2a44;border-bottom:2px solid #1f2a44"><td><b>📊 СРЕДНЕЕ</b></td>';
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
  h += '<div class="card" style="margin-top:8px"><h2>📋 Таблица 1: Основные показатели по менеджерам</h2><div class="scroll-x">' + t1 + '</div></div>';
  h += '<div class="card" style="margin-top:8px"><h2>📊 Таблица 2: Конверсии и отклонения от среднего <span style="font-size:12px;color:#475569;font-weight:400">(цвет — отклонение от среднего по отделу)</span></h2><div class="scroll-x">' + t2 + '</div></div>';
  // Срезы — вертикальные stacked-столбцы, сортировка по сумме (выше сумма — выше столбец)
  h += '<div class="card" style="margin-top:8px"><h2>📊 Срезы по менеджерам <span style="font-size:12px;color:#475569;font-weight:400">(вертикальные столбцы, сортировка по сумме)</span></h2>';
  h += '<h3 style="font-size:13px;margin:8px 0;color:#1f2a44">B2B vs B2C</h3><div style="height:360px;position:relative"><canvas id="mgrBarsB2b"></canvas></div>';
  h += '<h3 style="font-size:13px;margin:20px 0 8px;color:#1f2a44">Источники (внутренняя база vs маркетинг)</h3><div style="height:360px;position:relative"><canvas id="mgrBarsSrc"></canvas></div>';
  h += '<h3 style="font-size:13px;margin:20px 0 8px;color:#1f2a44">Форматы обучения</h3><div style="height:360px;position:relative"><canvas id="mgrBarsFmt"></canvas></div>';
  h += '</div>';
  // Воронка (фиксация состояния в периоде с учётом переходящего остатка)
  h += '<div class="card" style="margin-top:8px"><h2>Воронка <span style="font-size:12px;color:#475569;font-weight:400">(фиксация состояния в периоде с учётом переходящего остатка)</span></h2><div style="height:600px;position:relative"><canvas id="mgrFunnelReport"></canvas></div></div>';
  return h;
}

// Графики блока «Отчёт по менеджерам»: срезы (верт. stacked bar) + воронка (stack2 по неделям).
function initMgrReportCharts(rep, weeks) {
  if (!window.Chart) return;
  var mgrs = (rep.managers || []).filter(function (m) { return m.paid || m.created || m.in_work_start; });

  var slices = [
    { id: 'mgrBarsB2b', items: [ { k: 'b2b_sum', label: 'B2B', color: '#1f2a44' }, { k: 'b2c_sum', label: 'B2C', color: '#00bcd4' } ] },
    { id: 'mgrBarsSrc', items: [ { k: 'src_int_sum', label: 'Внутренняя база', color: '#2e7d32' }, { k: 'src_mkt_sum', label: 'Маркетинг', color: '#ff9800' } ] },
    { id: 'mgrBarsFmt', items: [ { k: 'fmt_oom_sum', label: 'ООМ (Очное)', color: '#1565c0' }, { k: 'fmt_om_sum', label: 'ОМ (Онлайн)', color: '#7b1fa2' }, { k: 'fmt_sdo_sum', label: 'СДО', color: '#e65100' } ] },
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
          scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, beginAtZero: true } },
        },
      });
    } catch (e) {}
  });

  var fel = document.getElementById('mgrFunnelReport');
  if (fel && weeks && weeks.length) {
    var flabels = weeks.map(function (w) { return w.label_dates || ('Нед.' + String(w.week).padStart(2, '0')); });
    try {
      new Chart(fel, {
        type: 'bar',
        data: { labels: flabels, datasets: [
          { label: 'Отказы неКвал', data: weeks.map(function (w) { return w.stack2_rej_nq || 0; }), backgroundColor: '#880E4F', borderRadius: 4 },
          { label: 'Отказы',        data: weeks.map(function (w) { return w.stack2_rej    || 0; }), backgroundColor: '#E53935', borderRadius: 4 },
          { label: 'Не квал',       data: weeks.map(function (w) { return w.stack2_nq     || 0; }), backgroundColor: '#FFD54F', borderRadius: 4 },
          { label: 'MQL',           data: weeks.map(function (w) { return w.stack2_mql    || 0; }), backgroundColor: '#42A5F5', borderRadius: 4 },
          { label: 'SQL',           data: weeks.map(function (w) { return w.stack2_sql    || 0; }), backgroundColor: '#1A237E', borderRadius: 4 },
          { label: 'Счёт',          data: weeks.map(function (w) { return w.stack2_inv    || 0; }), backgroundColor: '#7E57C2', borderRadius: 4 },
          { label: 'Оплата',        data: weeks.map(function (w) { return w.stack2_pay    || 0; }), backgroundColor: '#43A047', borderRadius: 4 },
        ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { font: { size: 10 } } }, datalabels: { display: false } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
      });
    } catch (e) {}
  }
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
  s += '<tr class="total-row" style="background:#eef1f8;font-weight:700;border-top:2px solid #1f2a44;border-bottom:2px solid #1f2a44"><td><b>📊 ИТОГО</b></td><td>'+tL+'</td><td>'+tM+'</td><td>'+tS+'</td><td>'+tInv+'</td><td>'+tO+'</td><td>'+fmt(tP0)+'</td><td>'+fmt(tAvgChk)+'</td><td>'+(tAvgDur||0).toFixed(1)+'</td><td>'+tCl.toFixed(1)+'%</td><td>'+tCs.toFixed(1)+'%</td><td>'+tSi.toFixed(1)+'%</td><td>'+tIo.toFixed(1)+'%</td><td>'+tLo.toFixed(1)+'%</td></tr>';
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

    var b2b = d.btype_ytd||{}, b2bRow = (b2b.B2B||{cnt:0,sum:0}), b2cRow = (b2b.B2C||{cnt:0,sum:0}), totB2b = b2bRow.sum+b2cRow.sum||1;
    var weeks = d.weeks||[], labels = weeks.map(function(w){return w.label_dates || w.label_short || 'Неделя'+String(w.week).padStart(2,'0');});
    // Недели или месяцы — независимо для каждого блока (Поступления/Воронка/таблица)
    var monthsArr = d.months || [];
    function mkLabels(arr) { return arr.map(function(w){return w.label_dates || w.label_short || 'Неделя'+String(w.week).padStart(2,'0');}); }
    function isMonths(block) { return window.periodModes[block] === 'months' && monthsArr.length > 0; }
    function perToggle(block) {
      var m = isMonths(block);
      return '<span style="float:right;font-weight:400">'
        + "<button class=\"tab"+(m?'':' active')+"\" style=\"padding:4px 12px;font-size:12px\" onclick=\"setPeriodMode('"+block+"','weeks')\">Недели</button>"
        + "<button class=\"tab"+(m?' active':'')+"\" style=\"padding:4px 12px;font-size:12px\" onclick=\"setPeriodMode('"+block+"','months')\">Месяцы</button>"
        + '</span>';
    }
    var posBuckets = isMonths('pos') ? monthsArr : weeks, posLabels = mkLabels(posBuckets);
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
    // 👥 Продажи по менеджерам — сравнение за выбранный период
    if (d.mgr_sales) html += renderManagersBlock(d.mgr_sales);
    // 📋 Отчёт по менеджерам: Таблица 1/2, срезы, воронка (перенос из manager-report-dev)
    if (d.mgr_report) html += renderMgrReportBlock(d.mgr_report);
    // Поступления по неделям/месяцам (на всю ширину) + переключатель
    html += '<div class="card" style="margin-top:8px"><h2>Поступления '+(isMonths('pos')?'по месяцам':'по неделям')+perToggle('pos')+'</h2><div style="height:440px;position:relative"><canvas id="newChPos"></canvas></div></div>';
    // Форматы + Тип обучения
    html += '<div class="twocol" style="margin-top:8px">';
    html += '<div class="card"><h2>Поступления по форматам</h2><div class="chartbox-sm"><canvas id="newChFmt"></canvas></div><div id="newFmtTableUnderChart" style="margin-top:8px"></div></div>';
    html += '<div class="card"><h2>Поступления по типу обучения</h2><div class="chartbox-sm"><canvas id="newChEdu"></canvas></div><div id="newEduTable" style="margin-top:8px"></div></div>';
    html += '</div>';
    // B2B/B2C + Источники — под Форматами/Типом
    html += '<div class="twocol" style="margin-top:8px">';
    html += '<div class="card"><h2>Тип клиента: B2B / B2C</h2><div class="chartbox-sm"><canvas id="newChB2b"></canvas></div><div id="newB2bTable"></div></div>';
    html += '<div class="card"><h2>Источники: Внутренняя база vs Маркетинговые сделки</h2><div class="chartbox-sm"><canvas id="newChSrcSplit"></canvas></div><div id="newSrcSplitTable"></div></div>';
    html += '</div>';
    // Стеки воронок - на всю ширину, друг под другом
    html += '<div class="card" style="margin-top:8px"><h2>Воронка '+(isMonths('funnel')?'по месяцам':'по неделям')+' <span style="font-size:12px;color:#475569;font-weight:400">(созданные и зафиксированные на стадии '+(isMonths('funnel')?'в том же месяце':'на той же неделе')+')</span>'+perToggle('funnel')+'</h2><div style="height:600px;position:relative"><canvas id="newChFunnel2"></canvas></div></div>';
    // Конверсии


    // Строка таблицы разбивки: период/пред.период
    function splitRow(label, dotColor, name, row, tot, dashed) {
      var avg = row.cnt > 0 ? Math.round(row.sum / row.cnt) : 0;
      return '<tr'+(dashed?' style="border-top:1px dashed #ccc"':'')+'><td>'+label+'</td><td><span class="dot" style="background:'+dotColor+'"></span>'+name+'</td><td>'+row.cnt+'</td><td>'+fmt(row.sum)+'</td><td>'+fmt(avg)+'</td><td>'+(row.sum/tot*100).toFixed(1)+'%</td></tr>';
    }
    var ppSplits = (d.pp && d.pp.splits) || null;
    var ppLbl = 'Пред. период' + (d.pp && d.pp.label ? '<br><span class="muted">' + d.pp.label + '</span>' : '');

    // B2B: таблица под графиком — выбранный период + предыдущий
    var b2bTbl = '<table style="font-size:11px;margin-top:8px"><tr><th>Период</th><th>Тип</th><th>Шт</th><th>Сумма</th><th>Средний чек</th><th>Доля,%</th></tr>'
      + splitRow('За период', '#3079D2', 'B2B', b2bRow, totB2b, false)
      + splitRow('', '#F57C00', 'B2C', b2cRow, totB2b, false);
    if (ppSplits && ppSplits.btype) {
      var ppB2b = ppSplits.btype.B2B || {cnt:0,sum:0}, ppB2c = ppSplits.btype.B2C || {cnt:0,sum:0};
      var ppTotB2b = ppB2b.sum + ppB2c.sum || 1;
      b2bTbl += splitRow(ppLbl, '#3079D2', 'B2B', ppB2b, ppTotB2b, true)
              + splitRow('', '#F57C00', 'B2C', ppB2c, ppTotB2b, false);
    }
    b2bTbl += '</table>';

    // Источники: таблица под графиком — выбранный период + предыдущий
    var srcYtd = d.src_split_ytd||{};
    var srcInternal = srcYtd.internal||{cnt:0,sum:0}, srcMkt = srcYtd.marketing||{cnt:0,sum:0};
    var srcTot = srcInternal.sum+srcMkt.sum||1;
    var srcTbl = '<table style="font-size:11px;margin-top:8px"><tr><th>Период</th><th>Тип</th><th>Шт</th><th>Сумма</th><th>Средний чек</th><th>Доля,%</th></tr>'
      + splitRow('За период', '#1f2a44', ' Внутренняя база', srcInternal, srcTot, false)
      + splitRow('', '#00bcd4', ' Маркетинговые сделки', srcMkt, srcTot, false);
    if (ppSplits && ppSplits.src) {
      var ppInt = ppSplits.src.internal || {cnt:0,sum:0}, ppMkt = ppSplits.src.marketing || {cnt:0,sum:0};
      var ppSrcTot = ppInt.sum + ppMkt.sum || 1;
      srcTbl += splitRow(ppLbl, '#1f2a44', ' Внутренняя база', ppInt, ppSrcTot, true)
              + splitRow('', '#00bcd4', ' Маркетинговые сделки', ppMkt, ppSrcTot, false);
    }
    srcTbl += '</table>';
        // MBA — перенесён на ratings-dashboard

    // Регистрация — над недельной таблицей
    html += '<div class="kpis kpis-8" id="newRegKpis" style="margin-top:16px"></div>';
    html += '<div class="card"><h2>'+(isMonths('table')?'Таблица по месяцам':'Недельная таблица')+mgrWeekSelectHtml(d)+perToggle('table')+'</h2><div class="scroll-x"><div id="newWeekTable"></div></div></div>';

    // --- Ключевые выводы ---
    var weeks = d.weeks || [];
    var lastIdx = weeks.length - 1;
    while (lastIdx > 0 && weeks[lastIdx] && weeks[lastIdx].postupleniya === 0 && weeks[lastIdx].oplata === 0) {
      lastIdx--;
    }
    var last = weeks[lastIdx] || {};
    var prev = weeks[lastIdx - 1] || {};
    var wkDelta = 0;
    if (prev.postupleniya && prev.postupleniya > 0) {
      wkDelta = (last.postupleniya - prev.postupleniya) / prev.postupleniya * 100;
    } else if (last.postupleniya > 0) {
      wkDelta = 100;
    }
    var ytd = d.ytd || {};
    var srcTop = d.src_rating || [];
    var fmtData = Object.entries(d.fmt_ytd || {}).filter(function(e){return e[0] !== 'period';}).sort(function(a,b){return (b[1].sum||0) - (a[1].sum||0);});
    var mgrTop = d.mgr_top || [];
    var btypeAll = d.btype_ytd || {};
    var b2b = btypeAll.B2B || {cnt:0,sum:0};
    var b2c = btypeAll.B2C || {cnt:0,sum:0};
    var totSum = b2b.sum + b2c.sum || 1;
    var b2bPct = (b2b.sum / totSum * 100).toFixed(0);
    var b2cPct = (b2c.sum / totSum * 100).toFixed(0);
    var reg = d.reg_ytd || {};
    var regConv = reg.conv || 0;
    var regPaid = reg.total_paid || 0;
    var regTotal = reg.total || 0;

    // Форматы по сумме и по количеству
    var fmtSumSorted = fmtData.slice().sort(function(a,b){return (b[1].sum||0) - (a[1].sum||0);});
    var fmtCntSorted = fmtData.slice().sort(function(a,b){return (b[1].cnt||0) - (a[1].cnt||0);});
    var topFmtSum = fmtSumSorted.length > 0 ? fmtSumSorted[0] : null;
    var topFmtCnt = fmtCntSorted.length > 0 ? fmtCntSorted[0] : null;

    html += '<div class="card" style="background:linear-gradient(135deg,#f8f9ff,#eef1f8)">';
    html += '<h2>📋 Ключевые выводы</h2>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;line-height:1.6">';
    // Выбранный период
    html += '<div><b>📊 В выбранном периоде:</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += '<li>Поступления: <b>'+fmt(ytd.postupleniya)+' ₽</b> ('+ytd.won_relevant_cnt+' сделок)</li>';
    html += '<li>Средний чек: <b>'+fmt(ytd.avg_check)+' ₽</b></li>';
    html += '<li>Медиана закрытия: <b>'+(ytd.median_close_days_won||0)+' дн.</b> · Взвешенный: <b>'+(ytd.avg_close_days_won_weighted||ytd.avg_close_days_won||0).toFixed(1)+' дн.</b></li>';
    html += '<li>Конверсия лид→сделка: <b>'+(ytd.conv_deal_pct||0).toFixed(1)+'%</b></li>';
    html += '<li>B2B <b>'+b2bPct+'%</b> ('+fmt(b2b.sum)+' ₽) / B2C <b>'+b2cPct+'%</b> ('+fmt(b2c.sum)+' ₽)</li>';
    html += '</ul></div>';
    // Неделя
    var wkLabel = '№'+String(last.week||'');
    var wkDates = last.label_dates || '';
    html += '<div><b>📈 Текущая неделя '+wkLabel+' ('+wkDates+'):</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += '<li>Поступления: <b>'+fmt(last.postupleniya)+' ₽</b> '+(wkDelta>=0?'📈 +':'📉 ')+Math.abs(wkDelta).toFixed(1)+'% к прошлой</li>';
    html += '<li>Сделок: <b>'+(last.won_cnt||0)+'</b> · Лидов: <b>'+(last.leads||0)+'</b></li>';
    html += '</ul></div>';
    // Регистрация
    html += '<div><b>📥 Регистрация:</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += '<li>Пришло: <b>'+fmt(regTotal)+'</b> · Оплачено: <b>'+regPaid+'</b> (<b>'+regConv+'%</b>)</li>';
    html += '<li>Средний чек: <b>'+fmt(reg.avg_check || 0)+' ₽</b> · Цикл: <b>'+(reg.avg_dur||0).toFixed(1)+' дн.</b></li>';
    html += '</ul></div>';
    // Лидеры
    html += '<div><b>🏆 Лидеры:</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += '<li>Формат: <b>'+(topFmtSum ? escapeHtml(topFmtSum[0]) : '-')+'</b> ('+fmt(topFmtSum ? topFmtSum[1].sum : 0)+' ₽)'+(topFmtCnt && topFmtCnt[0] !== topFmtSum[0] ? ' · <b>'+escapeHtml(topFmtCnt[0])+'</b> ('+topFmtCnt[1].cnt+' сд.)' : '')+'</li>';
    // src_rating отсортирован по сумме ([0] — ИТОГО); Регистрацию ищем по имени,
    // а не по индексу — её место в рейтинге меняется
    var srcReg = srcTop.find(function(s){ return s.name === 'Регистрация'; });
    html += '<li>Источник: <b>'+(srcTop.length > 1 ? escapeHtml(srcTop[1].name) : '-')+'</b> ('+fmt(srcTop.length > 1 ? srcTop[1].postupleniya : 0)+' ₽) · Регистрация: <b>'+fmt(srcReg ? srcReg.postupleniya : 0)+' ₽</b></li>';
    html += '<li>'+(mgrTop.length > 0 ? 'Менеджер: <b>'+escapeHtml(mgrTop[0].name)+'</b> ('+fmt(mgrTop[0].postupleniya)+' ₽)' : '')+'</li>';
    html += '</ul></div>';
    // Выводы
    html += '<div style="grid-column:1/-1"><b>💡 Выводы:</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += '<li>🔵 Медиана закрытия <b>'+(ytd.median_close_days_won||0)+' дн.</b> — быстрые сделки, но взвешенный '+(ytd.avg_close_days_won_weighted||ytd.avg_close_days_won||0).toFixed(1)+' дн. — крупные КОМ растягивают среднюю</li>';
    html += '<li>🟢 Регистрация: <b>'+regConv+'%</b> конверсии в сделку — лучшая среди всех источников</li>';
    if (wkDelta < -20) {
      html += '<li>🔴 Резкое падение ('+Math.abs(wkDelta).toFixed(0)+'% к прошлой неделе) — на фоне '+(last.leads||0)+' лидов может быть эффектом конца периода, а не просадкой спроса</li>';
    }
    html += '<li>📌 <b>'+escapeHtml(topFmtSum?topFmtSum[0]:'')+'</b> лидирует по сумме, <b>'+escapeHtml(topFmtCnt?topFmtCnt[0]:'')+'</b> — по количеству ('+(topFmtCnt?topFmtCnt[1].cnt:0)+' сд.)</li>';
    if (ytd.conv_deal_pct < 25) {
      html += '<li>🎯 Конверсия лид→сделка <b>'+(ytd.conv_deal_pct||0).toFixed(1)+'%</b> — ниже 25%, потенциал в улучшении качества лидов</li>';
    }
    html += '</ul></div>';
    html += '</div></div>';

    // Блок артефактов — виден только admin (403 для остальных обрабатывается внутри loadArtifacts)
    html += '<div class="card"><h2>⚠️ Артефакты данных</h2><div class="sub" style="margin:-8px 0 14px">Аномалии, требующие проверки</div><div id="newArtifactsBlock"><div class="text-center text-secondary py-4"><div class="spinner-border text-primary mb-2" role="status"></div><div>Загрузка...</div></div></div></div>';

    // Batch update all at once
    areaNew.innerHTML = html;

    // Артефакты грузятся параллельно — не блокируют рендер
    loadArtifacts();

    // Сортировка таблицы блока «Продажи по менеджерам» (после вставки HTML)
    if (d.mgr_sales) initTableSort('mgrTableMain');
    if (d.mgr_report) { initTableSort('mgrTab1'); initTableSort('mgrTab2'); }

    // Now fill in table data (elements exist now)
    var fmtData = d.fmt_ytd||{};
    var fmtShort = function(n){return n.replace(' (Онлайн)','').replace(' (Очное)','');};
    var fmtRename = {'ООМ':'Очный','ОМ':'Онлайн','СДО':'Дистанционный','КОМ':'Корпоративное обучение'};
    var fmtDisplay = function(n){var s=fmtShort(n);return fmtRename[s]||s;};
    var fmtOrder = ['Очный','Онлайн','Видеокурс','Корпоративное обучение'];
    var fmtTot = 0, fmtEntries = [];
    for(var ftk in fmtData){if(ftk!=='period'){fmtTot+=fmtData[ftk].sum||0;fmtEntries.push([ftk, fmtData[ftk]]);}}
    fmtEntries.sort(function(a,b){
      var ai = fmtOrder.indexOf(fmtDisplay(a[0])); if(ai===-1) ai=99;
      var bi = fmtOrder.indexOf(fmtDisplay(b[0])); if(bi===-1) bi=99;
      return ai - bi;
    });
    var fmtStr = '<table style="font-size:11px"><tr><th>Формат</th><th>Сумма</th><th>Шт</th><th>Ср.чек</th><th>Доля,%</th></tr>';
    for (var fi = 0; fi < fmtEntries.length; fi++) {
      var fk = fmtEntries[fi][0], fv = fmtEntries[fi][1];
      fmtStr += '<tr><td>'+fmtDisplay(escapeHtml(fk))+'</td><td>'+fmt(fv.sum)+' \u20bd</td><td>'+fv.cnt+'</td><td>'+fmt(Math.round(fv.sum/fv.cnt))+' \u20bd</td><td>'+(fmtTot>0?(fv.sum/fmtTot*100).toFixed(1):'0.0')+'%</td></tr>';
    }
    fmtStr += '</table>';
    var el = document.getElementById('newFmtTable');
    if (el) el.innerHTML = fmtStr;
    var el2 = document.getElementById('newFmtTableUnderChart');
    if (el2) el2.innerHTML = fmtStr;

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
          if (document.getElementById('newChConv')) new Chart(document.getElementById('newChConv'), {type:'line', data:{labels:labels,datasets:[{label:'Лиды\u2192MQL %',data:weeks.map(function(w){return w.conv_lead_mql||0;}),borderColor:'#B0BEC5',tension:0.3,fill:false},{label:'MQL\u2192SQL %',data:weeks.map(function(w){return w.conv_mql_sql||0;}),borderColor:'#3079D2',tension:0.3,fill:false},{label:'SQL\u2192Счёт %',data:weeks.map(function(w){return w.conv_sql_invoice||0;}),borderColor:'#43A047',tension:0.3,fill:false},{label:'Счёт\u2192Сделка %',data:weeks.map(function(w){return w.conv_sql_oplata||0;}),borderColor:'#2E7D32',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
        } catch(e){}
        try {
          if (document.getElementById('newChPos')) new Chart(document.getElementById('newChPos'), {type:'bar', data:{labels:posLabels,datasets:[{label:'ООМ',data:posBuckets.map(function(w){return w.oom_postupleniya||0;}),backgroundColor:'#00bcd4',borderRadius:4},{label:'КОМ',data:posBuckets.map(function(w){return w.kom_postupleniya||0;}),backgroundColor:'#9C27B0',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10}}},datalabels:{display:false},tooltip:{callbacks:{label:function(ctx){var i=ctx.dataIndex;var v=ctx.raw||0;var oom=posBuckets[i].oom_postupleniya||0;var kom=posBuckets[i].kom_postupleniya||0;var tot=oom+kom;if(ctx.datasetIndex===0) return ctx.dataset.label+': '+v.toLocaleString('ru-RU')+' ₽ из '+tot.toLocaleString('ru-RU')+' ₽';if(ctx.datasetIndex===1) return ctx.dataset.label+': '+v.toLocaleString('ru-RU')+' ₽ из '+tot.toLocaleString('ru-RU')+' ₽';return ctx.dataset.label+': '+v.toLocaleString('ru-RU')+' ₽';}}}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
          // qual funnel
          if (document.getElementById('ch_funnel_new_qual')) new Chart(document.getElementById('ch_funnel_new_qual'), {type:'bar', data:{labels:labels,datasets:[{label:'MQL',data:weeks.map(function(w){return w.mql||0;}),backgroundColor:'#3079D2',borderRadius:4},{label:'SQL',data:weeks.map(function(w){return w.sql||0;}),backgroundColor:'#9A7B3F',borderRadius:4},{label:'Оплачено',data:weeks.map(function(w){return w.oplata||0;}),backgroundColor:'#2E7D32',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
          if (document.getElementById('ch_conv_new_qual')) new Chart(document.getElementById('ch_conv_new_qual'), {type:'line', data:{labels:labels,datasets:[{label:'MQL→SQL %',data:weeks.map(function(w){return w.conv_mql_sql||0;}),borderColor:'#3079D2',tension:0.3,fill:false},{label:'SQL→Сделки %',data:weeks.map(function(w){return w.conv_sql_oplata||0;}),borderColor:'#2E7D32',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
          try {
          if (document.getElementById('newChFmt')){var fl=[],fv=[],fsn=[];var fmtRn={'ООМ':'Очный','ОМ':'Онлайн','СДО':'Дистанционный','КОМ':'Корпоративное обучение'};var fmtSh=function(n){var s=n.replace(' (Онлайн)','').replace(' (Очное)','');return fmtRn[s]||s;};for(var fk in fmtData){if(fk==='period')continue;fl.push(fk);fsn.push(fmtSh(fk));fv.push(fmtData[fk].sum||0);}var ftot=fv.reduce(function(a,b){return a+b;},0);new Chart(document.getElementById('newChFmt'),{type:'doughnut',data:{labels:fsn,datasets:[{data:fv,backgroundColor:['#2E7D32','#1976D2','#F57C00','#9C27B0']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10}}},datalabels:{color:'#fff',font:{weight:'bold',size:12},formatter:function(v){var p=ftot>0?(v/ftot*100).toFixed(1):0;return p+'%';}}}}});}
          // Тип обучения: пончик
          var eduData = d.edu_ytd||{}; var eduFl=[], eduFv=[], eduFsn=[];
          for(var ek in eduData){if(ek==='period')continue;eduFl.push(ek);eduFsn.push(ek);eduFv.push(eduData[ek].sum||0);}
          var eduTot=eduFv.reduce(function(a,b){return a+b;},0);
          if (document.getElementById('newChEdu')) new Chart(document.getElementById('newChEdu'),{type:'doughnut',data:{labels:eduFsn,datasets:[{data:eduFv,backgroundColor:['#1976D2','#00bcd4','#9C27B0']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:9}}},datalabels:{color:'#fff',font:{weight:'bold',size:10},formatter:function(v){var p=eduTot>0?(v/eduTot*100).toFixed(1):0;return p+'%';}}}}});
          // Тип обучения: таблица
          var eduStr = '<table style="font-size:11px"><tr><th>Направление</th><th>Поступления</th><th>Шт</th><th>Ср.чек</th><th>Доля,%</th></tr>';
          var edul=(eduData||{}); for(var ek in edul){if(ek==='period')continue;var ev=edul[ek]||{sum:0,cnt:0};eduStr+='<tr><td>'+ek+'</td><td>'+fmt(ev.sum)+' ₽</td><td>'+ev.cnt+'</td><td>'+(ev.cnt>0?fmt(Math.round(ev.sum/ev.cnt)):0)+' ₽</td><td>'+(eduTot>0?(ev.sum/eduTot*100).toFixed(1):'0.0')+'%</td></tr>';}
          eduStr += '</table>';
          var eduEl = document.getElementById('newEduTable'); if(eduEl) eduEl.innerHTML = eduStr;
          } catch(e){}
        } catch(e){}
        try {
          if (document.getElementById('newChB2b')) new Chart(document.getElementById('newChB2b'),{type:'doughnut',data:{labels:['B2B','B2C'],datasets:[{data:[b2bRow.sum,b2cRow.sum],backgroundColor:['#3079D2','#F57C00']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}},datalabels:{color:'#fff',font:{weight:'bold',size:14},formatter:function(v){var t=b2bRow.sum+b2cRow.sum;return t>0?(v/t*100).toFixed(1)+'%':'';}},tooltip:{callbacks:{label:function(ctx){var i=ctx.dataIndex;var row=i===0?b2bRow:b2cRow;return ctx.label+': '+row.cnt+' шт. · '+fmt(row.sum)+' ₽';}}}}}});
          // B2B/B2C таблица под графиком
          var b2bEl = document.getElementById('newB2bTable');
          if (b2bEl) b2bEl.innerHTML = b2bTbl;
          // Источники: пончик
          if (document.getElementById('newChSrcSplit')) new Chart(document.getElementById('newChSrcSplit'),{type:'doughnut',data:{labels:['Внутренняя база','Маркетинговые сделки'],datasets:[{data:[srcInternal.sum,srcMkt.sum],backgroundColor:['#1f2a44','#00bcd4']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}},datalabels:{color:'#fff',font:{weight:'bold',size:13},formatter:function(v){var t=srcInternal.sum+srcMkt.sum;return t>0?(v/t*100).toFixed(1)+'%':'';}},tooltip:{callbacks:{label:function(ctx){var i=ctx.dataIndex;var row=i===0?srcInternal:srcMkt;return ctx.label+': '+row.cnt+' шт. · '+fmt(row.sum)+' ₽';}}}}}});
          // Источники: таблица под графиком
          var srcEl = document.getElementById('newSrcSplitTable');
          if (srcEl) srcEl.innerHTML = srcTbl;
        } catch(e){}
        try {
          if (document.getElementById('newChDur')) new Chart(document.getElementById('newChDur'),{type:'line',data:{labels:labels,datasets:[{label:'Цикл сделки, дн.',data:weeks.map(function(w){return w.avg_dur||0;}),borderColor:'#9A7B3F',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
        } catch(e){}
        try {
          if (document.getElementById('newChPreSale')) new Chart(document.getElementById('newChPreSale'),{type:'line',data:{labels:labels,datasets:[{label:'Pre Sale, дн.',data:weeks.map(function(w){return w.avg_presale_dur||0;}),borderColor:'#43A047',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
        } catch(e){}
      }
    }, 100);

  } catch(e) {
    areaNew.innerHTML = '<div class="alert alert-danger" style="cursor:pointer" onclick="this.style.display=\'none\'\">\u274c <b>Ошибка вкладки «Новая логика»</b><br>'+escapeHtml(e.message)+'<br><br><small style="color:#999">(нажмите чтобы закрыть, время: ' + new Date().toLocaleTimeString('ru-RU') + ')</small></div>';
    console.error('renderPageMainNew error:', e);
  }
}
