/**
 * app-unused.js — код, который СЕЙЧАС НЕ ВЫЗЫВАЕТСЯ в дашборде «Рейтинги».
 *
 * ⚠ Ни одна из функций ниже не вызывается, а целевых DOM-узлов нет в index.html
 *   (остатки после копирования управленческого дашборда). Вынесено отдельно, чтобы
 *   не мешать живому коду. Кандидат на удаление — уточнить и убрать при случае:
 *     loadArtifacts  → #newArtifactsBlock (нет в разметке; /api/artifacts admin-only)
 *     renderWeekRow  → нигде не вызывается
 *     drawCharts     → canvas ch_funnel/ch_pos/… отсутствуют в разметке
 *   Если решим оставить и подключить — вернуть <script> в index.html и Chart.js CDN.
 */

// ── Блок аномалий данных (/api/artifacts) ────────────────────────────────
function loadArtifacts(){
  fetch(window.BASE_PATH+'/api/artifacts').then(function(r){return r.json();}).then(function(d){
    var el=document.getElementById('newArtifactsBlock');
    if(!el)return;
    var s=d&&d.summary;
    if(!s||(!s.returns.cnt&&!s.inProgressPaid.cnt&&!s.wonNoPay.cnt&&!s.negativeDuration.cnt&&!s.otherCatPaid.cnt&&!s.nextYear.cnt)){
      el.innerHTML='<div style="padding:8px;color:#888;font-size:12px">Аномалий не обнаружено</div>';return;
    }
    var h='<div style="font-size:12px;background:#fff8e1;border-radius:8px;padding:12px;margin:8px 0">';
    h+='<b>⚠ Аномалии данных</b><table style="width:100%;margin-top:8px;font-size:12px;border-collapse:collapse">';
    if(s.returns.cnt) h+='<tr><td>🔙 Возвраты (LOSE+PAY)</td><td style="text-align:right">'+s.returns.cnt+' шт.</td><td style="text-align:right;color:#C62828">'+fmt(s.returns.sum)+' ₽</td></tr>';
    if(s.inProgressPaid.cnt) h+='<tr><td>📌 В работе + оплата</td><td style="text-align:right">'+s.inProgressPaid.cnt+' шт.</td><td style="text-align:right;color:#E65100">'+fmt(s.inProgressPaid.sum)+' ₽</td></tr>';
    if(s.wonNoPay.cnt) h+='<tr><td>✅ WON без даты оплаты</td><td style="text-align:right">'+s.wonNoPay.cnt+' шт.</td><td style="text-align:right;color:#1565C0">'+fmt(s.wonNoPay.sum)+' ₽</td></tr>';
    if(s.negativeDuration.cnt) h+='<tr><td>⏪ Оплата раньше создания</td><td style="text-align:right">'+s.negativeDuration.cnt+' шт.</td><td style="text-align:right;color:#6A1B9A">'+fmt(s.negativeDuration.sum)+' ₽</td></tr>';
    if(s.otherCatPaid.cnt) h+='<tr><td>📂 Др.категории с оплатой</td><td style="text-align:right">'+s.otherCatPaid.cnt+' шт.</td><td style="text-align:right">'+fmt(s.otherCatPaid.sum)+' ₽</td></tr>';
    if(s.nextYear.cnt) h+='<tr><td>📅 «Следующий год»</td><td style="text-align:right">'+s.nextYear.cnt+' шт.</td><td style="text-align:right">0 ₽</td></tr>';
    h+='</table></div>';
    el.innerHTML=h;
  }).catch(function(){});
}

// ── Chart.js guard: защита от падения, если CDN с Chart.js не загрузился ──
if (typeof Chart !== 'undefined' && Chart.register && typeof ChartDataLabels !== 'undefined') {
  try { Chart.register(ChartDataLabels); } catch(e) {}
}

let chartInstances = {};

function renderWeekRow(w, isCurrent) {
  return `<tr${isCurrent ? " class='cur'" : ''}>
    <td><b>Неделя ${String(w.week).padStart(2, '0')} (${w.label_dates || ''})</b></td>
    <td>${w.leads}</td>
    <td>${w.mql}</td>
    <td>${w.sql}</td>
    <td><b>${w.invoice_cnt || 0}</b></td>
    <td><b>${w.oplata}</b></td>
    <td><b>${fmt(w.postupleniya)}</b></td>
    <td>${fmt(w.avg_check)}</td>
    <td>${(w.avg_dur || 0).toFixed(1)}</td>
    <td>${(w.conv_lead_mql || 0).toFixed(1)}%</td>
    <td>${(w.conv_mql_sql || 0).toFixed(1)}%</td>
    <td>${(w.conv_sql_invoice || 0).toFixed(1)}%</td>
    <td>${(w.conv_invoice_oplata || 0).toFixed(1)}%</td>
  </tr>`;
}

