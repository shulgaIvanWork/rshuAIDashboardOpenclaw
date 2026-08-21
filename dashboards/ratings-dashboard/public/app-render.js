/**
 * app-render.js — renderPageMainNew(): отрисовка таблиц среза.
 *
 * Рисует 4 таблицы в #contentAreaNew: Семейство МВА, ТОП-20 продуктов (с фильтром по
 * направлению), Рейтинг источников (полная воронка), Топ-20 компаний. Итоговые строки —
 * в <thead>/<tfoot>, чтобы не всплывать при сортировке (initTableSort из shared.js).
 * Пишет lastRatingsData (app-core.js) для Excel-экспорта. Вызывается из renderFilteredData().
 */

async function renderPageMainNew(d) {
  lastRatingsData = d;
  var areaNew = document.getElementById('contentAreaNew');
  if (!areaNew) return;
  try {
    if (!d) d = await api('/api/data/new');
    if (!d || !d.ytd) { areaNew.innerHTML = '<div class="error-state">Нет данных</div>'; return; }

    var html = '';

    // ММВА — в самый вверх
    html += '<div class="card" style="margin-top:8px"><h3>Продукты Семейства МВА</h3><div id="newMbaTable"></div></div>';

    // Топ-20 продуктов
    html += '<div class="card" style="margin-top:8px"><div class="d-flex align-items-center justify-content-between flex-wrap gap-2"><h2 style="margin:0">ТОП-20 продуктов <span style="font-size:13px;color:#888;font-weight:400">без КОМ и конструктора · по доле в поступлениях</span></h2><label style="font-size:12px;color:#475569">Направление: <select id="prodDirFilter" class="rc-input" style="width:auto;font-size:12px;padding:4px 8px"></select></label></div><div class="sub" style="margin:6px 0 14px">Клик по заголовку для сортировки</div><div style="overflow-x:auto"><div id="newProductsTable"></div></div></div>';
    // Источники
    html += '<div class="card"><h2>Рейтинг источников поступлений (открытое обучение без КОМ)</h2><div class="sub" style="margin:-8px 0 14px">Клик по заголовку для сортировки</div><div style="overflow-x:auto"><div id="newSrcTable"></div></div></div>';
    html += '<div class="card"><h2>Топ-20 компаний</h2><div class="sub" style="margin:-8px 0 14px">Клик по заголовку для сортировки</div><div style="overflow-x:auto"><div id="newCompaniesTable"></div></div></div>';

    areaNew.innerHTML = html;

    // Fill tables
    function fmtFmt(cnt, sum) { return cnt+' / '+fmt(sum)+' р'; }
    // «📦 Остальные» — агрегат хвоста; топ-20 считаем без него, «все продукты» — вместе с ним
    function isRest(p){ return (p.name||'').includes('Остальные'); }
    // Единая «синяя полоска» для таблиц Продукты и Семейство МВА (nameLabel — «Продукт»/«Тип»)
    function prodHeadRow(nameLabel){
      return '<tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">'+nameLabel+'</th><th class="sort" data-col="2">Лиды</th><th class="sort" data-col="3">Сделки</th><th class="sort" data-col="4">Поступления, ₽</th><th class="sort" data-col="5">Ср.чек, ₽</th><th class="sort" data-col="6">Цикл сделки, дн.</th><th class="sort" data-col="7">Доля</th><th class="sort" data-col="8">Очно</th><th class="sort" data-col="9">Онлайн</th><th class="sort" data-col="10">Дистанционно</th></tr>';
    }
    function totalsOf(list) {
      var deals = list.reduce(function(s,p){return s+(p.deals||p.cnt||0);},0);
      var totalSum = list.reduce(function(s,p){return s+(p.sum||0);},0);
      var cycleNum = list.reduce(function(s,p){return s+((p.avg_won_days||0) * (p.deals||p.cnt||0));},0);
      return {
        deals: deals,
        mql:   list.reduce(function(s,p){return s+(p.mql||0);},0),
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
      return '<tr class="total-row" style="background:#fff8e1;font-weight:700"><td></td><td><b>'+label+'</b></td><td><b>'+(t.mql||0)+'</b></td><td><b>'+t.deals+'</b></td><td><b>'+fmt(t.sum)+'</b> ₽</td><td>'+fmt(t.deals?Math.round(t.sum/t.deals):0)+'</td><td>'+(t.avgCycle||0).toFixed(1)+'</td><td><b>'+shareTxt+'</b></td><td>'+fmtFmt(t.ochn,t.ochnS)+'</td><td>'+fmtFmt(t.om,t.omS)+'</td><td>'+fmtFmt(t.sdo,t.sdoS)+'</td></tr>';
    }
    function prodDataRow(p, num, isRem){
      return '<tr'+(isRem?' class="total-row" style="background:#f0f4ff;font-weight:700"':'')+'><td>'+(isRem?'':num)+'</td><td style="max-width:260px;white-space:normal">'+escapeHtml((p.name||'').substring(0,100))+'</td><td>'+(p.mql||0)+'</td><td><b>'+(p.cnt||p.deals||0)+'</b></td><td><b>'+fmt(p.sum)+'</b> ₽</td><td>'+fmt(p.avg_check)+'</td><td>'+(p.avg_won_days||0).toFixed(1)+'</td><td><b>'+(p.share||0).toFixed(1)+'%</b></td><td>'+fmtFmt(p.fmt_ochn_cnt||0, p.fmt_ochn_sum||0)+'</td><td>'+fmtFmt(p.fmt_om_cnt||0, p.fmt_om_sum||0)+'</td><td>'+fmtFmt(p.fmt_sdo_cnt||0, p.fmt_sdo_sum||0)+'</td></tr>';
    }
    // Топ-20 + «Остальные» из полного списка с фильтром по направлению; доли — внутри выборки
    function prodSliceForDir(dir) {
      var all = d.all_products || d.top_products || [];
      // Это рейтинг СДЕЛОК: строки с лидами/MQL, но без единой сделки не показываем.
      var list = (dir ? all.filter(function(p){ return (p.dir||'—')===dir; }) : all)
        .filter(function(p){ return p.name && !isRest(p) && (p.deals||p.cnt||0) > 0; }).slice().sort(function(a,b){ return b.sum-a.sum; });
      var totalSum = list.reduce(function(s,p){ return s+(p.sum||0); }, 0) || 1;
      var withShare = list.map(function(p){ return Object.assign({}, p, { share: Math.round(p.sum/totalSum*100*10)/10 }); });
      var top20 = withShare.slice(0,20), rest = withShare.slice(20);
      if (rest.length) {
        var rs = rest.reduce(function(s,p){return s+(p.sum||0);},0), rd = rest.reduce(function(s,p){return s+(p.deals||0);},0);
        var rcn = rest.reduce(function(s,p){return s+((p.avg_won_days||0)*(p.deals||0));},0);
        var rmql = rest.reduce(function(s,p){return s+(p.mql||0);},0);
        top20.push({ name:'📦 Остальные ('+rest.length+' продуктов)', deals:rd, mql:rmql, sum:rs, avg_check:rd?Math.round(rs/rd):0, avg_won_days:rd?rcn/rd:0, share:Math.round(rs/totalSum*100*10)/10,
          fmt_ochn_cnt:rest.reduce(function(s,p){return s+(p.fmt_ochn_cnt||0);},0), fmt_ochn_sum:rest.reduce(function(s,p){return s+(p.fmt_ochn_sum||0);},0),
          fmt_om_cnt:rest.reduce(function(s,p){return s+(p.fmt_om_cnt||0);},0), fmt_om_sum:rest.reduce(function(s,p){return s+(p.fmt_om_sum||0);},0),
          fmt_sdo_cnt:rest.reduce(function(s,p){return s+(p.fmt_sdo_cnt||0);},0), fmt_sdo_sum:rest.reduce(function(s,p){return s+(p.fmt_sdo_sum||0);},0) });
      }
      return top20;
    }
    function renderProductsTable(dir, attachSort) {
      var prods = prodSliceForDir(dir);
      var t20  = totalsOf(prods.filter(function(p){ return p.name && !isRest(p); }));
      var tAll = totalsOf(prods.filter(function(p){ return p.name; }));
      // thead: шапка + ИТОГО(топ-20) · tbody: данные (сортируются) · tfoot: Остальные + ИТОГО(все) — 3 итоговых статичны
      var prodStr = '<table id="prodTable" class="sortable" style="font-size:11px"><thead>' + prodHeadRow('Продукт');
      prodStr += totalRow('📊 ИТОГО (топ-20)', t20, t20.share.toFixed(1)+'%') + '</thead><tbody>';
      var prodNum = 0;
      prods.forEach(function(p){ if(!p.name || isRest(p)) return; prodNum++; prodStr += prodDataRow(p, prodNum, false); });
      prodStr += '</tbody><tfoot>';
      var prodRest = prods.find(function(p){ return p.name && isRest(p); });
      if (prodRest) prodStr += prodDataRow(prodRest, 0, true);
      prodStr += totalRow('📊 ИТОГО (все продукты)', tAll, '100%');
      prodStr += '</tfoot></table>';
      var el = document.getElementById('newProductsTable'); if(el) el.innerHTML = prodStr;
      // На первом рендере сортировку вешает общий initTableSort() в конце renderPageMainNew;
      // при смене фильтра таблица пересоздаётся — привязываем точечно (attachSort=true).
      if (attachSort && typeof initTableSort === 'function') initTableSort('prodTable');
    }
    // Заполняем селектор направлений (по убыванию поступлений) и вешаем фильтр
    (function(){
      var dirs = {};
      (d.all_products || []).forEach(function(p){ if (p.dir && p.dir !== '—') dirs[p.dir] = (dirs[p.dir]||0) + (p.sum||0); });
      var sorted = Object.keys(dirs).sort(function(a,b){ return dirs[b]-dirs[a]; });
      var sel = document.getElementById('prodDirFilter');
      if (sel) {
        sel.innerHTML = '<option value="">Все направления</option>' + sorted.map(function(nm){ return '<option value="'+escapeHtml(nm)+'">'+escapeHtml(nm)+'</option>'; }).join('');
        sel.onchange = function(){ renderProductsTable(sel.value, true); };
      }
    })();
    renderProductsTable('', false);

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
      '</tr>';

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

    // thead: шапка + ИТОГО(топ-20) · tbody: источники (сортируются) · tfoot: Остальные + ИТОГО(все)
    // — 3 итоговых статичны и не всплывают при сортировке.
    // (На этот момент sfStr = '<table…><thead><tr>…заголовки…</tr>')
    if (srcFunnel.length > 0) sfStr += sfRow(srcFunnel[0], true); // ИТОГО (топ-20) в thead
    sfStr += '</thead><tbody>';
    for (var si = 1; si < srcFunnel.length - 1; si++) {
      var s = srcFunnel[si];
      if (!s || !s.name) continue;
      if ((s.name||'').includes('Остальные') || (s.name||'').includes('ИТОГО')) continue;
      sfStr += sfRow(s, false, si);
    }
    sfStr += '</tbody><tfoot>';
    var sfRest = null;
    for (var si = 0; si < srcFunnel.length; si++) {
      if (srcFunnel[si] && (srcFunnel[si].name||'').includes('Остальные')) { sfRest = srcFunnel[si]; break; }
    }
    if (sfRest) sfStr += sfRow(sfRest, true);
    for (var si = 0; si < srcFunnel.length; si++) {
      if (srcFunnel[si] && (srcFunnel[si].name||'').includes('ИТОГО (все')) {
        sfStr += sfRow(srcFunnel[si], true);
        break;
      }
    }
    sfStr += '</tfoot></table>';
    el = document.getElementById('newSrcTable'); if(el) el.innerHTML = sfStr;

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
    var ctAllSum = ctAll.sum || 1;
    // thead: шапка + ИТОГО(топ-20) · tbody: данные (сортируются) · tfoot: Остальные + ИТОГО(все)
    var compStr = '<table class="sortable" style="font-size:11px"><thead><tr><th class="sort" data-col="0">#</th><th class="sort" style="white-space:normal" data-col="1">Компания</th><th class="sort" data-col="2">Поступления</th><th class="sort" data-col="3">Сделок</th><th class="sort" data-col="4">Сделки ОМ</th><th class="sort" data-col="5">Сделки КОМ</th><th class="sort" data-col="6">Ср.чек</th><th class="sort" data-col="7">Доля</th><th class="sort" data-col="8">Посл.&nbsp;оплата</th></tr>';
    compStr += compRow('#fff8e1',
      '<td></td><td><b>📊 ИТОГО (топ-20)</b></td>'
      +compCell(fmt(ct20.sum)+' ₽')+compCell(ct20.cnt)
      +compCell(fmtFmt2(ct20.omCnt,ct20.omSum))+compCell(fmtFmt2(ct20.komCnt,ct20.komSum))
      +compCell(fmt(ct20.cnt?Math.round(ct20.sum/ct20.cnt):0)+' ₽')+compCell((ct20.sum/ctAllSum*100).toFixed(1)+'%')+compCell('—'), true) + '</thead><tbody>';
    var compNum = 0;
    comps.forEach(function(c){
      if (isCompRest(c)) return;
      compNum++;
      var share = (c.sum / ctAllSum * 100).toFixed(1);
      compStr += compRow('',
        '<td>'+compNum+'</td><td style="white-space:normal;max-width:300px"><b>'+escapeHtml(shortCompany(c.name))+'</b></td>'
        +compCell(fmt(c.sum)+' ₽')+compCell(c.cnt)
        +compCell(fmtFmt2(c.om_cnt||0,c.om_sum||0))+compCell(fmtFmt2(c.kom_cnt||0,c.kom_sum||0))
        +compCell(fmt(c.avg_check)+' ₽')+compCell(share+'%')+compCell(c.last_date), false);
    });
    compStr += '</tbody><tfoot>';
    var compRestRow = comps.find(function(c){ return isCompRest(c); });
    if (compRestRow) {
      var rShare = (compRestRow.sum / ctAllSum * 100).toFixed(1);
      compStr += compRow('#f0f4ff',
        '<td></td><td style="white-space:normal;max-width:300px"><b>'+escapeHtml(compRestRow.name)+'</b></td>'
        +compCell(fmt(compRestRow.sum)+' ₽')+compCell(compRestRow.cnt)
        +compCell(fmtFmt2(compRestRow.om_cnt||0,compRestRow.om_sum||0))+compCell(fmtFmt2(compRestRow.kom_cnt||0,compRestRow.kom_sum||0))
        +compCell(fmt(compRestRow.avg_check)+' ₽')+compCell(rShare+'%')+compCell(compRestRow.last_date||'—'), true);
    }
    compStr += compRow('#fff8e1',
      '<td></td><td><b>📊 ИТОГО (все компании)</b></td>'
      +compCell(fmt(ctAll.sum)+' ₽')+compCell(ctAll.cnt)
      +compCell(fmtFmt2(ctAll.omCnt,ctAll.omSum))+compCell(fmtFmt2(ctAll.komCnt,ctAll.komSum))
      +compCell(fmt(ctAll.cnt?Math.round(ctAll.sum/ctAll.cnt):0)+' ₽')+compCell('100%')+compCell('—'), true);
    compStr += '</tfoot></table>';
    el = document.getElementById('newCompaniesTable'); if(el) el.innerHTML = compStr;

    // Семейство МВА — тот же формат («синяя полоска»), что и ТОП-20: переиспользуем helpers
    var mbaList = (d.mba_rating || []).map(function(m){
      return { name:m.type, deals:m.cnt||m.deals||0, mql:m.mql||0, sum:m.sum||0, avg_check:m.avg_check||0, avg_won_days:m.avg_won_days||0,
        fmt_ochn_cnt:m.fmt_ochn_cnt, fmt_ochn_sum:m.fmt_ochn_sum, fmt_om_cnt:m.fmt_om_cnt, fmt_om_sum:m.fmt_om_sum, fmt_sdo_cnt:m.fmt_sdo_cnt, fmt_sdo_sum:m.fmt_sdo_sum };
    });
    var mbaTotalSum = mbaList.reduce(function(s,p){ return s+(p.sum||0); }, 0) || 1;
    mbaList = mbaList.map(function(p){ return Object.assign({}, p, { share: Math.round(p.sum/mbaTotalSum*100*10)/10 }); })
      .sort(function(a,b){ return b.sum-a.sum; });
    var mbaStr;
    if (mbaList.length) {
      var mbaTot = totalsOf(mbaList);
      mbaStr = '<table id="mbaTable" class="sortable" style="font-size:11px"><thead>' + prodHeadRow('Тип')
        + totalRow('📊 ИТОГО', mbaTot, '100%') + '</thead><tbody>'
        + mbaList.map(function(p, i){ return prodDataRow(p, i+1, false); }).join('')
        + '</tbody></table>';
    } else {
      mbaStr = '<div style="padding:8px;color:#475569;font-size:12px">Нет данных по MBA</div>';
    }
    el = document.getElementById('newMbaTable'); if(el) el.innerHTML = mbaStr;

    // Сортировка — после отрисовки ВСЕХ таблиц (иначе компании/MBA не получают слушателей)
    if (typeof initTableSort === 'function') initTableSort();

  } catch(e) {
    areaNew.innerHTML = '<div class="error-state">❌ <b>Ошибка загрузки</b><br>'+escapeHtml(e.message)+'</div>';
    console.error('renderPageMainNew error:', e);
  }
}
