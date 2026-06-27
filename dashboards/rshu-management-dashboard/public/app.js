function escapeHtml(t){return String(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

function loadArtifacts() {
  fetch((window.BASE_PATH || '') + '/api/artifacts').then(function(r) {
    if (r.status === 403) return null;
    return r.json();
  }).then(function(d) {
    var el = document.getElementById('newArtifactsBlock');
    if (!el || !d) return;
    var s = d.summary || {};
    var hasAny = s.returns?.cnt || s.inProgressPaid?.cnt || s.wonNoPay?.cnt || s.negativeDuration?.cnt ||
      s.otherCatPaid?.cnt || s.nextYear?.cnt || s.formatRule2?.cnt || s.oldActive?.cnt ||
      s.mmbaDeals?.cnt || s.noTypeEdu?.cnt || s.autopayDeals?.cnt;
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
    h += '</table></div>';
    el.innerHTML = h;
  }).catch(function() {});
}

// Автоопределение пути - работает и самостоятельным сайтом, и как sub-app
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
    const d = await api('/api/data');
    if (!d || !d.ytd) return;
    var _lf=document.getElementById('loadingFill');if(_lf)_lf.style.width='100%';
    dataCache = d;

    // Дата обновления в заголовке
    var dateEl = document.getElementById('updateDate');
    if (dateEl && d._loadedAt) {
      var dt = new Date(d._loadedAt);
      var dtStr = dt.toLocaleDateString('ru-RU') + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      dateEl.textContent = '(Данные на: ' + dtStr + ')';
    }

    document.getElementById('dateFrom').value = '2026-01-01';
    var todayStr = new Date().toISOString().substring(0, 10);
    document.getElementById('dateTo').value = todayStr;
    dateFromCache = document.getElementById('dateFrom').value;
    dateToCache = document.getElementById('dateTo').value;

    renderFilteredData();
  } catch (e) {
    console.error('loadAll error:', e);
    if (areaNew) areaNew.innerHTML = '<div class="error-state">❌ Ошибка загрузки: '+escapeHtml(e.message)+'</div>';
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
    infoEl.textContent = 'недели ' + String(filtered[0]?.week||'').padStart(2,'0') + '-' + String(filtered[filtered.length-1]?.week||'').padStart(2,'0') + ' (' + filtered.length + ' из ' + allWeeks.length + ')';
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

  // ООМ YTD - берём из оригинала, переписываем только посчитанные поля
  var oom_ytd = JSON.parse(JSON.stringify(orig.oom_ytd || {}));
  oom_ytd.postupleniya = sumField('oom_postupleniya');
  oom_ytd.won_relevant_cnt = sumField('oom_won_cnt');
  oom_ytd.avg_check = oom_ytd.won_relevant_cnt > 0 ? Math.round(oom_ytd.postupleniya / oom_ytd.won_relevant_cnt) : oom_ytd.avg_check || 0;
  out.oom_ytd = oom_ytd;

  // КОМ YTD - берём из оригинала, переписываем только посчитанные поля
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
  out.kom_leads_ytd = sumField('leads') - sumField('oom_leads');
  out.qual_lead_ytd = sumField('mql');
  out.oom_qual_lead_ytd = sumField('oom_mql');
  out.kom_qual_lead_ytd = sumField('mql') - sumField('oom_mql');

  // Медианный чек - взвешенный по количеству оплат в отфильтрованных неделях
  var totPay = sumField('oplata');
  if (totPay > 0) {
    ytd.median_check = filteredWeeks.reduce(function(s, w) { return s + (w.median_check || 0) * (w.oplata || 0); }, 0) / totPay;
    ytd.avg_close_days_won = filteredWeeks.reduce(function(s, w) { return s + (w.avg_dur || 0) * (w.oplata || 0); }, 0) / totPay;
  }
  out.ytd = ytd;

  // ООМ: пересчёт из понедельных полей
  var oomPay = sumField('oom_won_cnt');
  if (oomPay > 0) {
    oom_ytd.median_check = filteredWeeks.reduce(function(s, w) { return s + (w.oom_median_check || 0) * (w.oom_won_cnt || 0); }, 0) / oomPay;
    oom_ytd.avg_close_days_won = filteredWeeks.reduce(function(s, w) { return s + (w.oom_avg_dur || 0) * (w.oom_won_cnt || 0); }, 0) / oomPay;
  }
  oom_ytd.lose_cnt = sumField('lost_cnt');
  oom_ytd.won_relevant_cnt = oomPay;
  oom_ytd.conv_deal_pct = (oomPay + oom_ytd.lose_cnt) > 0 ? (oomPay / (oomPay + oom_ytd.lose_cnt)) * 100 : 0;
  out.oom_ytd = oom_ytd;

  // КОМ: пересчёт из понедельных полей
  var komPay = sumField('kom_won_cnt');
  if (komPay > 0) {
    kom_ytd.median_check = filteredWeeks.reduce(function(s, w) { return s + (w.kom_median_check || 0) * (w.kom_won_cnt || 0); }, 0) / komPay;
    kom_ytd.avg_close_days_won = filteredWeeks.reduce(function(s, w) { return s + (w.kom_avg_dur || 0) * (w.kom_won_cnt || 0); }, 0) / komPay;
  }
  kom_ytd.lose_cnt = sumField('kom_lost_cnt');
  kom_ytd.won_relevant_cnt = komPay;
  kom_ytd.conv_deal_pct = (komPay + kom_ytd.lose_cnt) > 0 ? (komPay / (komPay + kom_ytd.lose_cnt)) * 100 : 0;
  out.kom_ytd = kom_ytd;

  // Форматы — пересчитываем из понедельных сумм
  var fmtKeyMap = { fmt_oom: 'ООМ (Очное)', fmt_om: 'ОМ (Онлайн)', fmt_sdo: 'СДО', fmt_kom: 'КОМ' };
  var fmt_ytd = {};
  filteredWeeks.forEach(function(w) {
    Object.keys(fmtKeyMap).forEach(function(f) {
      var name = fmtKeyMap[f];
      if (!fmt_ytd[name]) fmt_ytd[name] = { cnt: 0, sum: 0 };
      fmt_ytd[name].sum += w[f] || 0;
    });
  });
  out.fmt_ytd = fmt_ytd;

  // B2B/B2C — пересчитываем из понедельных
  var btype = { B2B: { cnt: 0, sum: 0 }, B2C: { cnt: 0, sum: 0 } };
  filteredWeeks.forEach(function(w) {
    btype.B2B.cnt += w.btype_B2B_cnt || 0;
    btype.B2B.sum += w.btype_B2B_sum || 0;
    btype.B2C.cnt += w.btype_B2C_cnt || 0;
    btype.B2C.sum += w.btype_B2C_sum || 0;
  });
  out.btype_ytd = Object.assign({ period: 'YTD' }, btype);

  // Источники (внутренняя база vs маркетинг) — пересчитываем из понедельных
  var srcIt = { cnt: 0, sum: 0 }, srcMk = { cnt: 0, sum: 0 };
  filteredWeeks.forEach(function(w) {
    srcIt.cnt += w.src_internal_cnt || 0;
    srcIt.sum += w.src_internal_sum || 0;
    srcMk.cnt += w.src_mkt_cnt || 0;
    srcMk.sum += w.src_mkt_sum || 0;
  });
  out.src_split_ytd = { period: 'YTD', internal: srcIt, marketing: srcMk };

  // Тип обучения — пересчитываем из понедельных
  var edu_ytd = {};
  filteredWeeks.forEach(function(w) {
    ['pk','pp','ko'].forEach(function(k) {
      var cnt = w['edu_' + k + '_cnt'] || 0;
      var sum = w['edu_' + k + '_sum'] || 0;
      if (cnt > 0 || sum > 0) {
        if (!edu_ytd[k]) edu_ytd[k] = { cnt: 0, sum: 0 };
        edu_ytd[k].cnt += cnt;
        edu_ytd[k].sum += sum;
      }
    });
  });
  // Преобразуем ключи обратно в читаемые названия
  var eduNameMap = { pk: 'Повышение квалификации', pp: 'Проф. переподготовка', ko: 'Корпоративное обучение' };
  var eduOut = {};
  Object.keys(edu_ytd).forEach(function(k) {
    eduOut[eduNameMap[k] || k] = edu_ytd[k];
  });
  out.edu_ytd = Object.assign({ period: 'YTD' }, eduOut);

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

async function renderPageMainNew(d) {
  var areaNew = document.getElementById('contentAreaNew');
  if (!areaNew) return;
  try {
    if (!d) d = await api('/api/data');
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
      var weekDates = wkCur && wkCur.label_dates ? wkCur.label_dates : '';
      var r = '<div class="kpis"><div class="kpi-header '+cc+'">'+title+'</div>'
        + '<div class="kpi '+kc+'"><div class="lbl">Поступления</div><div class="row"><div class="val-big">'+fmt(ytd.postupleniya)+' \u20bd</div><span class="si">('+fmt(ytd.won_relevant_cnt)+' сд.)</span></div></div>'
        + '<div class="kpi '+kc+'"><div class="lbl">\ud83d\udccb Лиды всего</div><div class="row"><div class="val-big">'+fmt(leadsYtd != null ? leadsYtd : ytd.won_relevant_cnt)+'</div><span class="si">'+((qualLeads/leadsYtd*100).toFixed(1))+'%</span></div><div class="lbl2">квал. лиды (MQL)</div><div class="val-big '+cc+'">'+fmt(qualLeads)+'</div></div>'
        + '<div class="kpi '+kc+'"><div class="lbl">\ud83d\udcc8 Конверсия всего лидов</div><div class="val-big">'+fmtPct(leadsYtd>0?(ytd.won_relevant_cnt/leadsYtd*100):0)+'%</div><div class="lbl2">Конверсия квал. лидов (MQL)</div><div class="val-big '+cc+'">'+fmtPct(qualLeads>0?(ytd.won_relevant_cnt/qualLeads*100):0)+'%</div></div>'
        + '<div class="kpi '+kc+'"><div class="lbl">\ud83d\udcb0 Средний чек</div><div class="val-big">'+fmt(ytd.avg_check)+' \u20bd</div><div class="lbl2">Медианный чек</div><div class="val-big '+cc+'">'+fmt(ytd.median_check)+' \u20bd</div></div>'
        + '<div class="kpi '+kc+'"><div class="lbl">\u0426\u0438\u043a\u043b сделки</div><div class="val-big">'+(ytd.avg_close_days_won||0).toFixed(1)+' дн.</div></div>'
        + '<div class="kpi '+kc+'"><div class="lbl">'+ (weekDates ? weekDates+':' : '') +' поступления</div><div class="row"><div class="val-big">'+fmt(cur.postupleniya)+' \u20bd</div><span class="si">'+delta(cur.postupleniya, prev.postupleniya)+'</span></div><div class="lbl2">Оплачено сделок</div><div class="row"><div class="val-big '+cc+'">'+fmt(cur.won_relevant_cnt)+'</div></div></div>'
        + '<div class="kpi '+kc+'"><div class="lbl">'+ (weekDates ? weekDates+':' : '') +' лиды</div><div class="row"><div class="val-big">'+fmt(leadsCur != null ? leadsCur : cur.won_relevant_cnt)+'</div><span class="si">'+(leadsPrev != null ? delta(leadsCur, leadsPrev) : (prev ? delta(cur.won_relevant_cnt, prev.won_relevant_cnt) : ''))+'</span></div><div class="lbl2">квал. лиды (MQL)</div><div class="row"><div class="val-big '+cc+'">'+fmt(mqlCur != null ? mqlCur : (wkCur ? (wkCur.mql || 0) : 0))+'</div><span class="si">'+(mqlPrev != null ? delta(mqlCur||0, mqlPrev||0) : (wkPrev ? delta(wkCur ? (wkCur.mql||0) : 0, wkPrev ? (wkPrev.mql||0) : 0) : ''))+'</span></div></div>'
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
    html += section('ИТОГО В ПЕРИОДЕ (все типы и форматы)', d.ytd, wkCurData, wkPrevData, null, d.leads_ytd, wkCurLeads, wkPrevLeads, d.qual_lead_ytd, wkCur.mql || 0, wkPrev.mql || 0);
    html += section('Открытое обучение (очное, онлайн и видеокурсы)', d.oom_ytd, oomCurData, oomPrevData, 'oom', d.oom_leads_ytd, wkCur.oom_leads || 0, wkPrev.oom_leads || 0, d.oom_qual_lead_ytd, oomMqlCur, oomMqlPrev);
    html += section('Корпоративное обучение (КОМ)', d.kom_ytd, komCurData, komPrevData, 'kom', d.kom_leads_ytd, (wkCur.leads||0) - (wkCur.oom_leads||0), (wkPrev.leads||0) - (wkPrev.oom_leads||0), d.kom_qual_lead_ytd, komMqlCur, komMqlPrev);
    // Регистрация — сразу под KPI
    html += '<div class="kpis" id="newRegKpis"></div>';

    // Поступления по неделям (на всю ширину)
    html += '<div class="card" style="margin-top:8px"><h2>Поступления по неделям</h2><div style="height:440px;position:relative"><canvas id="newChPos"></canvas></div></div>';
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
    html += '<div class="card" style="margin-top:16px"><h2>Воронка по неделям <span style="font-size:12px;color:#475569;font-weight:400">(созданные и зафиксированные на стадии на той же неделе)</span></h2><div style="height:600px;position:relative"><canvas id="newChFunnel2"></canvas></div></div>';
    // Конверсии

    // Средний чек по неделям (на всю ширину)
    html += '<div class="card" style="margin-top:8px"><h2>Средний чек по неделям</h2><div style="height:440px;position:relative"><canvas id="newChAvg"></canvas></div></div>';

    // B2B table (YTD + неделя)
    var b2bCur = d.btype_cur||{}, b2bCurRow = (b2bCur.B2B||{cnt:0,sum:0}), b2cCurRow = (b2bCur.B2C||{cnt:0,sum:0}), totB2bCur = b2bCurRow.sum+b2cCurRow.sum||1;
    var curB2bWeekLabel = wkCur && wkCur.label_dates ? 'Неделя '+(d.btype_cur?.period||'').replace('W','')+' ('+wkCur.label_dates+')' : (d.btype_cur?.period||'Неделя');
    var avgB2bYtd = b2bRow.cnt > 0 ? Math.round(b2bRow.sum / b2bRow.cnt) : 0;
    var avgB2cYtd = b2cRow.cnt > 0 ? Math.round(b2cRow.sum / b2cRow.cnt) : 0;
    var avgB2bCur = b2bCurRow.cnt > 0 ? Math.round(b2bCurRow.sum / b2bCurRow.cnt) : 0;
    var avgB2cCur = b2cCurRow.cnt > 0 ? Math.round(b2cCurRow.sum / b2cCurRow.cnt) : 0;
    var b2bTbl = '<table style="font-size:11px;margin-top:8px"><tr><th>Период</th><th>Тип</th><th>Шт</th><th>Сумма</th><th>Средний чек</th><th>Доля,%</th></tr>'
      +'<tr><td>За весь период</td><td><span class="dot" style="background:#3079D2"></span>B2B</td><td>'+b2bRow.cnt+'</td><td>'+fmt(b2bRow.sum)+'</td><td>'+fmt(avgB2bYtd)+'</td><td>'+(b2bRow.sum/totB2b*100).toFixed(1)+'%</td></tr>'
      +'<tr><td></td><td><span class="dot" style="background:#F57C00"></span>B2C</td><td>'+b2cRow.cnt+'</td><td>'+fmt(b2cRow.sum)+'</td><td>'+fmt(avgB2cYtd)+'</td><td>'+(b2cRow.sum/totB2b*100).toFixed(1)+'%</td></tr>'
      +'<tr style="border-top:1px dashed #ccc"><td>'+curB2bWeekLabel+'</td><td><span class="dot" style="background:#3079D2"></span>B2B</td><td>'+b2bCurRow.cnt+'</td><td>'+fmt(b2bCurRow.sum)+'</td><td>'+fmt(avgB2bCur)+'</td><td>'+(b2bCurRow.sum/totB2bCur*100).toFixed(1)+'%</td></tr>'
      +'<tr><td></td><td><span class="dot" style="background:#F57C00"></span>B2C</td><td>'+b2cCurRow.cnt+'</td><td>'+fmt(b2cCurRow.sum)+'</td><td>'+fmt(avgB2cCur)+'</td><td>'+(b2cCurRow.sum/totB2bCur*100).toFixed(1)+'%</td></tr>'
      +'</table>';

    // Источники: таблица под графиком
    var srcYtd = d.src_split_ytd||{}, srcCur = d.src_split_cur||{};
    var srcInternal = srcYtd.internal||{cnt:0,sum:0}, srcMkt = srcYtd.marketing||{cnt:0,sum:0};
    var srcIntCur = srcCur.internal||{cnt:0,sum:0}, srcMktCur = srcCur.marketing||{cnt:0,sum:0};
    var srcTot = srcInternal.sum+srcMkt.sum||1, srcTotCur = srcIntCur.sum+srcMktCur.sum||1;
    var curWeekLabel = wkCur && wkCur.label_dates ? 'Неделя '+(srcCur.period||'').replace('W','')+' ('+wkCur.label_dates+')' : (srcCur.period||'Неделя');
    var avgIntYtd = srcInternal.cnt > 0 ? Math.round(srcInternal.sum / srcInternal.cnt) : 0;
    var avgMktYtd = srcMkt.cnt > 0 ? Math.round(srcMkt.sum / srcMkt.cnt) : 0;
    var avgIntCur = srcIntCur.cnt > 0 ? Math.round(srcIntCur.sum / srcIntCur.cnt) : 0;
    var avgMktCur = srcMktCur.cnt > 0 ? Math.round(srcMktCur.sum / srcMktCur.cnt) : 0;
    var srcTbl = '<table style="font-size:11px;margin-top:8px"><tr><th>Период</th><th>Тип</th><th>Шт</th><th>Сумма</th><th>Средний чек</th><th>Доля,%</th></tr>'
      +'<tr><td>За весь период</td><td><span class="dot" style="background:#1f2a44"></span> Внутренняя база</td><td>'+srcInternal.cnt+'</td><td>'+fmt(srcInternal.sum)+'</td><td>'+fmt(avgIntYtd)+'</td><td>'+(srcInternal.sum/srcTot*100).toFixed(1)+'%</td></tr>'
      +'<tr><td></td><td><span class="dot" style="background:#00bcd4"></span> Маркетинговые сделки</td><td>'+srcMkt.cnt+'</td><td>'+fmt(srcMkt.sum)+'</td><td>'+fmt(avgMktYtd)+'</td><td>'+(srcMkt.sum/srcTot*100).toFixed(1)+'%</td></tr>'
      +'<tr style="border-top:1px dashed #ccc"><td>'+curWeekLabel+'</td><td><span class="dot" style="background:#1f2a44"></span> Внутренняя база</td><td>'+srcIntCur.cnt+'</td><td>'+fmt(srcIntCur.sum)+'</td><td>'+fmt(avgIntCur)+'</td><td>'+(srcIntCur.sum/srcTotCur*100).toFixed(1)+'%</td></tr>'
      +'<tr><td></td><td><span class="dot" style="background:#00bcd4"></span> Маркетинговые сделки</td><td>'+srcMktCur.cnt+'</td><td>'+fmt(srcMktCur.sum)+'</td><td>'+fmt(avgMktCur)+'</td><td>'+(srcMktCur.sum/srcTotCur*100).toFixed(1)+'%</td></tr>'
      +'</table>';
        // MBA — перенесён на ratings-dashboard

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
    html += '<li>Источник: <b>'+(srcTop.length > 1 ? escapeHtml(srcTop[1].name) : '-')+'</b> ('+fmt(srcTop.length > 1 ? srcTop[1].postupleniya : 0)+' ₽)</li>';
    html += '<li>Формат: <b>'+(fmtData.length > 0 ? escapeHtml(fmtData[0][0]) : '-')+'</b> ('+fmt(fmtData.length > 0 ? fmtData[0][1].sum : 0)+' ₽)</li>';
    html += '<li>'+(mgrTop.length > 0 ? 'Менеджер: <b>'+escapeHtml(mgrTop[0].name)+'</b> ('+fmt(mgrTop[0].postupleniya)+' ₽)' : '')+'</li>';
    html += '</ul></div>';
    // Рекомендации
    html += '<div><b>💡 Рекомендации:</b><ul style="margin:6px 0 0 18px;color:#444">';
    html += (wkDelta < 0 ? '<li>⚠️ Падение недели к прошлой - проанализировать причины</li>' : '<li>✅ Неделя стабильна или растёт</li>');
    html += (srcTop.length > 1 && srcTop[1].conv_lead_deals < 5) ? '<li>🎯 Низкая конверсия лид→сделка - поработать с качеством лидов</li>' : '';
    html += '<li>📌 Средняя скорость закрытия: '+(ytd.median_close_days_won||0)+' дн. (медиана)</li>';
    html += '</ul></div>';
    html += '</div></div>';

    // Блок артефактов — виден только admin (403 для остальных обрабатывается внутри loadArtifacts)
    html += '<div class="card"><h2>⚠️ Артефакты данных</h2><div class="sub" style="margin:-8px 0 14px">Аномалии, требующие проверки</div><div id="newArtifactsBlock"><div class="loading-state"><div class="spinner"></div><div>Загрузка...</div></div></div></div>';

    // Batch update all at once
    areaNew.innerHTML = html;

    // Артефакты грузятся параллельно — не блокируют рендер
    loadArtifacts();

    // Now fill in table data (elements exist now)
    var fmtData = d.fmt_ytd||{};
    var fmtShort = function(n){return n.replace(' (Онлайн)','').replace(' (Очное)','');};
    var fmtTot = 0;
    for(var ftk in fmtData){if(ftk!=='period')fmtTot+=fmtData[ftk].sum||0;}
    var fmtStr = '<table style="font-size:11px"><tr><th>Формат</th><th>Сумма</th><th>Шт</th><th>Ср.чек</th><th>Доля,%</th></tr>';
    for (var fk in fmtData) {
      if (fk==='period') continue;
      var fv = fmtData[fk];
      fmtStr += '<tr><td>'+fmtShort(escapeHtml(fk))+'</td><td>'+fmt(fv.sum)+' \u20bd</td><td>'+fv.cnt+'</td><td>'+fmt(Math.round(fv.sum/fv.cnt))+' \u20bd</td><td>'+(fmtTot>0?(fv.sum/fmtTot*100).toFixed(1):'0.0')+'%</td></tr>';
    }
    fmtStr += '</table>';
    var el = document.getElementById('newFmtTable');
    if (el) el.innerHTML = fmtStr;
    var el2 = document.getElementById('newFmtTableUnderChart');
    if (el2) el2.innerHTML = fmtStr;

    // Регистрации: KPI
    var reg = d.reg_ytd||{};
    var regConvSql = reg.total > 0 ? (reg.sql/reg.total*100).toFixed(1) : '0.0';
    var regConvInv = reg.total > 0 ? (reg.invoice/reg.total*100).toFixed(1) : '0.0';
    var regKpis = '<div class="kpi-header c-reg">📥 Динамика по источнику «Регистрация»</div><div class="kpi kpi-reg"><div class="lbl">💰 Поступления в периоде</div><div class="row"><div class="val-big">'+fmt(reg.total_paid_sum)+' ₽</div><span class="si">'+reg.total_paid+' сд.</span></div></div>';
    regKpis += '<div class="kpi kpi-reg"><div class="lbl">🔍 Потенциал в SQL</div><div class="row"><div class="val-big">'+fmt(reg.sql_sum)+' ₽</div><span class="si">'+reg.sql+' сд.</span></div></div>';
    regKpis += '<div class="kpi kpi-reg"><div class="lbl">📄 Счёт отправлен</div><div class="row"><div class="val-big">'+fmt(reg.real_inv_sum)+' ₽</div><span class="si">'+reg.real_inv_cnt+' сд.</span></div></div>';
    regKpis += '<div class="kpi kpi-reg"><div class="lbl">✅ Конверсия в оплату</div><div class="val-big">'+reg.conv+'%</div><div class="lbl2">Конверсия в счёт</div><div class="val-big c-reg">'+reg.inv_conv+'%</div></div>';
    regKpis += '<div class="kpi kpi-reg"><div class="lbl">🔴 Доля отказов</div><div class="val-big">'+reg.lose_pct+'%</div><div class="lbl2">'+reg.lose+' из '+reg.total+' сд.</div></div>';
    regKpis += '<div class="kpi kpi-reg"><div class="lbl">💰 Средний чек</div><div class="val-big">'+fmt(reg.avg_check)+' ₽</div></div>';
    regKpis += '<div class="kpi kpi-reg"><div class="lbl">⏱ Цикл сделки</div><div class="val-big">'+reg.avg_dur+' дн.</div><div class="lbl2">Цикл в счет</div><div class="val-big c-reg">'+reg.avg_inv_dur+' дн.</div></div>';
    var regEl = document.getElementById('newRegKpis'); if(regEl) regEl.innerHTML = regKpis;



    // Недельная таблица — снизу вверх (последняя неделя первой)
    var tL=0,tM=0,tS=0,tInv=0,tO=0,tP0=0;
    for(var wi=0; wi<weeks.length; wi++){
      var w = weeks[wi];
      tL+=w.leads||0; tM+=w.mql||0; tS+=w.sql||0; tInv+=w.invoice_cnt||0; tO+=w.oplata||0; tP0+=w.postupleniya||0;
    }
    var tAvgChk = tO > 0 ? tP0 / tO : 0;
    var tDurNum = 0, tDurDen = 0;
    weeks.forEach(function(w){ tDurNum += (w.avg_dur||0) * (w.oplata||0); tDurDen += w.oplata||0; });
    var tAvgDur = tDurDen > 0 ? tDurNum / tDurDen : 0;
    var tCl = tL > 0 ? tM / tL * 100 : 0;
    var tCs = tM > 0 ? tS / tM * 100 : 0;
    var tSi = tS > 0 ? tInv / tS * 100 : 0;
    var tIo = tInv > 0 ? tO / tInv * 100 : 0;
    var tLo = tL > 0 ? tO / tL * 100 : 0;
    var weekStr = '<table style="font-size:11px"><tr><th>Неделя</th><th>Лиды</th><th>MQL</th><th>SQL</th><th>Счёт</th><th>Оплачено</th><th>Поступл.</th><th>Ср.чек</th><th>Цикл</th><th>Лиды\u2192MQL</th><th>MQL\u2192SQL</th><th>SQL\u2192Счёт</th><th>Счёт\u2192Оплата</th><th>Лид\u2192Оплата</th></tr>';
    // ИТОГО первой строкой
    weekStr += '<tr style="background:#eef1f8;font-weight:700;border-top:2px solid #1f2a44;border-bottom:2px solid #1f2a44"><td><b>\uD83D\uDCCA ИТОГО</b></td><td>'+tL+'</td><td>'+tM+'</td><td>'+tS+'</td><td>'+tInv+'</td><td>'+tO+'</td><td>'+fmt(tP0)+'</td><td>'+fmt(tAvgChk)+'</td><td>'+(tAvgDur||0).toFixed(1)+'</td><td>'+tCl.toFixed(1)+'%</td><td>'+tCs.toFixed(1)+'%</td><td>'+tSi.toFixed(1)+'%</td><td>'+tIo.toFixed(1)+'%</td><td>'+tLo.toFixed(1)+'%</td></tr>';
    // Недели
    for(var wi=weeks.length-1; wi>=0; wi--){
      var w = weeks[wi];
      weekStr += '<tr><td><b>'+(w.label_dates||'Неделя'+String(w.week).padStart(2,'0'))+'</b></td><td>'+w.leads+'</td><td>'+w.mql+'</td><td>'+w.sql+'</td><td><b>'+(w.invoice_cnt||0)+'</b></td><td><b>'+w.oplata+'</b></td><td>'+fmt(w.postupleniya)+'</td><td>'+fmt(w.avg_check||0)+'</td><td>'+(w.avg_dur||0).toFixed(1)+'</td><td>'+(w.conv_lead_mql||0).toFixed(1)+'%</td><td>'+(w.conv_mql_sql||0).toFixed(1)+'%</td><td>'+(w.conv_sql_invoice||0).toFixed(1)+'%</td><td>'+(w.conv_invoice_oplata||0).toFixed(1)+'%</td><td>'+(w.leads>0?(w.oplata/w.leads*100).toFixed(1):'0.0')+'%</td></tr>';
    }
    weekStr += '</table>';
    el = document.getElementById('newWeekTable'); if(el) el.innerHTML = weekStr;



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
        try {
          if (document.getElementById('newChFunnel2')) new Chart(document.getElementById('newChFunnel2'), {type:'bar', data:{labels:labels,datasets:[{label:'Отказы неКвал',data:weeks.map(function(w){return w.stack2_rej_nq||0;}),backgroundColor:'#880E4F',borderRadius:4,seg:'rej_nq'},{label:'Отказы',data:weeks.map(function(w){return w.stack2_rej||0;}),backgroundColor:'#E53935',borderRadius:4,seg:'rej'},{label:'Не квал',data:weeks.map(function(w){return w.stack2_nq||0;}),backgroundColor:'#FFD54F',borderRadius:4,seg:'nq'},{label:'MQL',data:weeks.map(function(w){return w.stack2_mql||0;}),backgroundColor:'#42A5F5',borderRadius:4,seg:'mql'},{label:'SQL',data:weeks.map(function(w){return w.stack2_sql||0;}),backgroundColor:'#1A237E',borderRadius:4,seg:'sql'},{label:'Счёт',data:weeks.map(function(w){return w.stack2_inv||0;}),backgroundColor:'#7E57C2',borderRadius:4,seg:'inv'},{label:'Оплата',data:weeks.map(function(w){return w.stack2_pay||0;}),backgroundColor:'#43A047',borderRadius:4,seg:'pay'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10}}},datalabels:{display:function(ctx){return ctx.datasetIndex===ctx.chart.data.datasets.length-1?'auto':false;},color:'#333',anchor:'end',align:'end',font:{weight:'bold',size:10},formatter:function(v,ctx){var i=ctx.dataIndex;var tot=0;['stack2_rej','stack2_rej_nq','stack2_nq','stack2_mql','stack2_sql','stack2_inv','stack2_pay'].forEach(function(k){tot+=weeks[i][k]||0;});return tot?tot+' сд.':'';}},tooltip:{callbacks:{label:function(ctx){var l=ctx.dataset.label||'';var v=ctx.raw||0;var w=weeks[ctx.dataIndex]||{};var s=ctx.dataset.seg||'';var sumKey=s?'stack2_'+s+'_sum':'';var sumVal=sumKey?(w[sumKey]||0):0;var tot=0;['stack2_rej','stack2_rej_nq','stack2_nq','stack2_mql','stack2_sql','stack2_inv','stack2_pay'].map(function(k){tot+=w[k]||0;});var pct=tot>0?(v/tot*100).toFixed(1):0;var txt=l+': '+v+' сд. ('+pct+'%)';if(s==='sql'||s==='inv'||s==='pay'){txt+=' · '+sumVal.toLocaleString('ru-RU')+' ₽';}return txt;}}}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}},plugins:[{id:'legendSpacer',beforeLayout(chart){var leg=chart.legend;if(leg&&!leg.__spacer30){var of=leg.fit.bind(leg);leg.fit=function(){of();this.height+=30;};leg.__spacer30=true;}}}] });
        } catch(e){}
        try {
          if (document.getElementById('newChConv')) new Chart(document.getElementById('newChConv'), {type:'line', data:{labels:labels,datasets:[{label:'Лиды\u2192MQL %',data:weeks.map(function(w){return w.conv_lead_mql||0;}),borderColor:'#B0BEC5',tension:0.3,fill:false},{label:'MQL\u2192SQL %',data:weeks.map(function(w){return w.conv_mql_sql||0;}),borderColor:'#3079D2',tension:0.3,fill:false},{label:'SQL\u2192Счёт %',data:weeks.map(function(w){return w.conv_sql_invoice||0;}),borderColor:'#43A047',tension:0.3,fill:false},{label:'Счёт\u2192Оплата %',data:weeks.map(function(w){return w.conv_sql_oplata||0;}),borderColor:'#2E7D32',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
        } catch(e){}
        try {
          if (document.getElementById('newChPos')) new Chart(document.getElementById('newChPos'), {type:'bar', data:{labels:labels,datasets:[{label:'ООМ',data:weeks.map(function(w){return w.oom_postupleniya||0;}),backgroundColor:'#00bcd4',borderRadius:4},{label:'КОМ',data:weeks.map(function(w){return w.kom_postupleniya||0;}),backgroundColor:'#9C27B0',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10}}},datalabels:{display:false},tooltip:{callbacks:{label:function(ctx){var i=ctx.dataIndex;var v=ctx.raw||0;var oom=weeks[i].oom_postupleniya||0;var kom=weeks[i].kom_postupleniya||0;var tot=oom+kom;if(ctx.datasetIndex===0) return ctx.dataset.label+': '+v.toLocaleString('ru-RU')+' ₽ из '+tot.toLocaleString('ru-RU')+' ₽';if(ctx.datasetIndex===1) return ctx.dataset.label+': '+v.toLocaleString('ru-RU')+' ₽ из '+tot.toLocaleString('ru-RU')+' ₽';return ctx.dataset.label+': '+v.toLocaleString('ru-RU')+' ₽';}}}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
          // qual funnel
          if (document.getElementById('ch_funnel_new_qual')) new Chart(document.getElementById('ch_funnel_new_qual'), {type:'bar', data:{labels:labels,datasets:[{label:'MQL',data:weeks.map(function(w){return w.mql||0;}),backgroundColor:'#3079D2',borderRadius:4},{label:'SQL',data:weeks.map(function(w){return w.sql||0;}),backgroundColor:'#9A7B3F',borderRadius:4},{label:'Оплачено',data:weeks.map(function(w){return w.oplata||0;}),backgroundColor:'#2E7D32',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}}});
          if (document.getElementById('ch_conv_new_qual')) new Chart(document.getElementById('ch_conv_new_qual'), {type:'line', data:{labels:labels,datasets:[{label:'MQL→SQL %',data:weeks.map(function(w){return w.conv_mql_sql||0;}),borderColor:'#3079D2',tension:0.3,fill:false},{label:'SQL→Сделки %',data:weeks.map(function(w){return w.conv_sql_oplata||0;}),borderColor:'#2E7D32',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
          try {
          if (document.getElementById('newChFmt')){var fl=[],fv=[],fsn=[];var fmtShort=function(n){return n.replace(' (Онлайн)','').replace(' (Очное)','');};for(var fk in fmtData){if(fk==='period')continue;fl.push(fk);fsn.push(fmtShort(fk));fv.push(fmtData[fk].sum||0);}var ftot=fv.reduce(function(a,b){return a+b;},0);new Chart(document.getElementById('newChFmt'),{type:'doughnut',data:{labels:fsn,datasets:[{data:fv,backgroundColor:['#1976D2','#43A047','#FFD54F','#9C27B0']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10}}},datalabels:{color:'#fff',font:{weight:'bold',size:12},formatter:function(v){var p=ftot>0?(v/ftot*100).toFixed(1):0;return p+'%';}}}}});}
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
          if (document.getElementById('newChAvg')) {
            var avOom = weeks.map(function(w){return w.oom_avg_check||0;});
            var avKom = weeks.map(function(w){return w.kom_avg_check||0;});
            new Chart(document.getElementById('newChAvg'),{type:'line',data:{labels:labels,datasets:[{label:'ООМ',data:avOom,borderColor:'#00bcd4',tension:0.3,fill:false},{label:'КОМ',data:avKom,borderColor:'#9C27B0',tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});
          }
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




// --- Date filter ---
document.getElementById('dateFrom').addEventListener('change', function() {
  if (document.getElementById('dateTo').value) renderFilteredData();
});
document.getElementById('dateTo').addEventListener('change', function() {
  if (document.getElementById('dateFrom').value) renderFilteredData();
});


// --- Запуск при загрузке страницы ---


// Защищённый запуск: ошибка не должна блокировать UI
loadAll().catch(function(e) {
  var area = document.getElementById('contentArea');
  if (area) area.innerHTML = '<div class="error-state">⚠️ Ошибка загрузки: ' + escapeHtml(e.message) + '<br>Нажмите «Обновить данные»</div>';
  var areaNew = document.getElementById('contentAreaNew');
  if (areaNew) areaNew.innerHTML = areaNew.innerHTML || '<div class="error-state">⚠️ Ошибка загрузки: ' + escapeHtml(e.message) + '</div>';
});


// --- Participants tab ---
