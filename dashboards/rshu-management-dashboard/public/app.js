function escapeHtml(t){return String(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function fmt(n){return (n||0).toLocaleString('ru-RU');}
function loadArtifacts(){
  fetch(window.BASE_PATH+'/api/artifacts').then(function(r){return r.json();}).then(function(d){
    var el=document.getElementById('newArtifactsBlock');
    if(!el)return;
    var s=d&&d.summary;
    if(!s||(!s.returns.cnt&&!s.inProgressPaid.cnt&&!s.wonNoPay.cnt&&!s.negativeDuration.cnt&&!s.otherCatPaid.cnt&&!s.nextYear.cnt&&(!s.formatRule2||!s.formatRule2.cnt))){
      el.innerHTML='<div style="padding:8px;color:#475569;font-size:12px">Аномалий не обнаружено</div>';return;
    }
    var h='<div style="font-size:12px;background:#F1F3F6;border-radius:8px;padding:12px;margin:8px 0">';
    h+='<b>⚠ Аномалии данных</b><table style="width:100%;margin-top:8px;font-size:12px;border-collapse:collapse">';
    if(s.returns.cnt) h+='<tr><td>🔙 Возвраты (LOSE+PAY)</td><td style="text-align:right">'+s.returns.cnt+' шт.</td><td style="text-align:right;color:#C62828">'+fmt(s.returns.sum)+' ₽</td></tr>';
    if(s.inProgressPaid.cnt) h+='<tr><td>📌 В работе + оплата</td><td style="text-align:right">'+s.inProgressPaid.cnt+' шт.</td><td style="text-align:right;color:#E65100">'+fmt(s.inProgressPaid.sum)+' ₽</td></tr>';
    if(s.wonNoPay.cnt) h+='<tr><td>✅ WON без даты оплаты</td><td style="text-align:right">'+s.wonNoPay.cnt+' шт.</td><td style="text-align:right;color:#1565C0">'+fmt(s.wonNoPay.sum)+' ₽</td></tr>';
    if(s.negativeDuration.cnt) h+='<tr><td>⏪ Оплата раньше создания</td><td style="text-align:right">'+s.negativeDuration.cnt+' шт.</td><td style="text-align:right;color:#6A1B9A">'+fmt(s.negativeDuration.sum)+' ₽</td></tr>';
    if(s.otherCatPaid.cnt) h+='<tr><td>📂 Др.категории с оплатой</td><td style="text-align:right">'+s.otherCatPaid.cnt+' шт.</td><td style="text-align:right">'+fmt(s.otherCatPaid.sum)+' ₽</td></tr>';
    if(s.nextYear.cnt) h+='<tr><td>📅 «Следующий год»</td><td style="text-align:right">'+s.nextYear.cnt+' шт.</td><td style="text-align:right">0 ₽</td></tr>';
    if(s.formatRule2.cnt) h+='<tr><td>🏷 Формат без UF_FORMAT</td><td style="text-align:right">'+s.formatRule2.cnt+' шт.</td><td style="text-align:right;color:#FF8A65">'+fmt(s.formatRule2.sum)+' ₽</td></tr>';
    h+='</table></div>';
    el.innerHTML=h;
  }).catch(function(){});
}


// Автоопределение пути — работает и самостоятельным сайтом, и как sub-app
var _p = window.location.pathname;
var _m = _p.match(/^\/([^/]+?)(?:\/|$)/);
window.BASE_PATH = _m ? '/' + _m[1] : '';


// Защита от падения, если CDN с Chart.js не загрузился
if (typeof Chart !== 'undefined' && Chart.register && typeof ChartDataLabels !== 'undefined') {
  try { Chart.register(ChartDataLabels); } catch(e) {}
}

let chartInstances = {};
let dataCache = null;
let dateFromCache = null;
let dateToCache = null;

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
  var areaNew = document.getElementById('contentAreaNew');
  if (!areaNew) return;
  try {
    const d = await api('/api/data/new');
    if (!d || !d.ytd) return;
    document.getElementById('loadingFill').style.width = '100%';
    dataCache = d;
    
    // Устанавливаем dateFrom/dateTo по умолчанию: с первой недели до today
    // По умолчанию: с 1 января текущего года
    document.getElementById('dateFrom').value = '2026-01-01';
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
  oom_ytd.postupleniya = sumField('oom_postupleniya');
  oom_ytd.won_relevant_cnt = sumField('oom_won_cnt');
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
  out.oom_cur = { postupleniya: last.oom_postupleniya || 0, won_relevant_cnt: last.oom_won_cnt || 0 };
  out.oom_prev = { postupleniya: prev.oom_postupleniya || 0, won_relevant_cnt: prev.oom_won_cnt || 0 };
  out.kom_cur = { postupleniya: last.kom_postupleniya || 0, won_relevant_cnt: last.kom_won_cnt || 0 };
  out.kom_prev = { postupleniya: prev.kom_postupleniya || 0, won_relevant_cnt: prev.kom_won_cnt || 0 };
  out.cur_week = last.week || orig.cur_week;
  out.prev_week = prev.week || orig.prev_week;
  
  // Лиды
  out.leads_ytd = sumField('leads');
  out.leads_cur = last.leads || 0;
  out.leads_prev = prev.leads || 0;
  out.oom_leads_ytd = sumField('oom_leads');
  out.kom_leads_ytd = orig.kom_leads_ytd || sumField("kom_won_cnt");
  
  // Форматы — оставляем из оригинала (не перезаписываем, т.к. в неделях нет cnt)
  
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
      <td><span class="dot" style="background:#3079D2"></span>B2B</td>
      <td>${b.cnt}</td><td><b>${fmt(b.sum)}</b> ₽</td><td>${(b.sum/tot*100).toFixed(1)}%</td></tr>
      <tr><td></td>
      <td><span class="dot" style="background:#F57C00"></span>B2C</td>
      <td>${c.cnt}</td><td><b>${fmt(c.sum)}</b> ₽</td><td>${(c.sum/tot*100).toFixed(1)}%</td></tr>`;
  }

  // Formats table
  const fmtData = Object.entries(data.fmt_ytd || {}).filter(([k]) => k !== 'period').sort((a,b) => b[1].sum - a[1].sum);
  const totFmt = fmtData.reduce((s, [,v]) => s + v.sum, 0) || 1;
  const fmtColors = { "ОМ (Онлайн)": "#43A047", "ООМ (Очное)": "#00bcd4", "СДО": "#F57C00", "КОМ": "#9C27B0" };

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

    <!-- B2B + Formats -->
    <div class="twocol">
      <div class="card"><h2>B2B vs B2C · Оплаты vs Отказы</h2>
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
      <div class="scroll-x" style="max-height:520px;overflow:auto"><table class="sortable">
        <thead><tr>
          <th class="sort" data-col="0">#</th><th class="sort" data-col="1">Тип</th><th class="sort" data-col="2">Источник</th><th class="sort" data-col="3">📥 Всего</th><th class="sort" data-col="4">✅ Оплачено</th><th class="sort" data-col="5">💰 Поступления, ₽</th><th class="sort" data-col="6">💵 Ср.чек</th><th class="sort" data-col="7">⏱ Цикл,дн</th><th class="sort" data-col="8">📊 Конв.%</th><th class="sort" data-col="9">🔄 В работе</th><th class="sort" data-col="10">❌ Отказы</th>
        </tr></thead>
        <tbody>${srcTop.map((s, i) => {
          const isTotal = i === 0;
          var srcName = (s.name || '').toLowerCase();
          var isInternal = ['аккаунтинг','repeat','upsale','реанимаци','холодн','accounting'].some(function(kw){return srcName.includes(kw);});
          var typeColor = isTotal ? '' : (isInternal ? '#3079D2' : '#F57C00');
          var typeLabel = isTotal ? '' : (isInternal ? '🔵' : '🟠');
          var inWork = s.leads - s.deals - 0;
          var losses = 0;
          return `<tr${isTotal ? " style='background:#F1F3F6;font-weight:700'" : ""}>
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
    <div class="card"><h2>ТОП-20 продуктов <span style="font-size:13px;color:#475569;font-weight:400">без КОМ · по доле в поступлениях</span></h2>
      <div class="sub" style="margin:-8px 0 14px">Клик по заголовку для сортировки</div>
      <div class="scroll-x" style="max-height:520px;overflow:auto"><table class="sortable">
        <thead><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Продукт</th><th class="sort" data-col="2">📥 Всего</th><th class="sort" data-col="3">✅ Оплачено</th><th class="sort" data-col="4">💰 Поступления, ₽</th><th class="sort" data-col="5">💵 Ср.чек, ₽</th><th class="sort" data-col="6">⏱ Цикл,дн</th><th class="sort" data-col="7">📊 Конв.%</th><th class="sort" data-col="8">📈 Доля</th></tr></thead>
        <tbody>${(data.top_products || []).map((p, i) => {
          const isRem = (p.name || '').includes('Остальные');
          var conv = p.sql > 0 ? (p.deals / p.sql * 100) : 0;
          return `<tr${isRem ? " style='background:#F1F3F6;font-weight:700'" : ""}>
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
    <div class="card"><h2>Менеджеры YTD <span style="font-size:13px;color:#475569;font-weight:400">(основная воронка · лиды из CRM)</span></h2>
      <div class="scroll-x"><table class="sortable">
        <thead><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Менеджер</th><th class="sort" data-col="2">Лидов CRM</th><th class="sort" data-col="3">WON</th><th class="sort" data-col="4">Проигр</th><th class="sort" data-col="5">Конв.%</th><th class="sort" data-col="6">Ср. чек, ₽</th><th class="sort" data-col="7">Поступления, ₽</th></tr></thead>
        <tbody>${(data.mgr_top || []).filter(m => m.leads > 0).map((m, i) =>
          `<tr><td>${i+1}</td><td>${m.name}</td><td>${m.leads}</td><td>${m.won}</td><td>${m.lost}</td><td>${m.conv_pct}%</td><td>${fmt(m.avg_check)} ₽</td><td><b>${fmt(m.postupleniya)}</b> ₽</td></tr>`
        ).join('')}</tbody>
      </table></div>
    </div>

    <!-- Charts row -->
    <div class="twocol">
      <div class="card"><h2>Кол-во сделок: Оплаты vs Отказы</h2><div class="chartbox"><canvas id="ch_cnt"></canvas></div></div>
      <div class="card"><h2>Средний чек по неделям, ₽</h2><div class="chartbox"><canvas id="ch_avg"></canvas></div></div>
    </div>

    <div class="twocol">
      <div class="card"><h2>Скорость закрытия WON, дн.</h2><div class="chartbox"><canvas id="ch_dur"></canvas></div></div>
      <div class="card"><h2>Скорость Pre Sale (MQL→SQL), дн.</h2><div class="chartbox"><canvas id="ch_presale"></canvas></div></div>
    </div>

    <!-- Week detail table -->
    <div class="card"><h2>Детализация по неделям</h2>
      <div style="max-height:520px;overflow:auto"><table class="sortable">
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
            `<tr class="total-row" style="background:#F1F3F6;font-weight:700">
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
      var h='<div class=kpis><div style="grid-column:1/-1;font-size:15px;font-weight:700;margin:4px 0;color:'+(kom?'#9C27B0':'#1f2a44')+'">'+t+'</div>';
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

        function kpi(label, val, sub, cls) {
      var kpiCls = cls === 'oom' ? 'kpi-oom' : (cls === 'kom' ? 'kpi-kom' : 'kpi-total');
      return '<div class="kpi '+kpiCls+'"><div class="lbl">'+label+'</div><div class="val">'+val+'</div><div class="sub">'+(sub||'')+'</div></div>';
    }
    function delta(a,b) {
      if (!b) return '';
      var p = b>0?((a-b)/b*100).toFixed(1):0, s=(p>0?'\u2191':(p<0?'\u2193':'\u2192'));
      var cl = p>0?'delta-up':(p<0?'delta-down':'delta-flat');
      return ' <span class="'+cl+'">'+s+' '+Math.abs(p)+'%</span>';
    }
    function section(title, ytd, cur, prev, cls, leadsYtd, leadsCur, leadsPrev, qualLeads, mqlCur, mqlPrev) {
      var cc = cls==='kom'?'c-kom':(cls==='oom'?'c-oom':'c-total');
      var kc = cls==='kom'?'kpi-kom':(cls==='oom'?'kpi-oom':'kpi-total');
      var wkLabel = wkCur && wkCur.label_dates ? '<span class="kpi-dates"> \u00b7 '+wkCur.label_dates+'</span>' : '';
      var r = '<div class="kpis"><div class="kpi-header '+cc+'">'+title+wkLabel+'</div>'
        + '<div class="kpi '+kc+'"><div class="lbl">Поступления</div><div class="row"><div class="val-big">'+fmt(ytd.postupleniya)+' \u20bd</div><span class="si">('+fmt(ytd.won_relevant_cnt)+' сд.)</span></div></div>'
        + '<div class="kpi '+kc+'"><div class="lbl">\ud83d\udccb Лиды всего</div><div class="row"><div class="val-big">'+fmt(leadsYtd != null ? leadsYtd : ytd.won_relevant_cnt)+'</div><span class="si">конв. '+((qualLeads/leadsYtd*100).toFixed(1))+'%</span></div><div class="lbl2">квал. лиды (MQL)</div><div class="row"><div class="val-big '+cc+'">'+fmt(qualLeads)+'</div><span class="si">с начала года</span></div></div>'
        + '<div class="kpi '+kc+'"><div class="lbl">\ud83d\udcc8 Конверсия</div><div class="row"><div class="val-big">'+fmtPct(leadsYtd>0?(ytd.won_relevant_cnt/leadsYtd*100):0)+'%</div><span class="si">всех лидов</span></div><div class="row"><div class="val-big '+cc+'">'+fmtPct(qualLeads>0?(ytd.won_relevant_cnt/qualLeads*100):0)+'%</div><span class="si">квал. лидов (MQL)</span></div></div>'
        + '<div class="kpi '+kc+'"><div class="lbl">\ud83d\udcb0 Средний чек</div><div class="row"><div class="val-big">'+fmt(ytd.avg_check)+' \u20bd</div><span class="si">средний</span></div><div class="row"><div class="val-big '+cc+'">'+fmt(ytd.median_check)+' \u20bd</div><span class="si">медиана</span></div></div>'
        + kpi('\u0426\u0438\u043a\u043b сделки',(ytd.avg_close_days_won||0).toFixed(1)+' дн.','с начала года',cls)
        + kpi('\u041d\u0435\u0434\u0435\u043b\u044f: поступления',fmt(cur.postupleniya)+' \u20bd'+delta(cur.postupleniya, prev.postupleniya),'',cls)
        + '<div class="kpi '+kc+'"><div class="lbl">Неделя: лиды</div><div class="val-big">'+fmt(leadsCur != null ? leadsCur : cur.won_relevant_cnt)+' '+(leadsPrev != null ? delta(leadsCur, leadsPrev) : (prev ? delta(cur.won_relevant_cnt, prev.won_relevant_cnt) : ''))+'</div><div class="lbl2">квал. лиды (MQL)</div><div class="val-big '+cc+'">'+fmt(mqlCur != null ? mqlCur : (wkCur ? (wkCur.mql || 0) : 0))+' '+(mqlPrev != null ? delta(mqlCur||0, mqlPrev||0) : (wkPrev ? delta(wkCur ? (wkCur.mql||0) : 0, wkPrev ? (wkPrev.mql||0) : 0) : ''))+'</div></div>'
        + '</div>';
      return r;
    }

    var b2b = d.btype_ytd||{}, b2bRow = (b2b.B2B||{cnt:0,sum:0}), b2cRow = (b2b.B2C||{cnt:0,sum:0}), totB2b = b2bRow.sum+b2cRow.sum||1;
    var weeks = d.weeks||[], labels = weeks.map(function(w){return w.label_dates || w.label_short || 'Неделя'+String(w.week).padStart(2,'0');});
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
    html += section('ИТОГ (ООМ + КОМ)', d.ytd, wkCurData, wkPrevData, null, d.leads_ytd, wkCurLeads, wkPrevLeads, d.qual_lead_ytd, wkCur.mql || 0, wkPrev.mql || 0);
    html += section('ООМ (Открытое обучение)', d.oom_ytd, oomCurData, oomPrevData, 'oom', d.oom_leads_ytd, wkCur.oom_leads || 0, wkPrev.oom_leads || 0, d.oom_qual_lead_ytd, oomMqlCur, oomMqlPrev);
    html += section('КОМ (Корпоративное обучение)', d.kom_ytd, komCurData, komPrevData, 'kom', d.kom_leads_ytd, (wkCur.leads||0) - (wkCur.oom_leads||0), (wkPrev.leads||0) - (wkPrev.oom_leads||0), d.kom_qual_lead_ytd, komMqlCur, komMqlPrev);

    // Поступления + Форматы
    html += '<div class="twocol" style="margin-top:8px">';
    html += '<div class="card"><h2>Поступления по неделям</h2><div class="chartbox"><canvas id="newChPos"></canvas></div></div>';
    html += '<div class="card"><h2>Форматы</h2><div class="chartbox-sm"><canvas id="newChFmt"></canvas></div><div id="newFmtTableUnderChart" style="margin-top:8px"></div></div>';
    html += '</div>';
    // Стеки воронок — на всю ширину, друг под другом
    html += '<div class="card" style="margin-top:16px"><h2>Воронка (созданные) <span id="stack2_total" style="font-size:13px;color:#475569;font-weight:400"></span></h2><div class="chartbox"><canvas id="newChFunnel2"></canvas></div></div>';
    html += '<div class="card"><h2>Воронка (активные)</h2><div class="chartbox"><canvas id="newChFunnel"></canvas></div></div>';
    // Конверсии
    html += '<div class="card" style="margin-top:8px"><h2>Конверсии воронки <span style="font-size:12px;color:#475569;font-weight:400">Лиды→MQL→SQL→Счёт→Оплата</span></h2><div class="chartbox"><canvas id="newChConv"></canvas></div></div>';

    // Ряд 1: B2B/B2C + Средний чек
    html += '<div class="twocol" style="margin-top:8px">';
    html += '<div class="card"><h2>B2B / B2C</h2><div class="chartbox-sm"><canvas id="newChB2b"></canvas></div><div id="newB2bTable"></div></div>';
    html += '<div class="card"><h2>Средний чек по неделям</h2><div class="chartbox"><canvas id="newChAvg"></canvas></div></div>';
    html += '</div>';
    // Ряд 2: Оплаты/Отказы пончик + Оплаты vs Отказы stacked
    html += '<div class="twocol" style="margin-top:8px">';
    html += '<div class="card"><h2>Оплаты / Отказы</h2><div class="twocol" style="gap:12px">';
    html += '<div><h3 style="text-align:center;font-size:14px;color:#00bcd4;margin-bottom:4px">ООМ</h3><div class="chartbox-sm"><canvas id="newChWlOom"></canvas></div><div id="newChWlOomTbl"></div></div>';
    html += '<div><h3 style="text-align:center;font-size:14px;color:#9C27B0;margin-bottom:4px">КОМ</h3><div class="chartbox-sm"><canvas id="newChWlKom"></canvas></div><div id="newChWlKomTbl"></div></div>';
    html += '</div></div>';
    html += '<div class="card"><h2>Оплаты vs Отказы по неделям</h2><div class="chartbox"><canvas id="newChCnt"></canvas></div></div>';
    html += '</div>';

    html += '<div class="twocol" style="margin-top:8px">';
    html += '<div class="card"><h2>Скорость WON, дн.</h2><div class="chartbox"><canvas id="newChDur"></canvas></div></div>';
    html += '<div class="card"><h2>Скорость Pre Sale, дн.</h2><div class="chartbox"><canvas id="newChPreSale"></canvas></div></div>';
    html += '</div>';

    // B2B table
    var b2bTbl = '<table style="font-size:11px;margin-top:8px"><tr><th>Тип</th><th>Шт</th><th>Сумма</th><th>%</th></tr>'
      +'<tr><td>B2B</td><td>'+b2bRow.cnt+'</td><td>'+fmt(b2bRow.sum)+'</td><td>'+(b2bRow.sum/totB2b*100).toFixed(1)+'%</td></tr>'
      +'<tr><td>B2C</td><td>'+b2cRow.cnt+'</td><td>'+fmt(b2cRow.sum)+'</td><td>'+(b2cRow.sum/totB2b*100).toFixed(1)+'%</td></tr></table>';

    // Tables section — MBA (Тип покупателя — под графиком B2B/B2C, без дублирования)
    html += '<div class="card" style="margin-top:8px"><h3>MBA</h3><div id="newMbaTable"></div></div>';

    html += '<div class="card"><h2>Недельная таблица</h2><div class="scroll-x"><div id="newWeekTable"></div></div></div>';

    // --- Ключевые выводы ---
    var cw = d.weeks ? d.weeks.length : 0;
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

    html += '<div class="card" style="background:linear-gradient(135deg,#f8f9ff,#eef1f8)">';
    html += '<h2>📋 Ключевые выводы</h2>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;line-height:1.6">';
    // Общая картина
    html += '<div><b>📊 Общая картина YTD:</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += '<li>Поступления: <b>'+fmt(ytd.postupleniya)+' ₽</b> ('+ytd.won_relevant_cnt+' сделок)</li>';
    html += '<li>Средний чек: <b>'+fmt(ytd.avg_check)+' ₽</b></li>';
    html += '<li>Срок WON: простой <b>'+(ytd.avg_close_days_won||0).toFixed(1)+' дн.</b> · взвешенный <b>'+(ytd.avg_close_days_won_weighted||ytd.avg_close_days_won||0).toFixed(1)+' дн.</b></li>';
    html += '<li>Лидов: <b>'+fmt(d.leads_ytd)+'</b></li>';
    html += '</ul></div>';
    // Неделя
    html += '<div><b>📈 Неделя W'+cw+':</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += '<li>Поступления: <b>'+fmt(last.postupleniya)+' ₽</b> '+(wkDelta>0?'📈 +':'📉 ')+Math.abs(wkDelta).toFixed(1)+'% к прошлой</li>';
    html += '<li>Сделок: <b>'+(last.won_cnt||0)+'</b></li>';
    html += '<li>Лидов: <b>'+fmt(d.leads_cur||0)+'</b></li>';
    html += '</ul></div>';
    // Лидеры
    html += '<div><b>🏆 Лидеры:</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += '<li>Источник: <b>'+(srcTop.length > 1 ? escapeHtml(srcTop[1].name) : '—')+'</b> ('+fmt(srcTop.length > 1 ? srcTop[1].postupleniya : 0)+' ₽)</li>';
    html += '<li>Формат: <b>'+(fmtData.length > 0 ? escapeHtml(fmtData[0][0]) : '—')+'</b> ('+fmt(fmtData.length > 0 ? fmtData[0][1].sum : 0)+' ₽)</li>';
    html += '<li>'+(mgrTop.length > 0 ? 'Менеджер: <b>'+escapeHtml(mgrTop[0].name)+'</b> ('+fmt(mgrTop[0].postupleniya)+' ₽)' : '')+'</li>';
    html += '</ul></div>';
    // Рекомендации
    html += '<div><b>💡 Рекомендации:</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += (wkDelta < 0 ? '<li>⚠️ Падение недели к прошлой — проанализировать причины</li>' : '<li>✅ Неделя стабильна или растёт</li>');
    html += (srcTop.length > 1 && srcTop[1].conv_lead_deals < 5) ? '<li>🎯 Низкая конверсия лид→сделка — поработать с качеством лидов</li>' : '';
    html += '<li>📌 Средняя скорость закрытия: '+(ytd.median_close_days_won||0)+' дн. (медиана)</li>';
    html += '</ul></div>';
    html += '</div></div>';

    html += '<div class="card"><h2>⚠️ Артефакты данных</h2><div class="sub" style="margin:-8px 0 14px">Аномалии, требующие проверки</div><div id="newArtifactsBlock"><div class="loading-state"><div class="spinner"></div><div>Загрузка…</div></div></div></div>';

    // Batch update all at once
    areaNew.innerHTML = html;

    // Now fill in table data (elements exist now)
    var fmtData = d.fmt_ytd||{};
    var fmtShort = function(n){return n.replace(' (Онлайн)','').replace(' (Очное)','');};
    var fmtStr = '<table style="font-size:11px"><tr><th>Формат</th><th>Сумма</th><th>Шт</th><th>Ср.чек</th></tr>';
    for (var fk in fmtData) {
      if (fk==='period') continue;
      var fv = fmtData[fk];
      fmtStr += '<tr><td>'+fmtShort(escapeHtml(fk))+'</td><td>'+fmt(fv.sum)+' \u20bd</td><td>'+fv.cnt+'</td><td>'+fmt(Math.round(fv.sum/fv.cnt))+' \u20bd</td></tr>';
    }
    fmtStr += '</table>';
    var el = document.getElementById('newFmtTable');
    if (el) el.innerHTML = fmtStr;
    var el2 = document.getElementById('newFmtTableUnderChart');
    if (el2) el2.innerHTML = fmtStr;

    var mbaData = d.mba_rating||[];
    var mbaStr = mbaData.length ? '<table style="font-size:11px"><tr><th>Тип</th><th>Поступления</th><th>Шт</th><th>Ср.чек</th></tr>'+mbaData.map(function(m){return '<tr><td><b>'+escapeHtml(m.type)+'</b></td><td>'+fmt(m.sum)+' \u20bd</td><td>'+m.cnt+'</td><td>'+fmt(m.avg_check)+' \u20bd</td></tr>';}).join('')+'</table>' : '<div style="padding:8px;color:#475569;font-size:12px">Нет данных по MBA</div>';
    el = document.getElementById('newMbaTable'); if(el) el.innerHTML = mbaStr;



    var weekStr = '<table style="font-size:11px"><tr><th>Неделя</th><th>Лиды</th><th>MQL</th><th>SQL</th><th>Счёт</th><th>Оплачено</th><th>Поступл.</th><th>Ср.чек</th><th>Цикл</th><th>Лиды\u2192MQL</th><th>MQL\u2192SQL</th><th>SQL\u2192Счёт</th><th>Счёт\u2192Оплата</th></tr>';
    var tL=0,tM=0,tS=0,tO=0,tP0=0;
    weeks.forEach(function(w){
      weekStr += '<tr><td><b>'+(w.label_dates||'Неделя'+String(w.week).padStart(2,'0'))+'</b></td><td>'+w.leads+'</td><td>'+w.mql+'</td><td>'+w.sql+'</td><td><b>'+(w.invoice_cnt||0)+'</b></td><td><b>'+w.oplata+'</b></td><td>'+fmt(w.postupleniya)+'</td><td>'+fmt(w.avg_check||0)+'</td><td>'+(w.avg_dur||0).toFixed(1)+'</td><td>'+(w.conv_lead_mql||0).toFixed(1)+'%</td><td>'+(w.conv_mql_sql||0).toFixed(1)+'%</td><td>'+(w.conv_sql_invoice||0).toFixed(1)+'%</td><td>'+(w.conv_invoice_oplata||0).toFixed(1)+'%</td></tr>';
      tL+=w.leads||0; tM+=w.mql||0; tS+=w.sql||0; tO+=w.oplata||0; tP0+=w.postupleniya||0;
    });
    weekStr += '<tr style="font-weight:700;border-top:2px solid #333"><td>ИТОГО</td><td>'+tL+'</td><td>'+tM+'</td><td>'+tS+'</td><td>'+tO+'</td><td>'+fmt(tP0)+'</td><td></td><td></td><td></td></tr></table>';
    el = document.getElementById('newWeekTable'); if(el) el.innerHTML = weekStr;



    // Load artifacts
    loadArtifacts();

    // Charts (canvas elements now exist)
    setTimeout(function(){
      if (window.Chart) {
        try {
          if (document.getElementById('newChFunnel2')) new Chart(document.getElementById('newChFunnel2'), {type:'bar', data:{labels:labels,datasets:[{label:'Отказы неКвал',data:weeks.map(function(w){return w.stack2_rej_nq||0;}),backgroundColor:'#880E4F',borderRadius:4,seg:'rej_nq'},{label:'Отказы',data:weeks.map(function(w){return w.stack2_rej||0;}),backgroundColor:'#E53935',borderRadius:4,seg:'rej'},{label:'Не квал',data:weeks.map(function(w){return w.stack2_nq||0;}),backgroundColor:'#FFD54F',borderRadius:4,seg:'nq'},{label:'MQL',data:weeks.map(function(w){return w.stack2_mql||0;}),backgroundColor:'#42A5F5',borderRadius:4,seg:'mql'},{label:'SQL',data:weeks.map(function(w){return w.stack2_sql||0;}),backgroundColor:'#1A237E',borderRadius:4,seg:'sql'},{label:'Счёт',data:weeks.map(function(w){return w.stack2_inv||0;}),backgroundColor:'#7E57C2',borderRadius:4,seg:'inv'},{label:'Оплата',data:weeks.map(function(w){return w.stack2_pay||0;}),backgroundColor:'#43A047',borderRadius:4,seg:'pay'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}},tooltip:{callbacks:{label:function(ctx){var l=ctx.dataset.label||'';var v=ctx.raw||0;var w=weeks[ctx.dataIndex]||{};var s=ctx.dataset.seg||'';var sumKey=s?'stack2_'+s+'_sum':'';var sumVal=sumKey?(w[sumKey]||0):0;var tot=0;['stack2_rej','stack2_rej_nq','stack2_nq','stack2_mql','stack2_sql','stack2_inv','stack2_pay'].map(function(k){tot+=w[k]||0;});var pct=tot>0?(v/tot*100).toFixed(1):0;var txt=l+': '+v+' сд. ('+pct+'%)';if(s==='sql'||s==='inv'||s==='pay'){txt+=' · '+sumVal.toLocaleString('ru-RU')+' ₽';}return txt;}}}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}} });
          if (document.getElementById('newChFunnel')) new Chart(document.getElementById('newChFunnel'), {type:'bar', data:{labels:labels,datasets:[{label:'Отказы неКвал',data:weeks.map(function(w){return w.stack_rej_nq||0;}),backgroundColor:'#880E4F',borderRadius:4,seg:'rej_nq'},{label:'Отказы',data:weeks.map(function(w){return w.stack_rej||0;}),backgroundColor:'#E53935',borderRadius:4,seg:'rej'},{label:'Не квал',data:weeks.map(function(w){return w.stack_nq||0;}),backgroundColor:'#FFD54F',borderRadius:4,seg:'nq'},{label:'MQL',data:weeks.map(function(w){return w.stack_mql||0;}),backgroundColor:'#42A5F5',borderRadius:4,seg:'mql'},{label:'SQL',data:weeks.map(function(w){return w.stack_sql||0;}),backgroundColor:'#1A237E',borderRadius:4,seg:'sql'},{label:'Счёт',data:weeks.map(function(w){return w.stack_inv||0;}),backgroundColor:'#7E57C2',borderRadius:4,seg:'inv'},{label:'Оплата',data:weeks.map(function(w){return w.stack_pay||0;}),backgroundColor:'#43A047',borderRadius:4,seg:'pay'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}},datalabels:{display:false},tooltip:{callbacks:{label:function(ctx){var l=ctx.dataset.label||'';var v=ctx.raw||0;var w=weeks[ctx.dataIndex]||{};var s=ctx.dataset.seg||'';var sumKey=s?'stack_'+s+'_sum':'';var sumVal=sumKey?(w[sumKey]||0):0;var tot=0;['stack_rej','stack_rej_nq','stack_nq','stack_mql','stack_sql','stack_inv','stack_pay'].forEach(function(k){tot+=w[k]||0;});var pct=tot>0?(v/tot*100).toFixed(1):0;var txt=l+': '+v+' сд. ('+pct+'%)';if(s==='sql'||s==='inv'||s==='pay'){txt+=' · '+sumVal.toLocaleString('ru-RU')+' ₽';}return txt;}}}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}} });
        } catch(e){}
        try {
          if (document.getElementById('newChConv')) new Chart(document.getElementById('newChConv'), {type:'line', data:{labels:labels,datasets:[{label:'Лиды\u2192MQL %',data:weeks.map(function(w){return w.conv_lead_mql||0;}),borderColor:'#B0BEC5',tension:0.3,fill:false},{label:'MQL\u2192SQL %',data:weeks.map(function(w){return w.conv_mql_sql||0;}),borderColor:'#3079D2',tension:0.3,fill:false},{label:'SQL\u2192Счёт %',data:weeks.map(function(w){return w.conv_sql_invoice||0;}),borderColor:'#43A047',tension:0.3,fill:false},{label:'Счёт\u2192Оплата %',data:weeks.map(function(w){return w.conv_sql_oplata||0;}),borderColor:'#2E7D32',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
        } catch(e){}
        try {
          if (document.getElementById('newChPos')) new Chart(document.getElementById('newChPos'), {type:'bar', data:{labels:labels,datasets:[{label:'ООМ',data:weeks.map(function(w){return w.oom_postupleniya||0;}),backgroundColor:'#00bcd4',borderRadius:4},{label:'КОМ',data:weeks.map(function(w){return w.kom_postupleniya||0;}),backgroundColor:'#9C27B0',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}},datalabels:{display:'auto',color:'#333',anchor:'end',align:'end',font:{weight:'bold',size:9},formatter:function(v,ctx){var i=ctx.dataIndex;var tot=(weeks[i].oom_postupleniya||0)+(weeks[i].kom_postupleniya||0);return tot?tot.toLocaleString('ru-RU')+' ₽':'';}}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
          // qual funnel
          if (document.getElementById('ch_funnel_new_qual')) new Chart(document.getElementById('ch_funnel_new_qual'), {type:'bar', data:{labels:labels,datasets:[{label:'MQL',data:weeks.map(function(w){return w.mql||0;}),backgroundColor:'#3079D2',borderRadius:4},{label:'SQL',data:weeks.map(function(w){return w.sql||0;}),backgroundColor:'#9A7B3F',borderRadius:4},{label:'Оплачено',data:weeks.map(function(w){return w.oplata||0;}),backgroundColor:'#2E7D32',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
          if (document.getElementById('ch_conv_new_qual')) new Chart(document.getElementById('ch_conv_new_qual'), {type:'line', data:{labels:labels,datasets:[{label:'MQL→SQL %',data:weeks.map(function(w){return w.conv_mql_sql||0;}),borderColor:'#3079D2',tension:0.3,fill:false},{label:'SQL→Сделки %',data:weeks.map(function(w){return w.conv_sql_oplata||0;}),borderColor:'#2E7D32',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
          try {
          if (document.getElementById('newChFmt')){var fl=[],fv=[],fsn=[];var fmtShort=function(n){return n.replace(' (Онлайн)','').replace(' (Очное)','');};for(var fk in fmtData){if(fk==='period')continue;fl.push(fk);fsn.push(fmtShort(fk));fv.push(fmtData[fk].sum||0);}var ftot=fv.reduce(function(a,b){return a+b;},0);new Chart(document.getElementById('newChFmt'),{type:'doughnut',data:{labels:fsn,datasets:[{data:fv,backgroundColor:['#1976D2','#43A047','#FFD54F','#9C27B0']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10}}},datalabels:{color:'#fff',font:{weight:'bold',size:12},formatter:function(v){var p=ftot>0?(v/ftot*100).toFixed(1):0;return p+'%';}}}}});}
          } catch(e){}
        } catch(e){}
        try {
          if (document.getElementById('newChB2b')) new Chart(document.getElementById('newChB2b'),{type:'doughnut',data:{labels:['B2B','B2C'],datasets:[{data:[b2bRow.sum,b2cRow.sum],backgroundColor:['#3079D2','#F57C00']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}},datalabels:{color:'#fff',font:{weight:'bold',size:14},formatter:function(v){var t=b2bRow.sum+b2cRow.sum;return t>0?(v/t*100).toFixed(1)+'%':'';}},tooltip:{callbacks:{label:function(ctx){var i=ctx.dataIndex;var row=i===0?b2bRow:b2cRow;return ctx.label+': '+row.cnt+' шт. · '+fmt(row.sum)+' ₽';}}}}}});
          // B2B/B2C таблица под графиком
          var b2bEl = document.getElementById('newB2bTable');
          if (b2bEl) b2bEl.innerHTML = b2bTbl;
        } catch(e){}
        try {
          var wT=weeks.reduce(function(s,w){return s+(w.won_cnt||0);},0), lT=weeks.reduce(function(s,w){return s+(w.lost_cnt||0);},0);
          var oomW=weeks.reduce(function(s,w){return s+(w.won_cnt||0);},0), oomL=weeks.reduce(function(s,w){return s+(w.lost_cnt||0);},0);
          var komW=weeks.reduce(function(s,w){return s+(w.kom_won_cnt||0);},0), komL=weeks.reduce(function(s,w){return s+(w.kom_lost_cnt||0);},0);
          var oomTot=oomW+oomL||1, komTot=komW+komL||1;
          // ООМ пончик
          if (document.getElementById('newChWlOom')) new Chart(document.getElementById('newChWlOom'),{type:'doughnut',data:{labels:['Оплаты','Отказы'],datasets:[{data:[oomW,oomL],backgroundColor:['#2E7D32','#C62828']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:9}}},datalabels:{color:'#fff',font:{weight:'bold',size:12},formatter:function(v){return (v/oomTot*100).toFixed(1)+'%';}},tooltip:{callbacks:{label:function(ctx){return 'Оплаты: '+(ctx.dataIndex===0?oomW:oomL)+' сд.';}}}}}});
          // КОМ пончик
          if (document.getElementById('newChWlKom')) new Chart(document.getElementById('newChWlKom'),{type:'doughnut',data:{labels:['Оплаты','Отказы'],datasets:[{data:[komW,komL],backgroundColor:['#2E7D32','#C62828']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:9}}},datalabels:{color:'#fff',font:{weight:'bold',size:12},formatter:function(v){return (v/komTot*100).toFixed(1)+'%';}},tooltip:{callbacks:{label:function(ctx){return 'Оплаты: '+(ctx.dataIndex===0?komW:komL)+' сд.';}}}}}});
          // Таблицы
          var oomTbl = '<table style="font-size:11px;width:100%;margin-top:4px"><tr><th>Статус</th><th>Шт</th><th>%</th></tr><tr><td>WON</td><td>'+oomW+'</td><td>'+(oomW/oomTot*100).toFixed(1)+'%</td></tr><tr><td>LOSE</td><td>'+oomL+'</td><td>'+(oomL/oomTot*100).toFixed(1)+'%</td></tr></table>';
          var komTbl = '<table style="font-size:11px;width:100%;margin-top:4px"><tr><th>Статус</th><th>Шт</th><th>%</th></tr><tr><td>WON</td><td>'+komW+'</td><td>'+(komW/komTot*100).toFixed(1)+'%</td></tr><tr><td>LOSE</td><td>'+komL+'</td><td>'+(komL/komTot*100).toFixed(1)+'%</td></tr></table>';
          var oomEl=document.getElementById('newChWlOomTbl'); if(oomEl) oomEl.innerHTML=oomTbl;
          var komEl=document.getElementById('newChWlKomTbl'); if(komEl) komEl.innerHTML=komTbl;
        } catch(e){}
        try {
          if (document.getElementById('newChCnt')) new Chart(document.getElementById('newChCnt'),{type:'bar',data:{labels:labels,datasets:[{label:'Оплаты',data:weeks.map(function(w){return (w.won_cnt||0)+(w.kom_won_cnt||0);}),backgroundColor:'#2E7D32',borderRadius:4},{label:'Отказы',data:weeks.map(function(w){return (w.lost_cnt||0)+(w.kom_lost_cnt||0);}),backgroundColor:'#C62828',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
        } catch(e){}
        try {
          if (document.getElementById('newChAvg')) new Chart(document.getElementById('newChAvg'),{type:'line',data:{labels:labels,datasets:[{label:'Средний чек',data:weeks.map(function(w){return w.avg_check||0;}),borderColor:'#3079D2',backgroundColor:'rgba(48,121,210,.1)',tension:0.3,fill:true},{label:'Медиана',data:weeks.map(function(w){return w.median_check||0;}),borderColor:'#FF9800',borderDash:[6,3],tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
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
    areaNew.innerHTML = '<div class="error-state" style="cursor:pointer" onclick="this.style.display=\'none\'\">\u274c <b>Ошибка вкладки «Новая логика»</b><br>'+escapeHtml(e.message)+'<br><br><small style="color:#999">(нажмите чтобы закрыть, время: ' + new Date().toLocaleTimeString('ru-RU') + ')</small></div>';
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
  const navy = '#093EB4', gold = '#9A7B3F', red = '#C62828', green = '#2E7D32', orange = '#F57C00', blue = '#3079D2';

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
      { label: 'MQL→SQL, %', data: cms, borderColor: blue, backgroundColor: 'rgba(48,121,210,.1)', tension: 0.3, fill: true },
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
      { label: 'MQL→SQL, %', data: cms, borderColor: '#3079D2', backgroundColor: 'rgba(48,121,210,.1)', tension: 0.3, fill: true },
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
    data: { labels: ['Оплаты', 'Отказы'], datasets: [{ data: [wonTotal, lostTotal], backgroundColor: [green, red] }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.label + ': ' + Number(c.parsed).toLocaleString('ru-RU') + ' (доля: ' + (c.parsed/(wonTotal+lostTotal)*100).toFixed(1) + '%)' } } } },
    plugins: [ChartDataLabels]
  });

  // Formats stacked bar (weekly)
  const fmtColorsArr = { "ОМ (Онлайн)": "#43A047", "ООМ (Очное)": "#00bcd4", "СДО": "#F57C00", "КОМ": "#9C27B0" };
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
      { label: 'Оплаты', data: won_n, backgroundColor: green, borderRadius: 4 },
      { label: 'Отказы', data: lost_n, backgroundColor: red, borderRadius: 4 }
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
    data: { labels, datasets: [{ label: 'Pre Sale, дн.', data: presale, borderColor: blue, backgroundColor: 'rgba(48,121,210,.15)', tension: 0.3, fill: true, pointRadius: 3 }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: commonPlugin.tooltip, datalabels: { anchor: 'end', align: 'end', color: blue, font: { size: 8 }, formatter: v => v.toFixed(0) + 'дн' } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' дн.' } } } },
    plugins: [ChartDataLabels]
  });
}

// --- Refresh ---
document.getElementById('refreshBtn').addEventListener('click', async function() {
  this.disabled = true;
  this.textContent = '⏳ Обновление...';
  document.getElementById('loadingFill').style.width = '10%';

  try {
    // Функция безопасного fetch — проверяет, что ответ JSON, а не HTML
    async function safeFetch(url, opts) {
      var resp = await fetch(url, opts);
      if (resp.redirected || resp.url.endsWith('/login')) {
        window.location.href = '/login';
        throw new Error('redirect');
      }
      var text = await resp.text();
      if (text.startsWith('<!DOCTYPE')) {
        window.location.href = '/login';
        throw new Error('redirect');
      }
      return JSON.parse(text);
    }
    
    // Сбросим, если было зависшее состояние
    await safeFetch((window.BASE_PATH || '') + '/api/refresh/reset', { method: 'POST' });
    
    var resData = await safeFetch((window.BASE_PATH || '') + '/api/refresh', { method: 'POST' });
    if (!resData.ok) { alert(resData.message); return; }
    
    // Ждём сколько нужно — без ограничения по времени
    var pollCount = 0;
    var statusEl = document.getElementById('loadingBar');
    var statusText = document.createElement('div');
    statusText.style.cssText = 'text-align:center;font-size:0.85rem;color:#475569;margin-top:4px;';
    statusText.id = 'loadingStatusText';
    var existing = document.getElementById('loadingStatusText');
    if (existing) existing.remove();
    statusEl.after(statusText);
    
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
      }
      
      // Показываем фазу и прогресс
      var progText = '⏳ Загрузка... ' + elapsed;
      if (status.loadingPhase) {
        progText = status.loadingPhase;
        if (status.loadingProgress && status.loadingProgress.total > 0) {
          var pct = Math.round(status.loadingProgress.current / status.loadingProgress.total * 100);
          progText += ' — ' + pct + '% (' + status.loadingProgress.current + ' / ' + status.loadingProgress.total + ')';
        }
        progText += ' • ' + elapsed;
      }
      
      document.getElementById('loadingFill').style.width = Math.min(30 + pollCount * 2, 85) + '%';
      statusText.textContent = progText;
      
      if (status.error && !status.loading) {
        document.getElementById('loadingFill').style.width = '0%';
        statusText.textContent = '';
        alert('Ошибка: ' + status.error);
        break;
      }
      if (status.ready && !status.loading) {
        document.getElementById('loadingFill').style.width = '100%';
        statusText.textContent = '✅ Загружено за ' + elapsed;
        setTimeout(function() { statusText.textContent = ''; }, 5000);
        // loadAll сама загрузит данные и отрендерит
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
});

// --- Date filter ---
document.addEventListener('DOMContentLoaded', function() {
  var filterBtn = document.getElementById('filterBtn');
  if (filterBtn) {
    filterBtn.addEventListener('click', function() {
      renderFilteredData();
    });
  }
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
