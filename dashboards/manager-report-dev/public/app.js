var _p = window.location.pathname;
var _m = _p.match(/^\/([^/]+?)(?:\/|$)/);
var BP = _m ? '/' + _m[1] : '';

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v) { return (v === undefined || v === null || v === 0) ? '0' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 }); }
function p(v) { return (v || 0).toFixed(1) + '%'; }
function e(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function bdg(v, lo, hi) { return v >= hi ? 'green' : v <= lo ? 'red' : 'yellow'; }
function sum(arr, k) { return arr.reduce(function(s, x) { return s + (x[k] || 0); }, 0); }
function wavg(arr, k, w) { var nn = 0, d = 0; arr.forEach(function(x) { nn += (x[k] || 0) * (x[w] || 0); d += x[w] || 0; }); return d ? nn / d : 0; }
function card(l, v) { return '<div class="summary-card"><div class="lbl">' + l + '</div><div class="val">' + v + '</div></div>'; }

// ── Load ──────────────────────────────────────────────────────────────────────

var periodLabel = 'Весь 2026 год (YTD)';

function changePeriod() { load(); }

function load() {
  var sel = document.getElementById('periodSelect');
  var val = sel ? sel.value : 'ytd';
  var url = BP + '/api/managers';
  if (val !== 'ytd') {
    var from = val + '-01';
    var to = val + '-30';
    if (['01', '03', '05'].indexOf(val.slice(-2)) >= 0) to = val + '-31';
    if (val.slice(-2) === '02') to = val + '-28';
    url += '?from=' + from + '&to=' + to;
    var months = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    periodLabel = months[parseInt(val.slice(-2))] + ' 2026';
  } else {
    periodLabel = 'Весь 2026 год (YTD)';
  }
  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) { renderApp(d.managers || [], periodLabel); })
    .catch(function(err) {
      document.getElementById('app').innerHTML = '<div class="card" style="color:#c62828;padding:20px"><b>Ошибка загрузки:</b> ' + e(err.message) + '</div>';
    });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderApp(mgrs, label) {
  mgrs = mgrs.filter(function(m) { return m.paid || m.created || m.in_work_start; });

  var tot = {
    paid:      sum(mgrs, 'paid'),
    kval_lost: sum(mgrs, 'kval_lost'),
    nekval_lost: sum(mgrs, 'nekval_lost'),
    created:   sum(mgrs, 'created'),
    post:      sum(mgrs, 'paid_sum'),
    dur:       wavg(mgrs, 'avg_dur', 'paid'),
  };
  tot.conv = (tot.paid + tot.kval_lost + tot.nekval_lost)
    ? tot.paid / (tot.paid + tot.kval_lost + tot.nekval_lost) * 100
    : 0;

  var html = '<h1>🤖 ИИ-РОП: Отчёт по менеджерам</h1>';
  html += '<p class="sub">менеджеров: ' + mgrs.length + ' · <b id="periodLabel">' + label + '</b></p>';

  html += '<div class="period-bar">';
  html += '<select id="periodSelect" onchange="changePeriod()">';
  html += '<option value="ytd"' + (label.includes('YTD') ? ' selected' : '') + '>Весь 2026 год (YTD)</option>';
  var months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  months.forEach(function(m, i) { var mo = String(i + 1).padStart(2, '0'); html += '<option value="2026-' + mo + '">' + m + ' 2026</option>'; });
  html += '</select>';
  html += '</div>';

  html += '<div class="summary-grid">';
  html += card('📦 В работе (нач.)', n(sum(mgrs, 'in_work_start')));
  html += card('➕ Создано', n(tot.created));
  html += card('💰 Поступления', n(tot.post) + ' ₽');
  html += card('⏱ Средний цикл', tot.dur.toFixed(1) + ' дн');
  html += card('📊 Конверсия', tot.conv.toFixed(1) + '%');
  html += card('❌ Квал отказы', n(tot.kval_lost));
  html += card('❌ Не квал', n(tot.nekval_lost));
  html += '</div>';

  html += '<div class="card"><div class="sec-label">📋 Таблица 1: Основные показатели</div>';
  html += '<div class="scroll-x">' + tab1(mgrs) + '</div></div>';

  html += '<div class="card"><div class="sec-label">📊 Таблица 2: Конверсии и отклонения от среднего</div>';
  html += '<div class="scroll-x">' + tab2(mgrs) + '</div></div>';

  html += '<div class="card"><div class="sec-label">📊 Срезы по менеджерам (горизонтальный stacked bar)</div>';
  html += renderBars(mgrs) + '</div>';

  html += '<div class="card"><h2>Воронка <span style="font-size:12px;color:#475569;font-weight:400">(фиксация состояния в периоде с учётом переходящего остатка)</span></h2>';
  html += '<div style="height:600px;position:relative"><canvas id="funnelChart"></canvas></div></div>';

  document.getElementById('app').innerHTML = html;
  loadFunnel();
}

