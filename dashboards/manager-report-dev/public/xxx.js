function renderBars(mgrs) {
  var slices = [
    { title: 'B2B vs B2C', items: [
      {k:'b2b_sum',label:'B2B',color:'#1f2a44'},
      {k:'b2c_sum',label:'B2C',color:'#00bcd4'},
    ]},
    { title: 'Источники (внутренняя база vs маркетинг)', items: [
      {k:'src_int_sum',label:'Внутренняя база',color:'#2e7d32'},
      {k:'src_mkt_sum',label:'Маркетинг',color:'#ff9800'},
    ]},
    { title: 'Форматы обучения', items: [
      {k:'fmt_oom_sum',label:'ООМ (Очное)',color:'#1565c0'},
      {k:'fmt_om_sum',label:'ОМ (Онлайн)',color:'#7b1fa2'},
      {k:'fmt_sdo_sum',label:'СДО',color:'#e65100'},
    ]},
  ];
  var h = '';
  slices.forEach(function(sl){
    h += '<div style="margin-bottom:24px">';
    h += '<h3 style="font-size:13px;margin-bottom:8px;color:#1f2a44">' + sl.title + '</h3>';
    mgrs.forEach(function(m){
      var total = 0;
      sl.items.forEach(function(it){ total += m[it.k] || 0; });
      if (total === 0) return;
      h += '<div style="display:flex;align-items:center;margin:3px 0;gap:8px">';
      h += '<span style="min-width:150px;font-size:11px;font-weight:600;text-align:right;flex-shrink:0">' + e(m.name) + '</span>';
      h += '<div style="flex:1;height:20px;background:#e2e8f0;border-radius:4px;overflow:hidden;display:flex">';
      sl.items.forEach(function(it){
        var val = m[it.k] || 0;
        var pct = val / total * 100;
        if (pct < 2) return;
        h += '<div style="width:' + pct.toFixed(1) + '%;height:100%;background:' + it.color + ';display:inline-block" title="' + it.label + ': ' + n(val) + ' руб (' + pct.toFixed(1) + '%)"></div>';
      });
      h += '</div>';
      h += '<span style="font-size:10px;color:#888;min-width:50px;flex-shrink:0;text-align:right">' + n(total) + ' руб</span>';
      h += '</div>';
    });
    h += '</div>';
  });
  return h;
}

load();