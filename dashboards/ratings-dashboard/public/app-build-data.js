/**
 * app-build-data.js — buildFilteredData(): клиентская агрегация среза за период.
 *
 * Из недельных weeks[].by_prod / by_src / by_mba / by_company собирает срез:
 * top_products, all_products, src_rating, mba_rating, top_companies, src_funnel + YTD/cur/prev.
 * ⚠ Любые фильтры (исключить КОМ, конструктор ILP и т.п.) должны дублироваться в analyze.js —
 *   здесь мы лишь суммируем то, что уже отфильтровано в недельной агрегации (см. README).
 * Вызывается из renderFilteredData() (app-core.js).
 */

function buildFilteredData(orig, filteredWeeks, rangeBucket) {
  var out = JSON.parse(JSON.stringify(orig));
  out.weeks = filteredWeeks;
  // Источник корзин и сумм периода: одна корзина за ТОЧНЫЕ даты, если сервер её
  // прислал (/api/data/range), иначе — целые недели, как было раньше. Из-за
  // недельной нарезки «август» превращался в W31-W36 (27.07-06.09) и не сходился
  // с управленческим дашбордом: 133 сделки против 111.
  var bucketWeeks = rangeBucket ? [rangeBucket] : filteredWeeks;

  function sumField(f) {
    return bucketWeeks.reduce(function(s, w) { return s + (w[f] || 0); }, 0);
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
  bucketWeeks.forEach(function(w) {
    ['fmt_oom','fmt_om','fmt_sdo','fmt_kom'].forEach(function(f) {
      if (!fmt_ytd[f]) fmt_ytd[f] = { cnt: 0, sum: 0 };
      fmt_ytd[f].sum += w[f] || 0;
    });
  });
  out.fmt_ytd = fmt_ytd;

  // Агрегируем by_prod, by_src, by_mba из корзин периода
  var prodAgg = {}, srcAgg = {}, mbaAgg = {};
  var avg = function(arr) { return arr.length ? arr.reduce(function(s,x){return s+x;},0)/arr.length : 0; };

  bucketWeeks.forEach(function(w) {
    // by_prod
    Object.entries(w.by_prod || {}).forEach(function(e) {
      var name = e[0], v = e[1];
      if (!prodAgg[name]) prodAgg[name] = {deals:0,sum:0,mql:0,sql:0,fmt_ochn_cnt:0,fmt_ochn_sum:0,fmt_om_cnt:0,fmt_om_sum:0,fmt_sdo_cnt:0,fmt_sdo_sum:0,durs:[],dir:v.dir||'—'};
      if ((!prodAgg[name].dir || prodAgg[name].dir==='—') && v.dir) prodAgg[name].dir = v.dir;
      prodAgg[name].deals += v.deals||0; prodAgg[name].sum += v.sum||0; prodAgg[name].mql += v.mql||0;
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
      if (!mbaAgg[type]) mbaAgg[type] = {cnt:0,sum:0,mql:0,durs:[],fmt_ochn_cnt:0,fmt_ochn_sum:0,fmt_om_cnt:0,fmt_om_sum:0,fmt_sdo_cnt:0,fmt_sdo_sum:0};
      mbaAgg[type].cnt += v.cnt||0; mbaAgg[type].sum += v.sum||0; mbaAgg[type].mql += v.mql||0;
      if (v.durs) mbaAgg[type].durs = mbaAgg[type].durs.concat(v.durs);
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
    return {name:name, deals:v.deals, sum:v.sum, mql:v.mql||0, avg_check:avgCheck,
      avg_won_days:avgDur, share:Math.round(v.sum/totalSum*100*10)/10, dir:v.dir||'—',
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
  out.all_products = prodList;  // полный список с направлением (dir) — для фильтра по направлению

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
  var srcAllDurs = bucketWeeks.flatMap(function(w){return Object.values(w.by_src||{}).flatMap(function(v){return v.durs||[];});});
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
    return {type:type, cnt:v.cnt, sum:v.sum, deals:v.cnt, mql:v.mql||0,
      avg_check:v.cnt?Math.round(v.sum/v.cnt):0,
      avg_won_days:Math.round(avg(v.durs||[])*10)/10,
      fmt_ochn_cnt:v.fmt_ochn_cnt, fmt_ochn_sum:v.fmt_ochn_sum,
      fmt_om_cnt:v.fmt_om_cnt, fmt_om_sum:v.fmt_om_sum,
      fmt_sdo_cnt:v.fmt_sdo_cnt, fmt_sdo_sum:v.fmt_sdo_sum};
  }).sort(function(a,b){return b.sum-a.sum;});

  // Построить top_companies из by_company + маппинг имён из orig
  var companyNames = orig.company_names || {};
  // Дополнить из top_companies на случай если company_names отсутствует (старый кэш)
  (orig.top_companies || []).forEach(function(c) { if (!companyNames[c.id]) companyNames[c.id] = c.name; });
  var compAgg = {};
  bucketWeeks.forEach(function(w) {
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
  bucketWeeks.forEach(function(w){
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