// ── Tables ────────────────────────────────────────────────────────────────────

function tab1(mgrs) {
  var cols = [
    { k: 'name',             l: 'Менеджер' },
    { k: 'in_work_start',    l: '📦 В работе(н)' },
    { k: 'created',          l: '➕ Создано' },
    { k: 'na_kvalifikatsii', l: '🔍 На квал-и' },
    { k: 'mql',              l: '🎯 MQL' },
    { k: 'sql',              l: '📊 SQL' },
    { k: 'invoice_cnt',      l: '📄 Счёт' },
    { k: 'paid',             l: '✅ Оплачено' },
    { k: 'kval_lost',        l: '❌ Квал отказы' },
    { k: 'nekval_lost',      l: '❌ Не квал' },
    { k: 'in_work_end',      l: '🔄 В работе(к)' },
    { k: 'paid_sum',         l: '💰 Пост-я' },
    { k: 'avg_check',        l: '💵 Ср.чек' },
    { k: 'avg_dur',          l: '⏱ Цикл' },
    { k: 'conv_pct',         l: '📊 Конв.%' },
  ];

  var h = '<table class="mgr-table"><thead><tr>';
  cols.forEach(function(c) { h += '<th>' + c.l + '</th>'; });
  h += '</tr></thead><tbody>';

  mgrs.forEach(function(m) {
    h += '<tr>';
    cols.forEach(function(c) {
      if (c.k === 'name') { h += '<td><b>' + e(m.name) + '</b></td>'; return; }
      var v = m[c.k] || 0;
      if (c.k === 'paid_sum') h += '<td><b>' + n(v) + '</b> ₽</td>';
      else if (c.k === 'avg_check') h += '<td>' + n(v) + ' ₽</td>';
      else if (c.k === 'avg_dur') h += '<td>' + (v ? v.toFixed(1) : '-') + '</td>';
      else if (c.k === 'conv_pct') h += '<td><span class="badge badge-' + bdg(v, 30, 60) + '">' + p(v) + '</span></td>';
      else h += '<td>' + n(v) + '</td>';
    });
    h += '</tr>';
  });

  var T = {};
  cols.forEach(function(c) {
    if (c.k === 'name') return;
    if (c.k === 'paid_sum') T[c.k] = sum(mgrs, 'paid_sum');
    else if (c.k === 'avg_check') T[c.k] = Math.round(sum(mgrs, 'paid_sum') / (sum(mgrs, 'paid') || 1));
    else if (c.k === 'avg_dur') T[c.k] = wavg(mgrs, 'avg_dur', 'paid');
    else if (c.k === 'conv_pct') { var pd = sum(mgrs, 'paid'), lo = sum(mgrs, 'kval_lost') + sum(mgrs, 'nekval_lost'); T[c.k] = pd / (pd + lo) * 100; }
    else T[c.k] = sum(mgrs, c.k);
  });

  h += '<tr class="total"><td><b>📊 ИТОГО</b></td>';
  cols.forEach(function(c) {
    if (c.k === 'name') return;
    var v = T[c.k];
    if (c.k === 'paid_sum') h += '<td><b>' + n(v) + '</b> ₽</td>';
    else if (c.k === 'avg_check') h += '<td>' + n(v) + ' ₽</td>';
    else if (c.k === 'avg_dur') h += '<td>' + (v ? v.toFixed(1) : '-') + '</td>';
    else if (c.k === 'conv_pct') h += '<td><span class="badge badge-' + bdg(v, 30, 60) + '">' + p(v) + '</span></td>';
    else h += '<td><b>' + n(v) + '</b></td>';
  });
  h += '</tr></tbody></table>';
  return h;
}

