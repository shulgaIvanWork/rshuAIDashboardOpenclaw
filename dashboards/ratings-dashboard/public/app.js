// escapeHtml(), api(), fmt(), fmtPct(), initTableSort(), shortCompany(),
// window.BASE_PATH — всё в /shared.js (подключается перед app.js).
// Здесь оставлены только специфичные для рейтингов хелперы (safeFetch и т.п.).

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

  // Агрегируем by_prod, by_src, by_mba из отфильтрованных недель
  var prodAgg = {}, srcAgg = {}, mbaAgg = {};
  var avg = function(arr) { return arr.length ? arr.reduce(function(s,x){return s+x;},0)/arr.length : 0; };

  filteredWeeks.forEach(function(w) {
    // by_prod
    Object.entries(w.by_prod || {}).forEach(function(e) {
      var name = e[0], v = e[1];
      if (!prodAgg[name]) prodAgg[name] = {deals:0,sum:0,sql:0,fmt_ochn_cnt:0,fmt_ochn_sum:0,fmt_om_cnt:0,fmt_om_sum:0,fmt_sdo_cnt:0,fmt_sdo_sum:0,durs:[]};
      prodAgg[name].deals += v.deals||0; prodAgg[name].sum += v.sum||0;
      prodAgg[name].fmt_ochn_cnt += v.fmt_ochn_cnt||0; prodAgg[name].fmt_ochn_sum += v.fmt_ochn_sum||0;
      prodAgg[name].fmt_om_cnt += v.fmt_om_cnt||0; prodAgg[name].fmt_om_sum += v.fmt_om_sum||0;
      prodAgg[name].fmt_sdo_cnt += v.fmt_sdo_cnt||0; prodAgg[name].fmt_sdo_sum += v.fmt_sdo_sum||0;
      if (v.durs) prodAgg[name].durs = prodAgg[name].durs.concat(v.durs);
    });
    // by_src
    Object.entries(w.by_src || {}).forEach(function(e) {
      var name = e[0], v = e[1];
      if (!srcAgg[name]) srcAgg[name] = {deals:0,sum:0,durs:[]};
      srcAgg[name].deals += v.deals||0; srcAgg[name].sum += v.sum||0;
      if (v.durs) srcAgg[name].durs = srcAgg[name].durs.concat(v.durs);
    });
    // by_mba
    Object.entries(w.by_mba || {}).forEach(function(e) {
      var type = e[0], v = e[1];
      if (!mbaAgg[type]) mbaAgg[type] = {cnt:0,sum:0,fmt_ochn_cnt:0,fmt_ochn_sum:0,fmt_om_cnt:0,fmt_om_sum:0,fmt_sdo_cnt:0,fmt_sdo_sum:0};
      mbaAgg[type].cnt += v.cnt||0; mbaAgg[type].sum += v.sum||0;
      mbaAgg[type].fmt_ochn_cnt += v.fmt_ochn_cnt||0; mbaAgg[type].fmt_ochn_sum += v.fmt_ochn_sum||0;
      mbaAgg[type].fmt_om_cnt += v.fmt_om_cnt||0; mbaAgg[type].fmt_om_sum += v.fmt_om_sum||0;
      mbaAgg[type].fmt_sdo_cnt += v.fmt_sdo_cnt||0; mbaAgg[type].fmt_sdo_sum += v.fmt_sdo_sum||0;
    });
  });

  // Построить top_products
  var totalSum = Object.values(prodAgg).reduce(function(s,v){return s+v.sum;},0) || 1;
  var prodList = Object.entries(prodAgg).map(function(e) {
    var name = e[0], v = e[1];
    var avgCheck = v.deals ? Math.round(v.sum/v.deals) : 0;
    var avgDur = Math.round(avg(v.durs)*10)/10;
    return {name:name, deals:v.deals, sum:v.sum, avg_check:avgCheck,
      avg_won_days:avgDur, share:Math.round(v.sum/totalSum*100*10)/10,
      fmt_ochn_cnt:v.fmt_ochn_cnt, fmt_ochn_sum:v.fmt_ochn_sum,
      fmt_om_cnt:v.fmt_om_cnt, fmt_om_sum:v.fmt_om_sum,
      fmt_sdo_cnt:v.fmt_sdo_cnt, fmt_sdo_sum:v.fmt_sdo_sum};
  }).sort(function(a,b){return b.sum-a.sum;});
  var top20 = prodList.slice(0,20);
  var rest = prodList.slice(20);
  var restSum = rest.reduce(function(s,p){return s+p.sum;},0);
  var restDeals = rest.reduce(function(s,p){return s+p.deals;},0);
  var restCycleNum = rest.reduce(function(s,p){return s+((p.avg_won_days||0)*(p.deals||0));},0);
  var restCycle = restDeals > 0 ? restCycleNum/restDeals : 0;
  if (rest.length) {
    top20.push({name:'📦 Остальные ('+rest.length+' продуктов)', deals:restDeals, sum:restSum, avg_check:restDeals?Math.round(restSum/restDeals):0, avg_won_days:restCycle,
      share:Math.round(restSum/totalSum*100*10)/10,
      fmt_ochn_cnt:rest.reduce(function(s,p){return s+p.fmt_ochn_cnt;},0),
      fmt_ochn_sum:rest.reduce(function(s,p){return s+p.fmt_ochn_sum;},0),
      fmt_om_cnt:rest.reduce(function(s,p){return s+p.fmt_om_cnt;},0),
      fmt_om_sum:rest.reduce(function(s,p){return s+p.fmt_om_sum;},0),
      fmt_sdo_cnt:rest.reduce(function(s,p){return s+p.fmt_sdo_cnt;},0),
      fmt_sdo_sum:rest.reduce(function(s,p){return s+p.fmt_sdo_sum;},0)});
  }
  out.top_products = top20;

  // Построить src_rating — MQL/SQL берём из оригинала по имени источника
  var origSrcByName = {};
  (orig.src_rating || []).forEach(function(s) { origSrcByName[s.name] = s; });
  var srcList = Object.entries(srcAgg).map(function(e) {
    var name = e[0], v = e[1];
    var origS = origSrcByName[name] || {};
    var avgD = Math.round(avg(v.durs)*10)/10;
    var mql = origS.mql||0, sql = origS.sql||0;
    return {name:name, postupleniya:v.sum, deals:v.deals, mql:mql, sql:sql, leads:0,
      avg_check:v.deals?Math.round(v.sum/v.deals):0,
      avg_won_days:avgD,
      conv_mql_sql:mql?Math.round(sql/mql*100*10)/10:0,
      conv_sql_deals:sql?Math.round(v.deals/sql*100*10)/10:0,
      conv_lead_deals:0};
  }).sort(function(a,b){return b.postupleniya-a.postupleniya;});
  var srcTotMql = srcList.reduce(function(s,x){return s+x.mql;},0);
  var srcTotSql = srcList.reduce(function(s,x){return s+x.sql;},0);
  var srcTotDeals = srcList.reduce(function(s,x){return s+x.deals;},0);
  var srcTotSum = srcList.reduce(function(s,x){return s+x.postupleniya;},0);
  var srcAllDurs = filteredWeeks.flatMap(function(w){return Object.values(w.by_src||{}).flatMap(function(v){return v.durs||[];});});
  var srcTotal = {name:'📊 ИТОГО',
    postupleniya:srcTotSum, deals:srcTotDeals, mql:srcTotMql, sql:srcTotSql, leads:0,
    avg_check:srcTotDeals?Math.round(srcTotSum/srcTotDeals):0,
    avg_won_days:Math.round(avg(srcAllDurs)*10)/10,
    conv_mql_sql:srcTotMql?Math.round(srcTotSql/srcTotMql*100*10)/10:0,
    conv_sql_deals:srcTotSql?Math.round(srcTotDeals/srcTotSql*100*10)/10:0,
    conv_lead_deals:0};
  var srcRest = srcList.slice(20);
  var srcRestRow = null;
  if (srcRest.length) {
    var rSum = srcRest.reduce(function(s,x){return s+x.postupleniya;},0);
    var rDeals = srcRest.reduce(function(s,x){return s+x.deals;},0);
    var rMql = srcRest.reduce(function(s,x){return s+x.mql;},0);
    var rSql = srcRest.reduce(function(s,x){return s+x.sql;},0);
    var rCycleNum = srcRest.reduce(function(s,x){return s+((x.avg_won_days||0)*(x.deals||0));},0);
    var rCycle = rDeals > 0 ? rCycleNum/rDeals : 0;
    srcRestRow = {name:'📦 Остальные ('+srcRest.length+' источников)',
      postupleniya:rSum, deals:rDeals, mql:rMql, sql:rSql, leads:0,
      avg_check:rDeals?Math.round(rSum/rDeals):0, avg_won_days:rCycle,
      conv_mql_sql:rMql?Math.round(rSql/rMql*100*10)/10:0,
      conv_sql_deals:rSql?Math.round(rDeals/rSql*100*10)/10:0, conv_lead_deals:0};
  }
  out.src_rating = [srcTotal].concat(srcList.slice(0,20)).concat(srcRestRow?[srcRestRow]:[]);

  // Построить mba_rating
  out.mba_rating = Object.entries(mbaAgg).map(function(e) {
    var type = e[0], v = e[1];
    return {type:type, cnt:v.cnt, sum:v.sum, deals:v.cnt, avg_check:v.cnt?Math.round(v.sum/v.cnt):0,
      fmt_ochn_cnt:v.fmt_ochn_cnt, fmt_ochn_sum:v.fmt_ochn_sum,
      fmt_om_cnt:v.fmt_om_cnt, fmt_om_sum:v.fmt_om_sum,
      fmt_sdo_cnt:v.fmt_sdo_cnt, fmt_sdo_sum:v.fmt_sdo_sum};
  }).sort(function(a,b){return b.sum-a.sum;});

  // Построить top_companies из by_company + маппинг имён из orig
  var companyNames = orig.company_names || {};
  // Дополнить из top_companies на случай если company_names отсутствует (старый кэш)
  (orig.top_companies || []).forEach(function(c) { if (!companyNames[c.id]) companyNames[c.id] = c.name; });
  var compAgg = {};
  filteredWeeks.forEach(function(w) {
    Object.entries(w.by_company || {}).forEach(function(e) {
      var cid = e[0], v = e[1];
      if (!compAgg[cid]) compAgg[cid] = {sum:0,cnt:0,last:null,om_cnt:0,om_sum:0,kom_cnt:0,kom_sum:0};
      compAgg[cid].sum += v.sum||0; compAgg[cid].cnt += v.cnt||0;
      compAgg[cid].om_cnt += v.om_cnt||0; compAgg[cid].om_sum += v.om_sum||0;
      compAgg[cid].kom_cnt += v.kom_cnt||0; compAgg[cid].kom_sum += v.kom_sum||0;
      if (v.last && (!compAgg[cid].last || v.last > compAgg[cid].last)) compAgg[cid].last = v.last;
    });
  });
  var compList = Object.entries(compAgg).filter(function(e){return e[1].sum>0;}).map(function(e) {
    var cid = e[0], v = e[1];
    return {id:cid, name:(companyNames[cid]||'—').slice(0,100), sum:v.sum, cnt:v.cnt,
      om_cnt:v.om_cnt||0, om_sum:v.om_sum||0,
      kom_cnt:v.kom_cnt||0, kom_sum:v.kom_sum||0,
      last_date:v.last||'—', avg_check:v.cnt?Math.round(v.sum/v.cnt):0};
  }).sort(function(a,b){return b.sum-a.sum;});
  var compTop = compList.slice(0,20);
  var compRest = compList.slice(20);
  if (compRest.length) {
    var cRSum = compRest.reduce(function(s,x){return s+x.sum;},0);
    var cRCnt = compRest.reduce(function(s,x){return s+x.cnt;},0);
    var cROmCnt = compRest.reduce(function(s,x){return s+(x.om_cnt||0);},0);
    var cROmSum = compRest.reduce(function(s,x){return s+(x.om_sum||0);},0);
    var cRKomCnt = compRest.reduce(function(s,x){return s+(x.kom_cnt||0);},0);
    var cRKomSum = compRest.reduce(function(s,x){return s+(x.kom_sum||0);},0);
    compTop = compTop.concat([{id:'_rest', name:'📦 Остальные ('+compRest.length+' компаний)',
      sum:cRSum, cnt:cRCnt,
      om_cnt:cROmCnt, om_sum:cROmSum, kom_cnt:cRKomCnt, kom_sum:cRKomSum,
      last_date:'—', avg_check:cRCnt?Math.round(cRSum/cRCnt):0}]);
  }
  out.top_companies = compTop;

  // Источники: полная воронка (без КОМ) — пересчитываем из отфильтрованных недель
  var origFunnelType = {};
  (orig.src_funnel || []).forEach(function(f){ if(f.name&&f.type) origFunnelType[f.name]=f.type; });
  function isSrcInternal(name){ var n=(name||'').toLowerCase(); return ['аккаунтинг','repeat','upsale','реанимаци','холодн','accounting'].some(function(kw){return n.includes(kw);}); }
  var sfAgg={};
  filteredWeeks.forEach(function(w){
    Object.entries(w.by_src||{}).forEach(function(e){
      var sn=e[0], v=e[1];
      if(!sfAgg[sn]) sfAgg[sn]={leads:0,mql:0,sql:0,invoice_cnt:0,deals:0,postupleniya:0,durs:[],type:''};
      sfAgg[sn].leads+=(v.leads||0); sfAgg[sn].mql+=(v.mql||0); sfAgg[sn].sql+=(v.sql||0);
      sfAgg[sn].invoice_cnt+=(v.invoice_cnt||0); sfAgg[sn].deals+=(v.deals||0); sfAgg[sn].postupleniya+=(v.sum||0);
      if(v.durs) sfAgg[sn].durs=sfAgg[sn].durs.concat(v.durs);
      if(!sfAgg[sn].type) sfAgg[sn].type = origFunnelType[sn] || (isSrcInternal(sn)?'internal':'marketing');
    });
  });
  function avg(arr){return arr.length?arr.reduce(function(s,x){return s+x;},0)/arr.length:0;}
  var sfList=Object.entries(sfAgg).filter(function(e){return e[1].postupleniya>0;}).map(function(e){
    var sn=e[0], d=e[1];
    return {name:sn, leads:d.leads, mql:d.mql, sql:d.sql, invoice_cnt:d.invoice_cnt,
      deals:d.deals, postupleniya:d.postupleniya, type:d.type,
      avg_check:d.deals?Math.round(d.postupleniya/d.deals):0,
      avg_dur:avg(d.durs)};
  }).sort(function(a,b){return b.postupleniya-a.postupleniya;});
  var sfTop=sfList.slice(0,20), sfRestList=sfList.slice(20);
  var sfAggFn=function(arr){var r={leads:0,mql:0,sql:0,invoice_cnt:0,deals:0,postupleniya:0};arr.forEach(function(x){r.leads+=x.leads;r.mql+=x.mql;r.sql+=x.sql;r.invoice_cnt+=x.invoice_cnt;r.deals+=x.deals;r.postupleniya+=x.postupleniya;});r.avg_check=r.deals?Math.round(r.postupleniya/r.deals):0;var c=arr.reduce(function(s,x){return s+(x.avg_dur||0)*(x.deals||0);},0);var dc=arr.reduce(function(s,x){return s+(x.deals||0);},0);r.avg_dur=dc?c/dc:0;return r;};
  function mkSfRow(name, data, extra){ var r=Object.assign({name:name, type:''},data); if(extra) Object.assign(r,extra); return r; }
  var sfTopTotal=mkSfRow('📊 ИТОГО (топ-20)', sfAggFn(sfTop));
  var sfAllTotal=mkSfRow('📊 ИТОГО (все без КОМ)', sfAggFn(sfList));
  var sfRestRow=null;
  if(sfRestList.length){
    var rr=sfAggFn(sfRestList); rr.avg_dur=0;
    sfRestRow=mkSfRow('📦 Остальные ('+sfRestList.length+' источников)', rr);
  }
  out.src_funnel=[sfTopTotal, ...sfTop, sfRestRow, sfAllTotal].filter(Boolean);

  return out;
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
        <div class="kpi"><div class="lbl">⏱ Цикл сделки, дн.</div><div class="val">${ytd.avg_close_days_won.toFixed(1)}</div><div class="sub">ср.взв. ${(ytd.avg_close_days_won_weighted || ytd.avg_close_days_won).toFixed(1)} · мед. ${ytd.median_close_days_won} дн.</div></div>
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
        <div class="kpi oom"><div class="lbl">⏱ Цикл сделки, дн.</div><div class="val">${oom_ytd.avg_close_days_won.toFixed(1)}</div><div class="sub">ср.взв. ${(oom_ytd.avg_close_days_won_weighted || oom_ytd.avg_close_days_won).toFixed(1)} · мед. ${oom_ytd.median_close_days_won} дн.</div></div>
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
        <div class="kpi kom"><div class="lbl">⏱ Цикл сделки, дн.</div><div class="val">${kom.avg_close_days_won.toFixed(1)}</div><div class="sub">медиана ${kom.median_close_days_won} дн.</div></div>
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
    <div class="card"><h2>ТОП-20 продуктов <span style="font-size:13px;color:#888;font-weight:400">без КОМ и конструктора · по доле в поступлениях</span></h2>
      <div class="sub" style="margin:-8px 0 14px">Клик по заголовку для сортировки</div>
      <div class="scroll-x"><table class="sortable">
        <thead><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Продукт</th><th class="sort" data-col="2">✅ Оплачено</th><th class="sort" data-col="3">💰 Поступления, ₽</th><th class="sort" data-col="4">💵 Ср.чек, ₽</th><th class="sort" data-col="5">⏱ Цикл,дн</th><th class="sort" data-col="6">📈 Доля</th></tr></thead>
        <tbody>${(data.top_products || []).map((p, i) => {
          const isRem = (p.name || '').includes('Остальные');
          return `<tr${isRem ? " style='background:#f0f4ff;font-weight:700'" : ""}>
            <td>${isRem ? '' : i+1}</td>
            <td style='max-width:260px;white-space:normal'>${(p.name || '').substring(0, 100)}</td>
            <td><b>${p.deals}</b></td>
            <td><b>${fmt(p.sum)}</b> ₽</td>
            <td>${fmt(p.avg_check)}</td>
            <td>${p.avg_won_days.toFixed(1)}</td>
            <td><b>${p.share.toFixed(1)}%</b></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>

    <!-- Top companies -->
    <div class="card"><h2>ТОП-20 компаний по поступлениям</h2>
      <div class="scroll-x" style="max-height:400px;overflow:auto"><table class="sortable">
        <thead><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Компания</th><th class="sort" data-col="2">💰 Поступления, ₽</th><th class="sort" data-col="3">✅ Сделок</th><th class="sort" data-col="4">💵 Ср.чек</th><th class="sort" data-col="5">📊 Доля</th><th class="sort" data-col="6">📅 Последняя покупка</th></tr></thead>
        <tbody>${(function(){
          var allCompSum = (data.top_companies||[]).reduce(function(s,x){return s+(x.sum||0);},0) || 1;
          return (data.top_companies||[]).map(function(c, i){
            return `<tr><td>${i+1}</td><td style="max-width:260px;white-space:normal">${shortCompany(c.name || '—')}</td><td><b>${fmt(c.sum)}</b> ₽</td><td>${c.cnt}</td><td>${fmt(c.avg_check || 0)}</td><td>${(c.sum/allCompSum*100).toFixed(1)}%</td><td>${c.last_date || '—'}</td></tr>`;
          }).join('');
        }())}</tbody>
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
async function renderPageNewLogic() {
  const area = document.getElementById("contentAreaNew");
  area.innerHTML = '<div class="loading-state"><div class="spinner"></div><div>Загрузка новой логики…</div></div>';
  try {
    const data = await api("/api/data/new");
    if (!data.ytd) { area.innerHTML = '<div class="error-state">❌ Нет данных</div>'; return; }
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
    html += '<div class="card" style="margin-top:8px"><h2>ТОП-20 продуктов <span style="font-size:13px;color:#888;font-weight:400">без КОМ и конструктора · по доле в поступлениях</span></h2><div class="sub" style="margin:-8px 0 14px">Клик по заголовку для сортировки</div><div style="overflow-x:auto"><div id="newProductsTable"></div></div></div>';
    // Источники
    html += '<div class="card"><h2>Рейтинг источников поступлений (открытое обучение без КОМ)</h2><div class="sub" style="margin:-8px 0 14px">Клик по заголовку для сортировки</div><div style="overflow-x:auto"><div id="newSrcTable"></div></div></div>';
    html += '<div class="card"><h2>Топ-20 компаний</h2><div class="sub" style="margin:-8px 0 14px">Клик по заголовку для сортировки</div><div style="overflow-x:auto"><div id="newCompaniesTable"></div></div></div>';

    areaNew.innerHTML = html;

    // Fill tables
    var prods = d.top_products||[];
    function fmtFmt(cnt, sum) { return cnt+' / '+fmt(sum)+' р'; }
    // «📦 Остальные» — агрегат хвоста; топ-20 считаем без него, «все продукты» — вместе с ним
    function isRest(p){ return (p.name||'').includes('Остальные'); }
    function totalsOf(list) {
      var deals = list.reduce(function(s,p){return s+(p.deals||p.cnt||0);},0);
      var totalSum = list.reduce(function(s,p){return s+(p.sum||0);},0);
      var cycleNum = list.reduce(function(s,p){return s+((p.avg_won_days||0) * (p.deals||p.cnt||0));},0);
      return {
        deals: deals,
        sum:   totalSum,
        avgCycle: deals > 0 ? cycleNum / deals : 0,
        ochn:  list.reduce(function(s,p){return s+(p.fmt_ochn_cnt||0);},0),
        ochnS: list.reduce(function(s,p){return s+(p.fmt_ochn_sum||0);},0),
        om:    list.reduce(function(s,p){return s+(p.fmt_om_cnt||0);},0),
        omS:   list.reduce(function(s,p){return s+(p.fmt_om_sum||0);},0),
        sdo:   list.reduce(function(s,p){return s+(p.fmt_sdo_cnt||0);},0),
        sdoS:  list.reduce(function(s,p){return s+(p.fmt_sdo_sum||0);},0),
        share: list.reduce(function(s,p){return s+(p.share||0);},0),
      };
    }
    function totalRow(label, t, shareTxt) {
      return '<tr style="background:#fff8e1;font-weight:700"><td></td><td><b>'+label+'</b></td><td><b>'+t.deals+'</b></td><td><b>'+fmt(t.sum)+'</b> ₽</td><td>'+fmt(t.deals?Math.round(t.sum/t.deals):0)+'</td><td>'+(t.avgCycle||0).toFixed(1)+'</td><td><b>'+shareTxt+'</b></td><td>'+fmtFmt(t.ochn,t.ochnS)+'</td><td>'+fmtFmt(t.om,t.omS)+'</td><td>'+fmtFmt(t.sdo,t.sdoS)+'</td></tr>';
    }
    var t20  = totalsOf(prods.filter(function(p){ return p.name && !isRest(p); }));
    var tAll = totalsOf(prods.filter(function(p){ return p.name; }));
    var prodStr = '<table class="sortable" style="font-size:11px"><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Продукт</th><th class="sort" data-col="2">Сделки</th><th class="sort" data-col="3">Поступления, ₽</th><th class="sort" data-col="4">Ср.чек, ₽</th><th class="sort" data-col="5">Цикл сделки, дн.</th><th class="sort" data-col="6">Доля</th><th class="sort" data-col="7">Очно</th><th class="sort" data-col="8">Онлайн</th><th class="sort" data-col="9">Дистанционно</th></tr>';
    prodStr += totalRow('📊 ИТОГО (топ-20)', t20, t20.share.toFixed(1)+'%');
    prods.slice(0,21).forEach(function(p,i){
      if(!p.name) return;
      var isRem = isRest(p);
      var pc=p.cnt||p.deals||0;
      prodStr += '<tr'+(isRem?' style="background:#f0f4ff;font-weight:700"':'')+'><td>'+(isRem?'':(i+1))+'</td><td style="max-width:260px;white-space:normal">'+escapeHtml((p.name||'').substring(0,100))+'</td><td><b>'+pc+'</b></td><td><b>'+fmt(p.sum)+'</b> ₽</td><td>'+fmt(p.avg_check)+'</td><td>'+(p.avg_won_days||0).toFixed(1)+'</td><td><b>'+(p.share||0).toFixed(1)+'%</b></td><td>'+fmtFmt(p.fmt_ochn_cnt||0, p.fmt_ochn_sum||0)+'</td><td>'+fmtFmt(p.fmt_om_cnt||0, p.fmt_om_sum||0)+'</td><td>'+fmtFmt(p.fmt_sdo_cnt||0, p.fmt_sdo_sum||0)+'</td></tr>';
    });
    prodStr += totalRow('📊 ИТОГО (все продукты)', tAll, '100%');
    prodStr += '</table>';
    var el = document.getElementById('newProductsTable'); if(el) el.innerHTML = prodStr;

    // ── Рейтинг источников (полная воронка, без КОМ) ─────────────────────
    var srcFunnel = d.src_funnel || [];
    var sub = d._loadedAt ? '· данные на ' + d._loadedAt.substring(0,10) : '';
    var sfStr = '<table class="table table-sm sortable" style="font-size:11px"><thead><tr>' +
      '<th class="sort" data-col="0">Источник</th>' +
      '<th class="sort" data-col="1">Лиды</th>' +
      '<th class="sort" data-col="2">MQL</th>' +
      '<th class="sort" data-col="3">SQL</th>' +
      '<th class="sort" data-col="4">Счёт</th>' +
      '<th class="sort" data-col="5">Сделки</th>' +
      '<th class="sort" data-col="6">Поступл.</th>' +
      '<th class="sort" data-col="7">Ср.чек</th>' +
      '<th class="sort" data-col="8">Цикл</th>' +
      '<th class="sort" data-col="9">Лиды→MQL</th>' +
      '<th class="sort" data-col="10">MQL→SQL</th>' +
      '<th class="sort" data-col="11">SQL→Счёт</th>' +
      '<th class="sort" data-col="12">Счёт→Сделка</th>' +
      '<th class="sort" data-col="13">Лид→Сделка</th>' +
      '<th class="sort" data-col="14">Тип трафика</th>' +
      '</tr></thead><tbody>';

    function sfRow(r, isTotalRow, idx) {
      if (!r) return '';
      var isRest = (r.name||'').includes('Остальные');
      var isTotal = isTotalRow || (r.name||'').includes('ИТОГО');
      var isFixed = isTotal || isRest;  // не участвует в сортировке
      var bg = isRest ? '#f0f4ff' : (isTotal ? '#fff8e1' : '');
      var rowStyle = bg ? ' style="background:' + bg + ';font-weight:700"' : '';
      if (isFixed) rowStyle = rowStyle.replace('font-weight:700"', 'font-weight:700" class="total-row"');
      var leads = r.leads || 0;
      var mql = r.mql || 0;
      var sql = r.sql || 0;
      var invoice = r.invoice_cnt || 0;
      var deals = r.deals || 0;
      var post = r.postupleniya || 0;
      var avgChk = r.avg_check || 0;
      var avgDur = (r.avg_dur || 0).toFixed(1);
      var clm = leads > 0 ? (mql / leads * 100).toFixed(1) + '%' : '—';
      var cms = mql > 0 ? (sql / mql * 100).toFixed(1) + '%' : '—';
      var csi = sql > 0 ? (invoice / sql * 100).toFixed(1) + '%' : '—';
      var cio = invoice > 0 ? (deals / invoice * 100).toFixed(1) + '%' : '—';
      var clo = leads > 0 ? (deals / leads * 100).toFixed(1) + '%' : '—';
      var typeHtml = '';
      if (!isTotal && !isRest && r.type) {
        var tl = r.type === 'internal' ? 'ВНБ' : 'МТ';
        var tc = r.type === 'internal' ? '#1f2a44' : '#00bcd4';
        typeHtml = '<span style="display:inline-block;background:' + tc + ';color:#fff;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600">' + tl + '</span>';
      } else if (isTotal) {
        typeHtml = '<span style="font-size:10px;color:#475569">Внутренняя база / Маркет. трафик</span>';
      }
      return '<tr' + rowStyle + '><td><b>' + escapeHtml(r.name) + '</b></td>' +
        '<td>' + leads + '</td>' +
        '<td>' + mql + '</td>' +
        '<td>' + sql + '</td>' +
        '<td>' + invoice + '</td>' +
        '<td>' + deals + '</td>' +
        '<td>' + fmt(post) + '</td>' +
        '<td>' + fmt(avgChk) + '</td>' +
        '<td>' + avgDur + '</td>' +
        '<td>' + clm + '</td>' +
        '<td>' + cms + '</td>' +
        '<td>' + csi + '</td>' +
        '<td>' + cio + '</td>' +
        '<td>' + clo + '</td>' +
        '<td>' + typeHtml + '</td></tr>';
    }

    // ИТОГО (топ-20) — всегда первая строка
    if (srcFunnel.length > 0) sfStr += sfRow(srcFunnel[0], true);
    // Топ-20 источников (строки 1..20 из ответа — элементы с 1 по 20)
    for (var si = 1; si < srcFunnel.length - 1; si++) {
      var s = srcFunnel[si];
      if (!s || !s.name) continue;
      if ((s.name||'').includes('Остальные') || (s.name||'').includes('ИТОГО')) continue;
      sfStr += sfRow(s, false, si);
    }
    // Остальные (если есть)
    var sfRest = null;
    for (var si = 0; si < srcFunnel.length; si++) {
      if (srcFunnel[si] && (srcFunnel[si].name||'').includes('Остальные')) {
        sfRest = srcFunnel[si];
        break;
      }
    }
    if (sfRest) sfStr += sfRow(sfRest, true);
    // ИТОГО все
    for (var si = 0; si < srcFunnel.length; si++) {
      if (srcFunnel[si] && (srcFunnel[si].name||'').includes('ИТОГО (все')) {
        sfStr += sfRow(srcFunnel[si], true);
        break;
      }
    }
    sfStr += '</tbody></table>';
    el = document.getElementById('newSrcTable'); if(el) el.innerHTML = sfStr;

    // Сортировка
    if (typeof initTableSort === 'function') initTableSort();


    var comps = d.top_companies || [];
    function isCompRest(c){ return (''+(c.name||'')).includes('Остальные'); }
    function compTotals(list){ return {
      sum:list.reduce(function(s,c){return s+(c.sum||0);},0),
      cnt:list.reduce(function(s,c){return s+(c.cnt||0);},0),
      omCnt:list.reduce(function(s,c){return s+(c.om_cnt||0);},0),
      omSum:list.reduce(function(s,c){return s+(c.om_sum||0);},0),
      komCnt:list.reduce(function(s,c){return s+(c.kom_cnt||0);},0),
      komSum:list.reduce(function(s,c){return s+(c.kom_sum||0);},0),
    }; }
    var ct20  = compTotals(comps.filter(function(c){ return c.name && !isCompRest(c); }));
    var ctAll = compTotals(comps.filter(function(c){ return c.name; }));
    function fmtFmt2(cnt,sum){ return cnt+' / '+fmt(sum)+' ₽'; }
    function compRow(bg, cells, isFixed){ return '<tr'+(bg?' style="background:'+bg+';font-weight:700"':'')+(isFixed?' class="total-row"':'')+'>'+cells+'</tr>'; }
    function compCell(v){ return '<td>'+v+'</td>'; }
    var compStr = '<table class="sortable" style="font-size:11px"><tr><th class="sort" data-col="0">#</th><th class="sort" style="white-space:normal" data-col="1">Компания</th><th class="sort" data-col="2">Поступления</th><th class="sort" data-col="3">Сделок</th><th class="sort" data-col="4">Сделки ОМ</th><th class="sort" data-col="5">Сделки КОМ</th><th class="sort" data-col="6">Ср.чек</th><th class="sort" data-col="7">Доля</th><th class="sort" data-col="8">Посл.&nbsp;оплата</th></tr>';
    var ctAllSum = ctAll.sum || 1;
    compStr += compRow('#fff8e1',
      '<td></td><td><b>📊 ИТОГО (топ-20)</b></td>'
      +compCell(fmt(ct20.sum)+' ₽')+compCell(ct20.cnt)
      +compCell(fmtFmt2(ct20.omCnt,ct20.omSum))+compCell(fmtFmt2(ct20.komCnt,ct20.komSum))
      +compCell(fmt(ct20.cnt?Math.round(ct20.sum/ct20.cnt):0)+' ₽')+compCell((ct20.sum/ctAllSum*100).toFixed(1)+'%')+compCell('—'), true);
    comps.forEach(function(c, i){
      var isRem = isCompRest(c);
      var bg = isRem ? '#f0f4ff' : '';
      var share = (c.sum / ctAllSum * 100).toFixed(1);
      compStr += compRow(bg,
        '<td>'+(isRem?'':(i+1))+'</td><td style="white-space:normal;max-width:300px"><b>'+escapeHtml(shortCompany(c.name))+'</b></td>'
        +compCell(fmt(c.sum)+' ₽')+compCell(c.cnt)
        +compCell(fmtFmt2(c.om_cnt||0,c.om_sum||0))+compCell(fmtFmt2(c.kom_cnt||0,c.kom_sum||0))
        +compCell(fmt(c.avg_check)+' ₽')+compCell(share+'%')+compCell(c.last_date), isRem);
    });
    compStr += compRow('#fff8e1',
      '<td></td><td><b>📊 ИТОГО (все компании)</b></td>'
      +compCell(fmt(ctAll.sum)+' ₽')+compCell(ctAll.cnt)
      +compCell(fmtFmt2(ctAll.omCnt,ctAll.omSum))+compCell(fmtFmt2(ctAll.komCnt,ctAll.komSum))
      +compCell(fmt(ctAll.cnt?Math.round(ctAll.sum/ctAll.cnt):0)+' ₽')+compCell('100%')+compCell('—'), true);
    compStr += '</table>';
    el = document.getElementById('newCompaniesTable'); if(el) el.innerHTML = compStr;

    // ММВА: заполнение
    var mbaData = d.mba_rating||[];
    var mbaTotal = mbaData.reduce(function(s,m){return s+(m.sum||0);},0);
    var mbaDeals = mbaData.reduce(function(s,m){return s+(m.cnt||0);},0);
    var mbaAvg = mbaDeals ? Math.round(mbaTotal / mbaDeals) : 0;
    var mbaOchn = mbaData.reduce(function(s,m){return s+(m.fmt_ochn_cnt||0);},0);
    var mbaOm = mbaData.reduce(function(s,m){return s+(m.fmt_om_cnt||0);},0);
    var mbaSdo = mbaData.reduce(function(s,m){return s+(m.fmt_sdo_cnt||0);},0);
    var mbaOchnSum = mbaData.reduce(function(s,m){return s+(m.fmt_ochn_sum||0);},0);
    var mbaOmSum = mbaData.reduce(function(s,m){return s+(m.fmt_om_sum||0);},0);
    var mbaSdoSum = mbaData.reduce(function(s,m){return s+(m.fmt_sdo_sum||0);},0);
    var mbaStr = mbaData.length ? '<table style="font-size:11px"><tr><th>Тип</th><th>Поступления</th><th>Шт</th><th>Ср.чек</th><th>Доля,%</th><th>Очно</th><th>Онлайн</th><th>Дистанционно</th></tr><tr style="background:#fff8e1;font-weight:700"><td><b>📊 ИТОГО</b></td><td><b>'+fmt(mbaTotal)+' ₽</b></td><td>'+mbaDeals+'</td><td>'+fmt(mbaAvg)+' ₽</td><td>100%</td><td>'+fmtFmt(mbaOchn,mbaOchnSum)+'</td><td>'+fmtFmt(mbaOm,mbaOmSum)+'</td><td>'+fmtFmt(mbaSdo,mbaSdoSum)+'</td></tr>'+mbaData.map(function(m){return '<tr><td><b>'+escapeHtml(m.type)+'</b></td><td>'+fmt(m.sum)+' ₽</td><td>'+m.cnt+'</td><td>'+fmt(m.avg_check)+' ₽</td><td>'+(mbaTotal>0?(m.sum/mbaTotal*100).toFixed(1):'0.0')+'%</td><td>'+fmtFmt(m.fmt_ochn_cnt||0,m.fmt_ochn_sum||0)+'</td><td>'+fmtFmt(m.fmt_om_cnt||0,m.fmt_om_sum||0)+'</td><td>'+fmtFmt(m.fmt_sdo_cnt||0,m.fmt_sdo_sum||0)+'</td></tr>';}).join('')+'</table>' : '<div style="padding:8px;color:#475569;font-size:12px">Нет данных по MBA</div>';
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
