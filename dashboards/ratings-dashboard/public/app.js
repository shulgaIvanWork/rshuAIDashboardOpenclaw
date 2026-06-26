// ========== Helper functions ==========
function escapeHtml(t){return String(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
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


// Автоопределение пути — работает и самостоятельным сайтом, и как sub-app
var _p = window.location.pathname;
var _m = _p.match(/^\/([^/]+?)(?:\/|$)/);
window.BASE_PATH = _m ? '/' + _m[1] : '';

var refreshStepsData = [
  { key: 'fetch_data',   label: 'Загрузка данных',         weight: 50 },
  { key: 'analyze',      label: 'Анализ данных',           weight: 50 },
];

var statusPanelHTML = '' +
  '<div id="refreshStatusPanel" class="refresh-panel" style="display:none">' +
    '<div class="refresh-header">' +
      '<span class="refresh-title">🔄 Обновление данных</span>' +
      '<span class="refresh-elapsed" id="statusElapsed">⏱ 0м 0с</span>' +
    '</div>' +
    '<div class="progress-bar refresh-progress-bar">' +
      '<div class="progress-fill" id="statusProgressFill" style="width:0%"></div>' +
    '</div>' +
    '<div id="statusSteps" class="refresh-steps"></div>' +
    '<div id="statusDealProgress" class="refresh-deal-progress"></div>' +
  '</div>';

function renderStepLines(curIdx, steps, progressPct) {
  var h = '';
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var icon, cls, label;
    if (i < curIdx) { icon = '\u2705'; cls = 'step-done'; label = s.label; }
    else if (i === curIdx) { icon = '\u23f3'; cls = 'step-active'; label = s.label + ' <span class="step-weight">(' + s.weight + '%)</span>'; }
    else { icon = '\u2b1c'; cls = 'step-pending'; label = s.label + ' <span class="step-weight">(' + s.weight + '%)</span>'; }
    h += '<div class="refresh-step ' + cls + '">' +
      '<span class="step-icon">' + icon + '</span>' +
      '<span class="step-label">' + label + '</span>' +
    '</div>';
  }
  return h;
}

async function safeFetch(url, opts) {
  var resp = await fetch(url, opts);
  if (resp.redirected || resp.url.endsWith('/login')) { window.location.href = '/login'; throw new Error('redirect'); }
  var text = await resp.text();
  if (text.startsWith('<!DOCTYPE')) { window.location.href = '/login'; throw new Error('redirect'); }
  return JSON.parse(text);
}

// ========== Chart.js guard ==========
// Защита от падения, если CDN с Chart.js не загрузился
if (typeof Chart !== 'undefined' && Chart.register && typeof ChartDataLabels !== 'undefined') {
  try { Chart.register(ChartDataLabels); } catch(e) {}
}

let chartInstances = {};
let dataCache = null;
let dateFromCache = null;
let dateToCache = null;
let userRole = 'guest';

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

async function api(path) {
  var url = (typeof window.BASE_PATH !== 'undefined' ? (window.BASE_PATH || '') : '') + path;
  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 30000); // 30s timeout
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

async function loadAll() {
  // Fetch user role first
  try {
    var u = await safeFetch((window.BASE_PATH || '') + '/api/user');
    if (u && u.role) userRole = u.role;
  } catch(e) {}

  // Create refresh button only for admins
  var container = document.getElementById('refreshBtnContainer');
  if (container) {
    if (userRole === 'admin') {
      var btn = document.createElement('button');
      btn.id = 'refreshBtn';
      btn.textContent = '🔄 Обновить данные';
      btn.addEventListener('click', refreshButtonHandler);
      container.appendChild(btn);
    }
  }

  var areaNew = document.getElementById('contentAreaNew');
  if (!areaNew) return;
  try {
    const d = await api('/api/data/new');
    if (!d || !d.ytd) return;
    document.getElementById('loadingFill').style.width = '100%';
    dataCache = d;
    
    // Устанавливаем dateFrom/dateTo по умолчанию: с 01.01.2026 до today
    var dateFromDefault = '2026-01-01';
    document.getElementById('dateFrom').value = dateFromDefault;
    var todayStr = new Date().toISOString().substring(0, 10);
    document.getElementById('dateTo').value = todayStr;
    dateFromCache = document.getElementById('dateFrom').value;
    dateToCache = document.getElementById('dateTo').value;
    
    renderFilteredData();
    
    document.getElementById('sourceInfo').textContent =
      `Битрикс24 · актуально на ${d.today} · всего недель: ${(d.weeks||[]).length}, обновлено: ${new Date().toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
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

function buildFilteredData(orig, filteredWeeks) {
  var out = JSON.parse(JSON.stringify(orig));
  out.weeks = filteredWeeks;
  
  function sumField(f) {
    return filteredWeeks.reduce(function(s, w) { return s + (w[f] || 0); }, 0);
  }
  
  // Общий YTD
  var ytd = { postupleniya: sumField('postupleniya'), won_relevant_cnt: sumField('oplata') };
  // Копируем все остальные поля из оригинала
  var srcYtd = orig.ytd || {};
  for (var k in srcYtd) {
    if (ytd[k] === undefined) ytd[k] = srcYtd[k];
  }
  ytd.avg_check = ytd.won_relevant_cnt > 0 ? Math.round(ytd.postupleniya / ytd.won_relevant_cnt) : srcYtd.avg_check || 0;
  out.ytd = ytd;
  
  // ООМ YTD — берём из оригинала, переписываем только посчитанные поля
  var oom_ytd = JSON.parse(JSON.stringify(orig.oom_ytd || {}));
  oom_ytd.postupleniya = sumField('postupleniya');
  oom_ytd.won_relevant_cnt = sumField('oplata');
  oom_ytd.avg_check = oom_ytd.won_relevant_cnt > 0 ? Math.round(oom_ytd.postupleniya / oom_ytd.won_relevant_cnt) : oom_ytd.avg_check || 0;
  out.oom_ytd = oom_ytd;
  
  // КОМ YTD — берём из оригинала, переписываем только посчитанные поля
  var kom_ytd = JSON.parse(JSON.stringify(orig.kom_ytd || {}));
  kom_ytd.postupleniya = sumField('kom_postupleniya');
  kom_ytd.won_relevant_cnt = sumField('kom_won_cnt');
  kom_ytd.avg_check = kom_ytd.won_relevant_cnt > 0 ? Math.round(kom_ytd.postupleniya / kom_ytd.won_relevant_cnt) : kom_ytd.avg_check || 0;
  out.kom_ytd = kom_ytd;
  
  // cur = последняя неделя, prev = предпоследняя
  var last = filteredWeeks[filteredWeeks.length - 1] || {};
  var prev = filteredWeeks[filteredWeeks.length - 2] || {};
  out.cur = { postupleniya: last.postupleniya || 0, won_relevant_cnt: last.oplata || 0 };
  out.prev = { postupleniya: prev.postupleniya || 0, won_relevant_cnt: prev.oplata || 0 };
  out.oom_cur = { postupleniya: last.postupleniya || 0, won_relevant_cnt: last.oplata || 0 };
  out.oom_prev = { postupleniya: prev.postupleniya || 0, won_relevant_cnt: prev.oplata || 0 };
  out.kom_cur = { postupleniya: last.kom_postupleniya || 0, won_relevant_cnt: last.kom_won_cnt || 0 };
  out.kom_prev = { postupleniya: prev.kom_postupleniya || 0, won_relevant_cnt: prev.kom_won_cnt || 0 };
  out.cur_week = last.week || orig.cur_week;
  out.prev_week = prev.week || orig.prev_week;
  
  // Лиды
  out.leads_ytd = sumField('leads');
  out.leads_cur = last.leads || 0;
  out.leads_prev = prev.leads || 0;
  out.oom_leads_ytd = sumField('leads');
  out.kom_leads_ytd = orig.kom_leads_ytd || sumField("kom_won_cnt");
  
  // Форматы — из отфильтрованных недель
  var fmt_ytd = {};
  filteredWeeks.forEach(function(w) {
    ['fmt_oom','fmt_om','fmt_sdo','fmt_kom'].forEach(function(f) {
      if (!fmt_ytd[f]) fmt_ytd[f] = { cnt: 0, sum: 0 };
      fmt_ytd[f].sum += w[f] || 0;
    });
  });
  out.fmt_ytd = fmt_ytd;
  
  return out;
}

function fmt(n) {
  if (n === undefined || n === null || n === 0) return '0';
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function fmtPct(n) {
  if (n === undefined || n === null) return '0.0';
  return Number(n).toFixed(1);
}

function renderPage(data) {
  const area = document.getElementById('contentArea');
  const ytd = data.ytd;
  const prev = data.prev;
  const cur = data.cur;
  const kom = data.kom_ytd;
  const kom_prev = data.kom_prev;
  const kom_cur = data.kom_cur;
  const weeks = data.weeks || [];
  const last = weeks[weeks.length - 1] || {};
  const prevWeek = weeks[weeks.length - 2] || {};
  const pw = data.prev_week;
  const cw = data.cur_week;

  const delta = prevWeek.postupleniya ? ((last.postupleniya - prevWeek.postupleniya) / prevWeek.postupleniya * 100) : 0;

  // B2B/B2C table
  const b2b = data.btype_ytd?.B2B || { cnt: 0, sum: 0 };
  const b2c = data.btype_ytd?.B2C || { cnt: 0, sum: 0 };
  const b2b_prev = data.btype_prev?.B2B || { cnt: 0, sum: 0 };
  const b2c_prev = data.btype_prev?.B2C || { cnt: 0, sum: 0 };
  const totB2b = b2b.sum + b2c.sum || 1;
  const b2b_cur = data.btype_cur?.B2B || { cnt: 0, sum: 0 };
  const b2c_cur = data.btype_cur?.B2C || { cnt: 0, sum: 0 };
  const totCur = b2b_cur.sum + b2c_cur.sum || 1;

  function b2bRow(period, b, c, tot) {
    return `<tr><td>${period}</td>
      <td><span class="dot" style="background:#1976D2"></span>B2B</td>
      <td>${b.cnt}</td><td><b>${fmt(b.sum)}</b> ₽</td><td>${(b.sum/tot*100).toFixed(1)}%</td></tr>
      <tr><td></td>
      <td><span class="dot" style="background:#F57C00"></span>B2C</td>
      <td>${c.cnt}</td><td><b>${fmt(c.sum)}</b> ₽</td><td>${(c.sum/tot*100).toFixed(1)}%</td></tr>`;
  }

  // Formats table
  const fmtData = Object.entries(data.fmt_ytd || {}).filter(([k]) => k !== 'period').sort((a,b) => b[1].sum - a[1].sum);
  const totFmt = fmtData.reduce((s, [,v]) => s + v.sum, 0) || 1;
  const fmtColors = { "ОМ (Онлайн)": "#43A047", "ООМ (Очное)": "#1976D2", "СДО": "#F57C00", "КОМ": "#C62828" };

  // Sources (with full analytics)
  const srcTop = data.src_rating || [];

  // КОМ table
  function komRow(label, a, b, c, money=true, suf='') {
    function f(v) {
      if (money) return fmt(v) + ' ₽';
      if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(1) + suf;
      return fmt(v) + suf;
    }
    return `<tr><td>${label}</td><td>${f(a)}</td><td>${f(b)}</td><td>${f(c)}</td></tr>`;
  }

  area.innerHTML = `
    <div id="kpiContainer">
      <!-- ========== Ряд 1: ОБЩАЯ (ООМ + КОМ) ========== -->
      <div style="margin:0 0 4px"><span style="font-size:15px;font-weight:700;color:#1f2a44">ОБЩАЯ (ООМ + КОМ)</span> <span style="font-size:11px;color:#888">· ${data.cur_week_label}</span></div>
      <div class="kpis">
        <div class="kpi"><div class="lbl">📊 Поступления YTD</div><div class="val">${fmt(ytd.postupleniya)} ₽</div><div class="sub">${ytd.won_relevant_cnt} сделок</div></div>
        <div class="kpi"><div class="lbl">📋 Лиды YTD</div><div class="val">${fmt(data.leads_ytd)}</div><div class="sub" style="line-height:1.5">квал. лиды (MQL) <b>${fmt(data.qual_lead_ytd)}</b> · конв. ${data.qual_lead_ytd && data.leads_ytd ? (data.qual_lead_ytd/data.leads_ytd*100).toFixed(1) : 0}%</div></div>
        <div class="kpi"><div class="lbl">📈 Конверсия YTD</div><div class="val">${ytd.conv_deal_pct.toFixed(1)}%</div><div class="sub">WON / (WON+LOSE)</div></div>
        <div class="kpi"><div class="lbl">💰 Средний чек YTD</div><div class="val">${fmt(ytd.avg_check)} ₽</div><div class="sub">медиана ${fmt(ytd.median_check)} ₽</div></div>
        <div class="kpi"><div class="lbl">⏱ Срок WON, дн.</div><div class="val">${ytd.avg_close_days_won.toFixed(1)}</div><div class="sub">ср.взв. ${(ytd.avg_close_days_won_weighted || ytd.avg_close_days_won).toFixed(1)} · мед. ${ytd.median_close_days_won} дн.</div></div>
        <div class="kpi"><div class="lbl">📈 W${cw}: поступления</div><div class="val">${fmt(cur.postupleniya)} ₽</div><div class="sub">${cur.won_relevant_cnt} сд.</div></div>
        <div class="kpi"><div class="lbl">🎯 W${cw}: лиды</div><div class="val">${fmt(data.leads_cur)}</div><div class="sub">${data.leads_prev > 0 ? ((data.leads_cur - data.leads_prev) > 0 ? '🟩' : (data.leads_cur - data.leads_prev) < 0 ? '🔻' : '') + ' ' + ((data.leads_cur - data.leads_prev) / data.leads_prev * 100).toFixed(1) + '% к прошл.' : ''}</div></div>
      </div>

      <!-- ========== Ряд 2: ООМ ========== -->
      <div style="margin:12px 0 4px"><span style="font-size:15px;font-weight:700;color:#00bcd4">ООМ (Открытое обучение)</span> <span style="font-size:11px;color:#888">· ${data.cur_week_label}</span></div>
      <div class="kpis">
        <div class="kpi oom"><div class="lbl">📊 Поступления YTD</div><div class="val">${fmt(oom_ytd.postupleniya)} ₽</div><div class="sub">${oom_ytd.won_relevant_cnt} сделок</div></div>
        <div class="kpi oom"><div class="lbl">📋 Лиды YTD</div><div class="val">${fmt(data.oom_leads_ytd)}</div><div class="sub" style="line-height:1.5">квал. лиды (MQL) <b>${fmt(data.oom_qual_lead_ytd)}</b> · конв. ${data.oom_qual_lead_ytd && data.oom_leads_ytd ? (data.oom_qual_lead_ytd/data.oom_leads_ytd*100).toFixed(1) : 0}%</div></div>
        <div class="kpi oom"><div class="lbl">📈 Конверсия YTD</div><div class="val">${oom_ytd.conv_deal_pct.toFixed(1)}%</div><div class="sub">WON / (WON+LOSE)</div></div>
        <div class="kpi oom"><div class="lbl">💰 Средний чек YTD</div><div class="val">${fmt(oom_ytd.avg_check)} ₽</div><div class="sub">медиана ${fmt(oom_ytd.median_check)} ₽</div></div>
        <div class="kpi oom"><div class="lbl">⏱ Срок WON, дн.</div><div class="val">${oom_ytd.avg_close_days_won.toFixed(1)}</div><div class="sub">ср.взв. ${(oom_ytd.avg_close_days_won_weighted || oom_ytd.avg_close_days_won).toFixed(1)} · мед. ${oom_ytd.median_close_days_won} дн.</div></div>
        <div class="kpi oom"><div class="lbl">📈 W${cw}: поступления</div><div class="val">${fmt(oom_cur.postupleniya)} ₽</div><div class="sub">${oom_cur.won_relevant_cnt} сд.</div></div>
        <div class="kpi oom"><div class="lbl">🎯 W${cw}: лиды</div><div class="val">${fmt(data.oom_leads_cur)}</div><div class="sub">${data.oom_leads_prev > 0 ? ((data.oom_leads_cur - data.oom_leads_prev) > 0 ? '🟩' : (data.oom_leads_cur - data.oom_leads_prev) < 0 ? '🔻' : '') + ' ' + ((data.oom_leads_cur - data.oom_leads_prev) / data.oom_leads_prev * 100).toFixed(1) + '% к прошл.' : ''}</div></div>
      </div>

      <!-- ========== Ряд 3: КОМ ========== -->
      <div style="margin:12px 0 4px"><span style="font-size:15px;font-weight:700;color:#9C27B0">КОМ (Корпоративное обучение)</span> <span style="font-size:11px;color:#888">· ${data.cur_week_label}</span></div>
      <div class="kpis">
        <div class="kpi kom"><div class="lbl">📊 Поступления YTD</div><div class="val">${fmt(kom.postupleniya)} ₽</div><div class="sub">${kom.won_relevant_cnt} сделок</div></div>
        <div class="kpi kom"><div class="lbl">📋 Лиды YTD</div><div class="val">${fmt(data.kom_leads_ytd)}</div><div class="sub" style="line-height:1.5">квал. лиды (MQL) <b>${fmt(data.kom_qual_lead_ytd)}</b></div></div>
        <div class="kpi kom"><div class="lbl">📈 Конверсия YTD</div><div class="val">${kom.conv_deal_pct.toFixed(1)}%</div><div class="sub">WON / (WON+LOSE)</div></div>
        <div class="kpi kom"><div class="lbl">💰 Средний чек YTD</div><div class="val">${fmt(kom.avg_check)} ₽</div><div class="sub">макс ${fmt(kom.max_check)} ₽</div></div>
        <div class="kpi kom"><div class="lbl">⏱ Срок WON, дн.</div><div class="val">${kom.avg_close_days_won.toFixed(1)}</div><div class="sub">медиана ${kom.median_close_days_won} дн.</div></div>
        <div class="kpi kom"><div class="lbl">📈 W${cw}: поступления</div><div class="val">${fmt(kom_cur.postupleniya)} ₽</div><div class="sub">${kom_cur.won_relevant_cnt} сд.</div></div>
        <div class="kpi kom"><div class="lbl">🎯 W${cw}: лиды</div><div class="val">${fmt(data.kom_leads_cur)}</div><div class="sub">${data.kom_leads_prev > 0 ? ((data.kom_leads_cur - data.kom_leads_prev) > 0 ? '🟩' : (data.kom_leads_cur - data.kom_leads_prev) < 0 ? '🔻' : '') + ' ' + ((data.kom_leads_cur - data.kom_leads_prev) / data.kom_leads_prev * 100).toFixed(1) + '% к прошл.' : ''}</div></div>
      </div>
    </div>

    <!-- Funnel -->
    <div class="card"><h2>Воронка MQL → SQL → Сделки по неделям</h2>
      <div class="sub" style="margin:-8px 0 16px">MQL = новые в Pre Sale. SQL = WON в Pre Sale (передано в ОП). Сделки = оплачено по 1С.</div>
      <div class="twocol">
      <div class="card"><h2>📥 Воронка продаж</h2><div class="sub" style="margin:-8px 0 16px">Все лиды → MQL → SQL → Счёт → Оплачено</div><div class="chartbox-sm"><canvas id="ch_funnel"></canvas></div></div>
      <div class="card"><h2>🔍 Воронка (квал. лиды)</h2><div class="sub" style="margin:-8px 0 16px">MQL → SQL → Счёт → Оплачено</div><div class="chartbox-sm"><canvas id="ch_funnel_qual"></canvas></div></div>
    </div>
    <div class="twocol">
      <div class="card"><h2>📈 Конверсии воронки, %</h2><div class="chartbox-sm"><canvas id="ch_conv"></canvas></div></div>
      <div class="card"><h2>📈 Конверсии (квал. лиды), %</h2><div class="chartbox-sm"><canvas id="ch_conv_qual"></canvas></div></div>
    </div>
    <div class="twocol">
      <div class="card"><h2>📊 Поступления по неделям, ₽</h2><div class="chartbox"><canvas id="ch_pos"></canvas></div></div>
    </div>

    <!-- B2B + Formats -->
    <div class="twocol">
      <div class="card"><h2>B2B vs B2C · WON vs LOSE</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="chartbox-sm"><canvas id="ch_b2b"></canvas></div>
          <div class="chartbox-sm"><canvas id="ch_wl"></canvas></div>
        </div>
        <table style="margin-top:14px"><thead><tr><th>Период</th><th>Тип</th><th>Сделок</th><th>Поступления, ₽</th><th>Доля</th></tr></thead>
        <tbody>${b2bRow('YTD', b2b, b2c, totB2b)}${b2bRow(`W${cw}`, b2b_cur, b2c_cur, totCur)}</tbody></table>
      </div>
      <div class="card"><h2>Форматы обучения понедельно</h2>
        <div class="chartbox"><canvas id="ch_fmt"></canvas></div>
        <div style="margin-top:14px"><table><thead><tr><th>Формат</th><th>Сделок</th><th>Поступления, ₽</th><th>Доля</th></tr></thead>
        <tbody>${fmtData.map(([k, v]) =>
          `<tr><td><span class="dot" style="background:${fmtColors[k] || '#999'}"></span>${k}</td><td>${v.cnt}</td><td><b>${fmt(v.sum)}</b> ₽</td><td>${(v.sum/totFmt*100).toFixed(1)}%</td></tr>`
        ).join('')}</tbody></table></div>
      </div>
    </div>

    <!-- Sources → улучшенный блок с разделением -->
    <div class="card"><h2>Рейтинг источников поступлений</h2>
      <div class="sub" style="margin:-8px 0 14px">🟠 Входящий трафик · 🔵 Внутренняя база · первая строка — итог</div>
      <div class="scroll-x"><table class="sortable">
        <thead><tr>
          <th class="sort" data-col="0">#</th><th class="sort" data-col="1">Тип</th><th class="sort" data-col="2">Источник</th><th class="sort" data-col="3">📥 Всего</th><th class="sort" data-col="4">✅ Оплачено</th><th class="sort" data-col="5">💰 Поступления, ₽</th><th class="sort" data-col="6">💵 Ср.чек</th><th class="sort" data-col="7">⏱ Цикл,дн</th><th class="sort" data-col="8">📊 Конв.%</th><th class="sort" data-col="9">🔄 В работе</th><th class="sort" data-col="10">❌ Отказы</th>
        </tr></thead>
        <tbody>${srcTop.map((s, i) => {
          const isTotal = i === 0;
          var srcName = (s.name || '').toLowerCase();
          var isInternal = ['аккаунтинг','repeat','upsale','реанимаци','холодн','accounting'].some(function(kw){return srcName.includes(kw);});
          var typeColor = isTotal ? '' : (isInternal ? '#1976D2' : '#F57C00');
          var typeLabel = isTotal ? '' : (isInternal ? '🔵' : '🟠');
          var inWork = s.leads - s.deals - 0;
          var losses = 0;
          return `<tr${isTotal ? " style='background:#fff8e1;font-weight:700'" : ""}>
            <td>${isTotal ? '' : i}</td>
            <td>${typeLabel ? '<span style="color:'+typeColor+'">'+typeLabel+'</span>' : ''}</td>
            <td>${s.name || '—'}</td>
            <td>${s.leads}</td>
            <td><b>${s.deals}</b></td>
            <td><b>${fmt(s.postupleniya)}</b> ₽</td>
            <td>${fmt(s.avg_check)}</td>
            <td>${s.avg_won_days.toFixed(1)}</td>
            <td>${s.conv_lead_deals.toFixed(1)}%</td>
            <td>${Math.max(0, inWork)}</td>
            <td>0</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>

    <!-- Top products (80% revenue) -->
    <div class="card"><h2>ТОП-20 продуктов <span style="font-size:13px;color:#888;font-weight:400">без КОМ · по доле в поступлениях</span></h2>
      <div class="sub" style="margin:-8px 0 14px">Клик по заголовку для сортировки</div>
      <div class="scroll-x"><table class="sortable">
        <thead><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Продукт</th><th class="sort" data-col="2">📥 Всего</th><th class="sort" data-col="3">✅ Оплачено</th><th class="sort" data-col="4">💰 Поступления, ₽</th><th class="sort" data-col="5">💵 Ср.чек, ₽</th><th class="sort" data-col="6">⏱ Цикл,дн</th><th class="sort" data-col="7">📊 Конв.%</th><th class="sort" data-col="8">📈 Доля</th></tr></thead>
        <tbody>${(data.top_products || []).map((p, i) => {
          const isRem = (p.name || '').includes('Остальные');
          var conv = p.sql > 0 ? (p.deals / p.sql * 100) : 0;
          return `<tr${isRem ? " style='background:#f0f4ff;font-weight:700'" : ""}>
            <td>${isRem ? '' : i+1}</td>
            <td style='max-width:260px;white-space:normal'>${(p.name || '').substring(0, 100)}</td>
            <td>${p.sql}</td>
            <td><b>${p.deals}</b></td>
            <td><b>${fmt(p.sum)}</b> ₽</td>
            <td>${fmt(p.avg_check)}</td>
            <td>${p.avg_won_days.toFixed(1)}</td>
            <td>${conv.toFixed(1)}%</td>
            <td><b>${p.share.toFixed(1)}%</b></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>

    <!-- Top companies -->
    <div class="card"><h2>ТОП-20 компаний по поступлениям</h2>
      <div class="scroll-x" style="max-height:400px;overflow:auto"><table class="sortable">
        <thead><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Компания</th><th class="sort" data-col="2">💰 Поступления, ₽</th><th class="sort" data-col="3">✅ Сделок</th><th class="sort" data-col="4">💵 Ср.чек</th><th class="sort" data-col="5">📅 Последняя покупка</th></tr></thead>
        <tbody>${(data.top_companies || []).map((c, i) =>
          `<tr><td>${i+1}</td><td style="max-width:260px;white-space:normal">${c.name || '—'}</td><td><b>${fmt(c.sum)}</b> ₽</td><td>${c.cnt}</td><td>${fmt(c.avg_check || 0)}</td><td>${c.last_date || '—'}</td></tr>`
        ).join('')}</tbody>
      </table></div>
    </div>

    <!-- Managers -->
    <!-- Charts row -->
    <div class="twocol">
      <div class="card"><h2>Кол-во сделок: WON vs LOSE</h2><div class="chartbox"><canvas id="ch_cnt"></canvas></div></div>
      <div class="card"><h2>Средний чек по неделям, ₽</h2><div class="chartbox"><canvas id="ch_avg"></canvas></div></div>
    </div>

    <div class="twocol">
      <div class="card"><h2>Скорость закрытия WON, дн.</h2><div class="chartbox"><canvas id="ch_dur"></canvas></div></div>
      <div class="card"><h2>Скорость Pre Sale (MQL→SQL), дн.</h2><div class="chartbox"><canvas id="ch_presale"></canvas></div></div>
    </div>

    <!-- Week detail table -->
    <div class="card"><h2>Детализация по неделям</h2>
      <div class="sub" style="margin:-8px 0 14px">Сводные данные с начала года · первая строка — итог · клик по заголовку для сортировки</div>
      <div style="overflow-x:auto"><table class="sortable">
        <thead><tr>
          <th class="sort" data-col="0">Неделя</th><th class="sort" data-col="1">📥 Лиды</th><th class="sort" data-col="2">🔍 MQL</th><th class="sort" data-col="3">🎯 SQL</th><th class="sort" data-col="4">📄 Счёт</th><th class="sort" data-col="5">✅ Оплачено</th><th class="sort" data-col="6">💰 Поступления, ₽</th><th class="sort" data-col="7">💵 Ср.чек, ₽</th><th class="sort" data-col="8">⏱ Цикл,дн</th><th class="sort" data-col="9">📊 Лиды→MQL</th><th class="sort" data-col="10">📊 MQL→SQL</th><th class="sort" data-col="11">📊 SQL→Счёт</th><th class="sort" data-col="12">📊 Счёт→Оплата</th>
        </tr></thead>
        <tbody>${(() => {
          const total = weeks.reduce((a, w) => {
            a.mql += w.mql; a.sql += w.sql; a.invoice_cnt += w.invoice_cnt || 0; a.oplata += w.oplata;
            a.postupleniya += w.postupleniya; a.leads += w.leads;
            a.lost_cnt += w.lost_cnt;
            return a;
          }, { mql:0, sql:0, invoice_cnt:0, oplata:0, postupleniya:0, leads:0, lost_cnt:0 });
          const totAvg = total.oplata ? fmt(total.postupleniya / total.oplata) : '0';
          const totLm = total.leads ? (total.mql / total.leads * 100).toFixed(1) : '0.0';
          const totMs = total.mql ? (total.sql / total.mql * 100).toFixed(1) : '0.0';
          const totSi = total.sql ? (total.invoice_cnt / total.sql * 100).toFixed(1) : '0.0';
          const totIo = total.invoice_cnt ? (total.oplata / total.invoice_cnt * 100).toFixed(1) : '0.0';
          const totalRow =
            `<tr class="total-row" style="background:#fff8e1;font-weight:700">
              <td><b>📊 ИТОГО YTD</b></td>
              <td>${total.leads}</td>
              <td>${total.mql}</td>
              <td>${total.sql}</td>
              <td><b>${total.invoice_cnt}</b></td>
              <td><b>${total.oplata}</b></td>
              <td><b>${fmt(total.postupleniya)}</b></td>
              <td>${totAvg}</td>
              <td>—</td>
              <td>${totLm}%</td>
              <td>${totMs}%</td>
              <td>${totSi}%</td>
              <td>${totIo}%</td>
            </tr>`;
          return totalRow + weeks.map(w => renderWeekRow(w, w === last)).join('');
        })()}</tbody>
      </table></div>
    </div>


  <!-- Инсайты и рекомендации -->
  <div class="card" style="background:linear-gradient(135deg,#f8f9ff,#eef1f8)">
    <h2>📋 Ключевые выводы</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;line-height:1.6">
      <div>
        <b>📊 Общая картина YTD:</b>
        <ul style="margin:6px 0 0 18px;color:#444">
          <li>Поступления: <b>${fmt(ytd.postupleniya)} ₽</b> (${ytd.won_relevant_cnt} сделок)</li>
          <li>Средний чек: <b>${fmt(ytd.avg_check)} ₽</b></li>
          <li>Цикл сделки: простой <b>${ytd.avg_close_days_won.toFixed(1)} дн.</b> · взвешенный <b>${(ytd.avg_close_days_won_weighted || ytd.avg_close_days_won).toFixed(1)} дн.</b></li>
          <li>Лидов: <b>${fmt(data.leads_ytd)}</b> · MQL <b>${fmt(data.qual_lead_ytd)}</b> · конв. ${data.qual_lead_ytd && data.leads_ytd ? (data.qual_lead_ytd/data.leads_ytd*100).toFixed(1) : 0}%</li>
        </ul>
      </div>
      <div>
        <b>📈 Неделя W${cw}:</b>
        <ul style="margin:6px 0 0 18px;color:#444">
          <li>Поступления: <b>${fmt(last.postupleniya)} ₽</b> ${delta > 0 ? '📈 +' : '📉 '}${Math.abs(delta).toFixed(1)}% к прошлой</li>
          <li>Сделок: <b>${last.won_cnt}</b></li>
          <li>Лидов: <b>${fmt(data.leads_cur)}</b> (прошлая: ${fmt(data.leads_prev)})</li>
        </ul>
      </div>
      <div>
        <b>🏆 Лидеры:</b>
        <ul style="margin:6px 0 0 18px;color:#444">
          <li>Источник: <b>${srcTop.length > 1 ? srcTop[1].name : '—'}</b> (${fmt(srcTop.length > 1 ? srcTop[1].postupleniya : 0)} ₽)</li>
          <li>Формат: <b>${fmtData.length > 0 ? fmtData[0][0] : '—'}</b> (${fmtData.length > 0 ? fmt(fmtData[0][1].sum) : 0} ₽)</li>
          <li>${data.mgr_top && data.mgr_top.length > 0 ? 'Менеджер: <b>' + data.mgr_top[0].name + '</b> (' + fmt(data.mgr_top[0].postupleniya) + ' ₽)' : ''}</li>
        </ul>
      </div>
      <div>
        <b>💡 Рекомендации:</b>
        <ul style="margin:6px 0 0 18px;color:#444">
          ${delta > 5 ? '<li>🚦 <b style="color:#2E7D32">🟢 Рост</b> поступлений +' + Math.abs(delta).toFixed(1) + '% к прошлой неделе</li>' : delta < -5 ? '<li>🚦 <b style="color:#C62828">🔴 Падение</b> поступлений ' + delta.toFixed(1) + '% к прошлой неделе</li>' : '<li>🚦 <b style="color:#F57C00">🟡 Стабильно</b> поступлений</li>'}
          ${last.won_cnt === 0 && last.postupleniya === 0 ? '<li>⚠️ Текущая неделя без оплат — возможна задержка 1С</li>' : ''}
          ${(srcTop.length > 1 && srcTop[1].conv_lead_deals < 5) ? '<li>🎯 Низкая конверсия лид→сделка — поработать с качеством лидов</li>' : ''}
          ${ytd.median_close_days_won > 60 ? '<li>⏱ Медленная скорость закрытия (' + ytd.median_close_days_won + ' дн. медиана) — ускорить обработку</li>' : '<li>⏱ Скорость закрытия: ' + ytd.median_close_days_won + ' дн. (медиана) ✅</li>'}
          <li>📌 Средняя скорость закрытия: ${ytd.median_close_days_won} дн. (медиана)</li>
        </ul>
      </div>
    </div>
  </div>
  `;
  initTableSort();
}

// === Сортировка таблиц (как в Excel) ===
function initTableSort() {
  document.querySelectorAll('table.sortable').forEach(tbl => {
    const ths = tbl.querySelectorAll('thead th.sort');
    ths.forEach(th => {
      th.addEventListener('click', () => {
        const col = parseInt(th.dataset.col);
        const tbody = tbl.querySelector('tbody');
        if (!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('tr:not(.total-row)'));
        const totalRows = Array.from(tbody.querySelectorAll('tr.total-row'));
        const isAsc = th.classList.contains('asc');
        ths.forEach(h => h.classList.remove('asc', 'desc'));
        th.classList.add(isAsc ? 'desc' : 'asc');
        rows.sort((a, b) => {
          const va = (a.cells[col]?.innerText || '').trim();
          const vb = (b.cells[col]?.innerText || '').trim();
          // Попробуем распарсить как число
          const na = parseFloat(va.replace(/[^\d\-.,]/g, '').replace(',', ''));
          const nb = parseFloat(vb.replace(/[^\d\-.,]/g, '').replace(',', ''));
          if (!isNaN(na) && !isNaN(nb)) {
            return isAsc ? na - nb : nb - na;
          }
          return isAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        });
        [...totalRows, ...rows].forEach(r => tbody.appendChild(r));
      });
    });
  });
}

async function renderPageNewLogic() {
  const area = document.getElementById("contentAreaNew");
  area.innerHTML = '<div class="loading-state"><div class="spinner"></div><div>Загрузка новой логики…</div></div>';
  try {
    const data = await api("/api/data/new");
    if (!data.ytd) { area.innerHTML = '<div class="error-state">❌ Нет данных</div>'; return; }
    function fmt(n) { return (n===undefined||n===null||n===0)?'0':Number(n).toLocaleString('ru-RU',{maximumFractionDigits:0}); }
    function kpi(l,v,s,c) { return '<div class=kpi'+(c?' '+c:'')+'><div class=lbl>'+l+'</div><div class=val>'+v+'</div><div class=sub>'+s+'</div></div>'; }
    var w=data.weeks||[], lst=w[w.length-1]||{}, prv=w[w.length-2]||{}, cw=data.cur_week||0;
    function rw(t,ytd,cur,kom) {
      var h='<div class=kpis><div style="grid-column:1/-1;font-size:15px;font-weight:700;margin:4px 0;color:'+(kom?'#C62828':'#1f2a44')+'">'+t+'</div>';
      h+=kpi('Поступления',fmt(ytd.postupleniya)+' руб',ytd.won_relevant_cnt+'сд.');
      h+=kpi('Лиды',fmt(ytd.created_cnt),'в работе '+(ytd.created_cnt-ytd.won_relevant_cnt-ytd.lose_cnt));
      h+=kpi('Конверсия',(ytd.conv_deal_pct||0).toFixed(1)+'%','');
      h+=kpi('Ср.чек',fmt(ytd.avg_check)+' руб','');
      h+=kpi('Цикл сделки, дней',ytd.avg_close_days_won.toFixed(1)+' дн.','');
      var d=prv.postupleniya?((lst.postupleniya-prv.postupleniya)/prv.postupleniya*100):0;
      h+=kpi('W'+cw+': поступления',fmt(lst.postupleniya)+' руб',(d>=0?'+':'-')+Math.abs(d).toFixed(1)+'%');
      h+=kpi('W'+cw+': лиды',fmt(lst.leads||''),'');
      h+='</div>'; return h;
    }
    var html = rw('Общая (ООМ+КОМ)',data.ytd,data.cur);
    html += rw('ООМ (Открытое обучение)',data.oom_ytd,data.oom_cur);
    html += rw('КОМ (Корпоративное обучение)',data.kom_ytd,data.kom_cur,true);
    area.innerHTML = html + '<div class="twocol" style="margin-top:16px"><div class="card"><h2>Воронка по неделям</h2><div class="chartbox"><canvas id="ch_funnel_new"></canvas></div></div><div class="card"><h2>Воронка (квал. лиды)</h2><div class="chartbox"><canvas id="ch_funnel_new_qual"></canvas></div></div></div><div class="twocol" style="margin-top:16px"><div class="card"><h2>Конверсии</h2><div class="chartbox"><canvas id="ch_conv_new"></canvas></div></div><div class="card"><h2>Конверсии (квал. лиды)</h2><div class="chartbox"><canvas id="ch_conv_new_qual"></canvas></div></div></div>';
  } catch(e) { area.innerHTML = '<div class=error-state>Ошибка: '+escapeHtml(e.message)+'</div>'; }
}
async function renderPageMainNew(d) {
  var areaNew = document.getElementById('contentAreaNew');
  if (!areaNew) return;
  try {
    if (!d) d = await api('/api/data/new');
    if (!d || !d.ytd) { areaNew.innerHTML = '<div class="error-state">Нет данных</div>'; return; }

    var html = '';

    // ММВА — в самый вверх
    html += '<div class="card" style="margin-top:8px"><h3>Поступления по линейке ММВА</h3><div id="newMbaTable"></div></div>';

    // Топ-20 продуктов
    html += '<div class="card" style="margin-top:8px"><h2>ТОП-20 продуктов <span style="font-size:13px;color:#888;font-weight:400">без КОМ · по доле в поступлениях</span></h2><div class="sub" style="margin:-8px 0 14px">Клик по заголовку для сортировки</div><div style="overflow-x:auto"><div id="newProductsTable"></div></div></div>';
    // Источники
    html += '<div class="card"><h2>Рейтинг источников поступлений</h2><div class="sub" style="margin:-8px 0 14px">Сводные данные с начала года · первая строка — итог · клик по заголовку для сортировки</div><div style="overflow-x:auto"><div id="newSrcTable"></div></div></div>';
    html += '<div class="card"><h2>Топ-20 компаний</h2><div id="newCompaniesTable"></div></div>';

    areaNew.innerHTML = html;

    // Fill tables
    var prods = d.top_products||[];
    var prodTotalDeals = prods.reduce(function(s,p){return s+(p.deals||p.cnt||0);},0);
    var prodTotalSum = prods.reduce(function(s,p){return s+(p.sum||0);},0);
    var prodTotalSql = prods.reduce(function(s,p){return s+(p.sql||0);},0);
    var prodTotalOchn = prods.reduce(function(s,p){return s+(p.fmt_ochn_cnt||0);},0);
    var prodTotalSdo = prods.reduce(function(s,p){return s+(p.fmt_sdo_cnt||0);},0);
    var prodTotalOchnSum = prods.reduce(function(s,p){return s+(p.fmt_ochn_sum||0);},0);
    var prodTotalSdoSum = prods.reduce(function(s,p){return s+(p.fmt_sdo_sum||0);},0);
    var prodStr = '<table class="sortable" style="font-size:11px"><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Продукт</th><th class="sort" data-col="2">SQL</th><th class="sort" data-col="3">Сделки</th><th class="sort" data-col="4">Поступления, ₽</th><th class="sort" data-col="5">Ср.чек, ₽</th><th class="sort" data-col="6">Срок WON</th><th class="sort" data-col="7">Доля</th><th class="sort" data-col="8"><span class="dot" style="background:#2E7D32"></span>Очно</th><th class="sort" data-col="9"><span class="dot" style="background:#1976D2"></span>Дистанционно</th></tr><tr style="background:#fff8e1;font-weight:700"><td></td><td><b>📊 ИТОГО</b></td><td>'+prodTotalSql+'</td><td><b>'+prodTotalDeals+'</b></td><td><b>'+fmt(prodTotalSum)+'</b> ₽</td><td>'+fmt(prodTotalDeals?Math.round(prodTotalSum/prodTotalDeals):0)+'</td><td>—</td><td><b>100%</b></td><td>'+prodTotalOchn+' ('+fmt(prodTotalOchnSum)+' ₽)</td><td>'+prodTotalSdo+' ('+fmt(prodTotalSdoSum)+' ₽)</td></tr>';
    prods.slice(0,21).forEach(function(p,i){
      if(!p.name) return;
      var isRem = (p.name||'').includes('Остальные');
      var pc=p.cnt||p.deals||0;
      prodStr += '<tr'+(isRem?' style="background:#f0f4ff;font-weight:700"':'')+'><td>'+(isRem?'':(i+1))+'</td><td style="max-width:260px;white-space:normal">'+escapeHtml((p.name||'').substring(0,100))+'</td><td>'+(p.sql||0)+'</td><td><b>'+pc+'</b></td><td><b>'+fmt(p.sum)+'</b> ₽</td><td>'+fmt(p.avg_check)+'</td><td>'+(p.avg_won_days||0).toFixed(1)+'дн</td><td><b>'+(p.share||0).toFixed(1)+'%</b></td><td>'+(p.fmt_ochn_cnt||0)+' ('+fmt(p.fmt_ochn_sum||0)+' ₽)</td><td>'+(p.fmt_sdo_cnt||0)+' ('+fmt(p.fmt_sdo_sum||0)+' ₽)</td></tr>';
    });
    prodStr += '</table>';
    var el = document.getElementById('newProductsTable'); if(el) el.innerHTML = prodStr;

    var src = d.src_rating||[];
    var srcStr = '<table class="sortable" style="font-size:11px"><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Источник</th><th class="sort" data-col="2">Поступления, ₽</th><th class="sort" data-col="3">MQL</th><th class="sort" data-col="4">SQL</th><th class="sort" data-col="5">Сделки</th><th class="sort" data-col="6">MQL→SQL</th><th class="sort" data-col="7">SQL→Сд.</th><th class="sort" data-col="8">Лид→Сд.</th><th class="sort" data-col="9">Лидов</th><th class="sort" data-col="10">Ср.чек, ₽</th><th class="sort" data-col="11">Срок WON</th></tr>';
    src.forEach(function(s,i){
      if(!s.name) return;
      var isTotal = i === 0;
      srcStr += '<tr'+(isTotal?' style="background:#fff8e1;font-weight:700"':'')+'><td>'+(isTotal?'':i)+'</td><td>'+escapeHtml(s.name)+'</td><td><b>'+fmt(s.postupleniya)+'</b> ₽</td><td>'+(s.mql||0)+'</td><td>'+(s.sql||0)+'</td><td>'+(s.deals||0)+'</td><td>'+(s.conv_mql_sql||0).toFixed(1)+'%</td><td>'+(s.conv_sql_deals||0).toFixed(1)+'%</td><td>'+(s.conv_lead_deals||0).toFixed(1)+'%</td><td>'+(s.leads||0)+'</td><td>'+fmt(s.avg_check)+'</td><td>'+(s.avg_won_days||0).toFixed(1)+'дн</td></tr>';
    });
    srcStr += '</table>';
    el = document.getElementById('newSrcTable'); if(el) el.innerHTML = srcStr;

    // Сортировка
    if (typeof initTableSort === 'function') initTableSort();


    var comps = d.top_companies || [];
    var compStr = '<table style="font-size:11px"><tr><th>#</th><th>Компания</th><th>Поступления</th><th>Сделок</th><th>Ср.чек</th><th>Последняя оплата</th></tr>';
    comps.forEach(function(c, i){compStr+='<tr><td>'+(i+1)+'</td><td><b>'+escapeHtml(c.name)+'</b></td><td>'+fmt(c.sum)+' ₽</td><td>'+c.cnt+'</td><td>'+fmt(c.avg_check)+' ₽</td><td>'+c.last_date+'</td></tr>';});
    compStr += '</table>';
    el = document.getElementById('newCompaniesTable'); if(el) el.innerHTML = compStr;

    // ММВА: заполнение
    var mbaData = d.mba_rating||[];
    var mbaTotal = mbaData.reduce(function(s,m){return s+(m.sum||0);},0);
    var mbaDeals = mbaData.reduce(function(s,m){return s+(m.cnt||0);},0);
    var mbaAvg = mbaDeals ? Math.round(mbaTotal / mbaDeals) : 0;
    var mbaOchn = mbaData.reduce(function(s,m){return s+(m.fmt_ochn_cnt||0);},0);
    var mbaSdo = mbaData.reduce(function(s,m){return s+(m.fmt_sdo_cnt||0);},0);
    var mbaOchnSum = mbaData.reduce(function(s,m){return s+(m.fmt_ochn_sum||0);},0);
    var mbaSdoSum = mbaData.reduce(function(s,m){return s+(m.fmt_sdo_sum||0);},0);
    var mbaStr = mbaData.length ? '<table style="font-size:11px"><tr><th>Тип</th><th>Поступления</th><th>Шт</th><th>Ср.чек</th><th>Доля,%</th><th><span class="dot" style="background:#2E7D32"></span>Очно</th><th><span class="dot" style="background:#1976D2"></span>Дистанционно</th></tr><tr style="background:#fff8e1;font-weight:700"><td><b>📊 ИТОГО</b></td><td><b>'+fmt(mbaTotal)+' ₽</b></td><td>'+mbaDeals+'</td><td>'+fmt(mbaAvg)+' ₽</td><td>100%</td><td>'+mbaOchn+' ('+fmt(mbaOchnSum)+' ₽)</td><td>'+mbaSdo+' ('+fmt(mbaSdoSum)+' ₽)</td></tr>'+mbaData.map(function(m){return '<tr><td><b>'+escapeHtml(m.type)+'</b></td><td>'+fmt(m.sum)+' ₽</td><td>'+m.cnt+'</td><td>'+fmt(m.avg_check)+' ₽</td><td>'+(mbaTotal>0?(m.sum/mbaTotal*100).toFixed(1):'0.0')+'%</td><td>'+ (m.fmt_ochn_cnt||0) +' ('+fmt(m.fmt_ochn_sum||0)+' ₽)</td><td>'+ (m.fmt_sdo_cnt||0) +' ('+fmt(m.fmt_sdo_sum||0)+' ₽)</td></tr>';}).join('')+'</table>' : '<div style="padding:8px;color:#475569;font-size:12px">Нет данных по MBA</div>';
    el = document.getElementById('newMbaTable'); if(el) el.innerHTML = mbaStr;

  } catch(e) {
    areaNew.innerHTML = '<div class="error-state">❌ <b>Ошибка загрузки</b><br>'+escapeHtml(e.message)+'</div>';
    console.error('renderPageMainNew error:', e);
  }
}


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

// --- Refresh ---
async function refreshButtonHandler() {
  this.disabled = true;
  this.textContent = '⏳ Обновление...';
  document.getElementById('loadingFill').style.width = '10%';

  try {
    // Сбросим, если было зависшее состояние
    await safeFetch((window.BASE_PATH || '') + '/api/refresh/reset', { method: 'POST' });
    
    var resData = await safeFetch((window.BASE_PATH || '') + '/api/refresh', { method: 'POST' });
    if (!resData.ok) { alert(resData.message); return; }
    
    // Ждём сколько нужно — без ограничения по времени
    var pollCount = 0;
    var statusEl = document.getElementById('loadingBar');
    var statusText = document.createElement('div');
    statusText.style.cssText = 'text-align:center;font-size:0.85rem;color:#888;margin-top:4px;';
    statusText.id = 'loadingStatusText';
    var existing = document.getElementById('loadingStatusText');
    if (existing) existing.remove();
    // Показываем панель прогресса
    var panel = document.getElementById('refreshStatusPanel');
    if (!panel) {
      var toolbar = document.querySelector('.toolbar');
      if (toolbar) toolbar.insertAdjacentHTML('afterend', statusPanelHTML);
      panel = document.getElementById('refreshStatusPanel');
    }
    if (panel) {
      panel.style.display = 'block';
      document.getElementById('statusProgressFill').style.width = '0%';
      document.getElementById('statusSteps').innerHTML = renderStepLines(-1, refreshStepsData, 0);
      document.getElementById('statusElapsed').textContent = '⏱ 0м 0с';
      document.getElementById('statusDealProgress').textContent = '';
    }
    
    while (true) {
      await new Promise(r => setTimeout(r, 5000));
      pollCount++;
      
      var status = await safeFetch((window.BASE_PATH || '') + '/api/status');
      
      // Показываем сколько времени прошло
      var elapsed = '';
      if (status.startedAt) {
        var start = new Date(status.startedAt);
        var now = new Date();
        var diff = Math.floor((now - start) / 1000);
        var min = Math.floor(diff / 60);
        var sec = diff % 60;
        elapsed = min + 'м ' + sec + 'с';
        var elEl = document.getElementById('statusElapsed');
        if (elEl) elEl.textContent = '⏱ ' + elapsed;
      }
      
      var pct = status.progressPct != null ? status.progressPct : 0;
      var fillEl = document.getElementById('statusProgressFill');
      if (fillEl) fillEl.style.width = Math.min(pct, 100) + '%';
      document.getElementById('loadingFill').style.width = Math.min(pct, 100) + '%';
      
      var curIdx = status.currentStepIdx != null ? status.currentStepIdx : -1;
      if (status.progressSteps) {
        var allDone = status.progressSteps.every(function(s) { return s.done; });
        if (allDone) curIdx = refreshStepsData.length;
        var stepsEl = document.getElementById('statusSteps');
        if (stepsEl) stepsEl.innerHTML = renderStepLines(curIdx, status.progressSteps, pct);
      }
      
      var dealText = '';
      if (status.loadingPhase && status.loadingPhase !== 'Запуск скрипта...') {
        dealText = status.loadingPhase;
        if (status.loadingProgress && status.loadingProgress.current > 0) {
          dealText += ' — ' + status.loadingProgress.current.toLocaleString('ru-RU') + ' сделок';
        }
      }
      var dpEl = document.getElementById('statusDealProgress');
      if (dpEl) dpEl.textContent = dealText;
      
      if (status.error && !status.loading) {
        var stepsEl = document.getElementById('statusSteps');
        if (stepsEl) stepsEl.innerHTML += '<div class="refresh-step step-error"><span class="step-icon">❌</span><span class="step-label">Ошибка: ' + escapeHtml(status.error) + '</span></div>';
        alert('Ошибка: ' + status.error);
        break;
      }
      if (status.ready && !status.loading) {
        var fillEl = document.getElementById('statusProgressFill');
        if (fillEl) fillEl.style.width = '100%';
        document.getElementById('loadingFill').style.width = '100%';
        var stepsEl = document.getElementById('statusSteps');
        if (stepsEl) stepsEl.innerHTML = renderStepLines(refreshStepsData.length, refreshStepsData, 100);
        var dpEl = document.getElementById('statusDealProgress');
        if (dpEl) dpEl.textContent = '✅ Загружено за ' + elapsed;
        
        setTimeout(function() {
          var pnl = document.getElementById('refreshStatusPanel');
          if (pnl) pnl.style.display = 'none';
        }, 5000);
        
        loadAll().catch(function(e) {});
        break;
      }
    }
  } catch (e) { 
    if (e.message !== 'redirect') {
      alert('Ошибка: ' + e.message);
    }
  }
  finally { this.disabled = false; this.textContent = '🔄 Обновить данные'; }
}

// --- Date filter ---
document.addEventListener('DOMContentLoaded', function() {
    // Enter на datepicker тоже применяет
  document.getElementById('dateFrom').addEventListener('change', function() {
    if (document.getElementById('dateTo').value) renderFilteredData();
  });
  document.getElementById('dateTo').addEventListener('change', function() {
    if (document.getElementById('dateFrom').value) renderFilteredData();
  });
});


// Защищённый запуск: ошибка не должна блокировать UI
loadAll().catch(function(e) {
  var area = document.getElementById('contentArea');
  if (area) area.innerHTML = '<div class="error-state">⚠️ Ошибка загрузки: ' + escapeHtml(e.message) + '<br>Нажмите «Обновить данные»</div>';
  var areaNew = document.getElementById('contentAreaNew');
  if (areaNew) areaNew.innerHTML = areaNew.innerHTML || '<div class="error-state">⚠️ Ошибка загрузки: ' + escapeHtml(e.message) + '</div>';
});

// --- Participants tab ---