function tab2(mgrs) {
  var allLost = sum(mgrs, 'kval_lost') + sum(mgrs, 'nekval_lost');
  var st = {
    cc:   sum(mgrs, 'created')     ? sum(mgrs, 'mql')         / sum(mgrs, 'created')     * 100 : 0,
    cs:   sum(mgrs, 'mql')         ? sum(mgrs, 'sql')          / sum(mgrs, 'mql')         * 100 : 0,
    ci:   sum(mgrs, 'sql')         ? sum(mgrs, 'invoice_cnt')  / sum(mgrs, 'sql')         * 100 : 0,
    cp:   sum(mgrs, 'invoice_cnt') ? sum(mgrs, 'paid')         / sum(mgrs, 'invoice_cnt') * 100 : 0,
    conv: (sum(mgrs, 'paid') + allLost) ? sum(mgrs, 'paid') / (sum(mgrs, 'paid') + allLost) * 100 : 0,
    dur:  wavg(mgrs, 'avg_dur', 'paid'),
    chk:  sum(mgrs, 'paid') ? sum(mgrs, 'paid_sum') / sum(mgrs, 'paid') : 0,
    sum:  sum(mgrs, 'paid_sum'),
  };

  var cols = [
    { k: 'name',          l: 'Менеджер' },
    { k: 'conv_lead_mql', l: '📊 Создано→MQL', avg: st.cc },
    { k: 'conv_mql_sql',  l: '📊 MQL→SQL',     avg: st.cs },
    { k: 'conv_sql_inv',  l: '📊 SQL→Счёт',    avg: st.ci },
    { k: 'conv_inv_paid', l: '📊 Счёт→Оплата', avg: st.cp },
    { k: 'conv_pct',      l: '📊 Конв.%',      avg: st.conv },
    { k: 'avg_dur',       l: '⏱ Цикл',         avg: st.dur,  rev: true },
    { k: 'avg_check',     l: '💵 Ср.чек',       avg: st.chk },
    { k: 'paid_sum',      l: '💰 Пост-я',       avg: st.sum },
  ];

  function fmtCell(k, v) {
    if (k === 'paid_sum')  return '<b>' + n(v) + '</b> ₽';
    if (k === 'avg_check') return n(v) + ' ₽';
    if (k === 'avg_dur')   return v ? v.toFixed(1) : '-';
    if (k.startsWith('conv')) return p(v);
    return n(v);
  }

  var stMap = { conv_lead_mql: 'cc', conv_mql_sql: 'cs', conv_sql_inv: 'ci', conv_inv_paid: 'cp' };

  var h = '<table class="mgr-table"><thead><tr>';
  cols.forEach(function(c) { h += '<th style="font-size:9px">' + c.l + '</th>'; });
  h += '</tr></thead><tbody>';

  mgrs.forEach(function(m) {
    h += '<tr>';
    cols.forEach(function(c) {
      if (c.k === 'name') { h += '<td><b>' + e(m.name) + '</b></td>'; return; }
      var v = m[c.k] || 0;
      var diff = c.avg ? (v - c.avg) / c.avg * 100 : 0;
      var cls = 'yellow';
      if (Math.abs(diff) > 10) cls = c.rev ? (v < c.avg ? 'green' : 'red') : (v > c.avg ? 'green' : 'red');
      h += '<td class="' + cls + '">' + fmtCell(c.k, v) + '</td>';
    });
    h += '</tr>';
  });

  h += '<tr class="total"><td><b>📊 СРЕДНЕЕ</b></td>';
  cols.forEach(function(c) {
    if (c.k === 'name') return;
    var key = stMap[c.k] || c.k;
    h += '<td><b>' + fmtCell(c.k, st[key] !== undefined ? st[key] : st[c.k]) + '</b></td>';
  });
  h += '</tr></tbody></table>';
  return h;
}