// ===== Charts =====
function drawCharts(data) {
  const weeks = data.weeks || [];
  const labels = weeks.map(w => w.label_dates || w.label_short || 'W'+String(w.week).padStart(2,'0'));
  const Lfull = weeks.map(w => w.label);

  Object.keys(chartInstances).forEach(id => {
    if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
  });

  const common = { responsive: true, maintainAspectRatio: false };
  const commonPlugin = { tooltip: { callbacks: { title: items => Lfull[items[0].dataIndex] } } };
  const navy = '#1f2a44', gold = '#C8A45C', red = '#C62828', green = '#2E7D32', orange = '#F57C00', blue = '#1976D2';

  const mql = weeks.map(w => w.mql);
  const sql = weeks.map(w => w.sql);
  const opl = weeks.map(w => w.oplata);
  const pos = weeks.map(w => w.postupleniya);
  const cms = weeks.map(w => w.conv_mql_sql);
  const cso = weeks.map(w => w.conv_sql_oplata);
  const won_n = weeks.map(w => w.won_cnt);
  const lost_n = weeks.map(w => w.lost_cnt);
  const avg = weeks.map(w => w.avg_check);
  const dur = weeks.map(w => w.avg_dur);
  const presale = weeks.map(w => w.avg_presale_dur);

  // Funnel
  chartInstances.ch_funnel = new Chart(document.getElementById('ch_funnel'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'MQL', data: mql, backgroundColor: blue, borderRadius: 4 },
      { label: 'SQL', data: sql, backgroundColor: gold, borderRadius: 4 },
      { label: 'Сделки', data: opl, backgroundColor: green, borderRadius: 4 }
    ]},
    options: { ...common, plugins: { ...commonPlugin, legend: { position: 'top' }, datalabels: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  // Conversion
  chartInstances.ch_conv = new Chart(document.getElementById('ch_conv'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'MQL→SQL, %', data: cms, borderColor: blue, backgroundColor: 'rgba(25,118,210,.1)', tension: 0.3, fill: true },
      { label: 'SQL→Сделки, %', data: cso, borderColor: green, backgroundColor: 'rgba(46,125,50,.1)', tension: 0.3, fill: true }
    ]},
    options: { ...common, plugins: { ...commonPlugin, legend: { position: 'top' }, datalabels: { display: false } }, scales: { y: { beginAtZero: true, max: 180 } } }
  });

  // Funnel (qual)
  chartInstances.ch_funnel_qual = new Chart(document.getElementById('ch_funnel_qual'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'MQL (квал)', data: mql, backgroundColor: blue, borderRadius: 4 },
      { label: 'SQL', data: sql, backgroundColor: gold, borderRadius: 4 },
      { label: 'Сделки', data: opl, backgroundColor: green, borderRadius: 4 }
    ]},
    options: { ...common, plugins: { ...commonPlugin, legend: { position: 'top' }, datalabels: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  // Conversion (qual)
  chartInstances.ch_conv_qual = new Chart(document.getElementById('ch_conv_qual'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'MQL→SQL, %', data: cms, borderColor: '#1976D2', backgroundColor: 'rgba(25,118,210,.1)', tension: 0.3, fill: true },
      { label: 'SQL→Сделки, %', data: cso, borderColor: '#2E7D32', backgroundColor: 'rgba(46,125,50,.1)', tension: 0.3, fill: true }
    ]},
    options: { ...common, plugins: { ...commonPlugin, legend: { position: 'top' }, datalabels: { display: false } }, scales: { y: { beginAtZero: true, max: 180 } } }
  });

  // Won sum
  chartInstances.ch_pos = new Chart(document.getElementById('ch_pos'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Поступления, ₽', data: pos, backgroundColor: navy, borderRadius: 4 }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => Lfull[items[0].dataIndex], label: c => Number(c.parsed.y).toLocaleString('ru-RU') + ' ₽' } }, datalabels: { anchor: 'end', align: 'end', color: navy, font: { size: 8, weight: 'bold' }, formatter: v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? Math.round(v/1000)+'k' : v } }, scales: { y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString('ru-RU') } } } },
    plugins: [ChartDataLabels]
  });

  // B2B doughnut
  const b2bData = data.btype_ytd || {};
  const b2bSum = (b2bData.B2B?.sum || 0) + (b2bData.B2C?.sum || 0);
  chartInstances.ch_b2b = new Chart(document.getElementById('ch_b2b'), {
    type: 'doughnut',
    data: { labels: ['B2B', 'B2C'], datasets: [{ data: [b2bData.B2B?.sum || 0, b2bData.B2C?.sum || 0], backgroundColor: [blue, orange] }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.label + ': ' + Number(c.parsed).toLocaleString('ru-RU') + ' ₽ (доля: ' + (c.parsed/b2bSum*100).toFixed(1) + '%)' } } } },
    plugins: [ChartDataLabels]
  });

  // WON vs LOSE doughnut
  const wonTotal = won_n.reduce((a, b) => a + b, 0);
  const lostTotal = lost_n.reduce((a, b) => a + b, 0);
  chartInstances.ch_wl = new Chart(document.getElementById('ch_wl'), {
    type: 'doughnut',
    data: { labels: ['WON', 'LOSE'], datasets: [{ data: [wonTotal, lostTotal], backgroundColor: [green, red] }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.label + ': ' + Number(c.parsed).toLocaleString('ru-RU') + ' (доля: ' + (c.parsed/(wonTotal+lostTotal)*100).toFixed(1) + '%)' } } } },
    plugins: [ChartDataLabels]
  });

  // Formats stacked bar (weekly)
  const fmtColorsArr = { "ОМ (Онлайн)": "#43A047", "ООМ (Очное)": "#1976D2", "СДО": "#F57C00", "КОМ": "#C62828" };
  const fmtKeys = ["ООМ (Очное)", "СДО", "ОМ (Онлайн)", "КОМ"];
  const fmt_week = {
    "ООМ (Очное)": weeks.map(w => w.fmt_oom || 0),
    "СДО":         weeks.map(w => w.fmt_sdo || 0),
    "ОМ (Онлайн)": weeks.map(w => w.fmt_om || 0),
    "КОМ":         weeks.map(w => w.fmt_kom || 0),
  };
  chartInstances.ch_fmt = new Chart(document.getElementById('ch_fmt'), {
    type: 'bar',
    data: { labels, datasets: fmtKeys.map(k => ({
      label: k,
      data: fmt_week[k],
      backgroundColor: fmtColorsArr[k] || '#999',
      borderRadius: 2
    })) },
    options: { ...common, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { title: items => Lfull[items[0].dataIndex], label: c => c.dataset.label + ': ' + Number(c.parsed.y).toLocaleString('ru-RU') + ' ₽' } }, datalabels: { display: false } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString('ru-RU') } } } },
    plugins: [ChartDataLabels]
  });

  // Won vs Lose
  chartInstances.ch_cnt = new Chart(document.getElementById('ch_cnt'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Выиграно', data: won_n, backgroundColor: green, borderRadius: 4 },
      { label: 'Проиграно', data: lost_n, backgroundColor: red, borderRadius: 4 }
    ]},
    options: { ...common, plugins: { ...commonPlugin, legend: { position: 'top' }, datalabels: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  // Avg check
  chartInstances.ch_avg = new Chart(document.getElementById('ch_avg'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Сред.чек, ₽', data: avg, borderColor: gold, backgroundColor: 'rgba(200,164,92,.15)', tension: 0.3, fill: true, pointRadius: 3 }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => Lfull[items[0].dataIndex], label: c => Number(c.parsed.y).toLocaleString('ru-RU') + ' ₽' } }, datalabels: { anchor: 'end', align: 'end', color: gold, font: { size: 8 }, formatter: v => v >= 1000 ? Math.round(v/1000) + 'k' : v } }, scales: { y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString('ru-RU') } } } },
    plugins: [ChartDataLabels]
  });

  // Duration
  chartInstances.ch_dur = new Chart(document.getElementById('ch_dur'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Сред.срок WON, дн.', data: dur, borderColor: navy, backgroundColor: 'rgba(31,42,68,.15)', tension: 0.3, fill: true, pointRadius: 3 }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: commonPlugin.tooltip, datalabels: { anchor: 'end', align: 'end', color: navy, font: { size: 8 }, formatter: v => v.toFixed(0) + 'дн' } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' дн.' } } } },
    plugins: [ChartDataLabels]
  });

  // Pre sale duration
  chartInstances.ch_presale = new Chart(document.getElementById('ch_presale'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Pre Sale, дн.', data: presale, borderColor: blue, backgroundColor: 'rgba(25,118,210,.15)', tension: 0.3, fill: true, pointRadius: 3 }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: commonPlugin.tooltip, datalabels: { anchor: 'end', align: 'end', color: blue, font: { size: 8 }, formatter: v => v.toFixed(0) + 'дн' } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' дн.' } } } },
    plugins: [ChartDataLabels]
  });
}