// ── Horizontal bars ───────────────────────────────────────────────────────────

function renderBars(mgrs) {
  var slices = [
    { title: 'B2B vs B2C', items: [
      { k: 'b2b_sum', label: 'B2B', color: '#1f2a44' },
      { k: 'b2c_sum', label: 'B2C', color: '#00bcd4' },
    ]},
    { title: 'Источники (внутренняя база vs маркетинг)', items: [
      { k: 'src_int_sum', label: 'Внутренняя база', color: '#2e7d32' },
      { k: 'src_mkt_sum', label: 'Маркетинг',       color: '#ff9800' },
    ]},
    { title: 'Форматы обучения', items: [
      { k: 'fmt_oom_sum', label: 'ООМ (Очное)', color: '#1565c0' },
      { k: 'fmt_om_sum',  label: 'ОМ (Онлайн)', color: '#7b1fa2' },
      { k: 'fmt_sdo_sum', label: 'СДО',          color: '#e65100' },
    ]},
  ];

  var h = '';
  slices.forEach(function(sl) {
    h += '<div style="margin-bottom:24px">';
    h += '<h3 style="font-size:13px;margin-bottom:8px;color:#1f2a44">' + sl.title + '</h3>';
    mgrs.forEach(function(m) {
      var total = 0;
      sl.items.forEach(function(it) { total += m[it.k] || 0; });
      if (total === 0) return;
      h += '<div style="display:flex;align-items:center;margin:3px 0;gap:8px">';
      h += '<span style="min-width:150px;font-size:11px;font-weight:600;text-align:right;flex-shrink:0">' + e(m.name) + '</span>';
      h += '<div style="flex:1;height:20px;background:#e2e8f0;border-radius:4px;overflow:hidden;display:flex">';
      sl.items.forEach(function(it) {
        var val = m[it.k] || 0;
        var pct = val / total * 100;
        if (pct < 2) return;
        h += '<div style="width:' + pct.toFixed(1) + '%;height:100%;background:' + it.color + '" title="' + it.label + ': ' + n(val) + ' руб (' + pct.toFixed(1) + '%)"></div>';
      });
      h += '</div>';
      h += '<span style="font-size:10px;color:#888;min-width:50px;flex-shrink:0;text-align:right">' + n(total) + ' руб</span>';
      h += '</div>';
    });
    h += '</div>';
  });
  return h;
}

// ── Funnel chart ──────────────────────────────────────────────────────────────

function loadFunnel() {
  var canvas = document.getElementById('funnelChart');
  if (!canvas || !window.Chart) return;
  fetch(BP + '/api/funnel')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var weeks = d.weeks || [];
      if (!weeks.length) return;
      var labels = weeks.map(function(w) { return w.label_dates || ('Нед.' + String(w.week).padStart(2, '0')); });
      new Chart(canvas, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Отказы неКвал', data: weeks.map(function(w) { return w.stack_rej_nq || 0; }), backgroundColor: '#880E4F', borderRadius: 4 },
            { label: 'Отказы',        data: weeks.map(function(w) { return w.stack_rej    || 0; }), backgroundColor: '#E53935', borderRadius: 4 },
            { label: 'Не квал',       data: weeks.map(function(w) { return w.stack_nq     || 0; }), backgroundColor: '#FFD54F', borderRadius: 4 },
            { label: 'MQL',           data: weeks.map(function(w) { return w.stack_mql    || 0; }), backgroundColor: '#42A5F5', borderRadius: 4 },
            { label: 'SQL',           data: weeks.map(function(w) { return w.stack_sql    || 0; }), backgroundColor: '#1A237E', borderRadius: 4 },
            { label: 'Счёт',          data: weeks.map(function(w) { return w.stack_inv    || 0; }), backgroundColor: '#7E57C2', borderRadius: 4 },
            { label: 'Оплата',        data: weeks.map(function(w) { return w.stack_pay    || 0; }), backgroundColor: '#43A047', borderRadius: 4 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { font: { size: 10 } } }, datalabels: { display: false } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        },
      });
    })
    .catch(function() {});
}

// ── Boot ──────────────────────────────────────────────────────────────────────

load();
