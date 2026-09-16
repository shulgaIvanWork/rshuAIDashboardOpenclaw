/**
 * app-export.js — календарь периода, Excel-экспорт, запуск приложения.
 *
 * Грузится ПОСЛЕДНИМ: инициализирует виджет календаря (#periodDisplay → rcPeriod),
 * вешает кнопку экспорта и запускает loadAll() (после того как определены все модули).
 */

// --- Excel-экспорт всех таблиц за выбранный период (как у «Участников») ---
async function exportRatingsExcel() {
  var d = lastRatingsData;
  if (!d) return;
  var period = (document.getElementById('periodDisplay') || {}).value || '';
  var r1 = function(n) { return Math.round((n || 0) * 10) / 10; };

  // Листы МВА / Направления / Продукты - ровно строки и итоги, отрисованные на экране
  // (d._screen, app-render.js). Продукты - полный список за строкой «Остальные»; при выбранном
  // направлении - полный перечень направления. Форматы - по две колонки: штуки и сумма.
  var metricHeader = function(nameLabel) {
    return ['#', nameLabel, 'Лиды', 'Сумма лидов, ₽', 'Сделки', 'Выставленные счета, ₽', 'Поступления, ₽', 'Ср.чек, ₽', 'Цикл, дн', 'Доля, %',
      'Очно, шт', 'Очно, ₽', 'Онлайн, шт', 'Онлайн, ₽', 'Дистанц., шт', 'Дистанц., ₽'];
  };
  var metricRow = function(num, p) {
    return [num, p.name, p.mql||0, p.mql_sum||0, p.cnt||p.deals||0, p.inv_sum||0, p.sum||0, p.avg_check||0, r1(p.avg_won_days), r1(p.share),
      p.fmt_ochn_cnt||0, p.fmt_ochn_sum||0, p.fmt_om_cnt||0, p.fmt_om_sum||0, p.fmt_sdo_cnt||0, p.fmt_sdo_sum||0];
  };
  var metricTotal = function(label, t) {
    return ['', label, t.mql||0, t.mqlSum||0, t.deals||0, t.invSum||0, t.sum||0, t.deals ? Math.round(t.sum/t.deals) : 0, r1(t.avgCycle), 100,
      t.ochn||0, t.ochnS||0, t.om||0, t.omS||0, t.sdo||0, t.sdoS||0];
  };
  var screenSheet = function(name, nameLabel, block, totalLabel) {
    if (!block) return null;
    var rows = block.rows.map(function(p, i){ return metricRow(i+1, p); })
      .concat(block.footers.map(function(p){ return metricRow('', p); }));
    rows.push(metricTotal(totalLabel, block.total));
    return { name: name, header: metricHeader(nameLabel), rows: rows };
  };
  var scr = d._screen || {};
  var prodDir = scr.products && scr.products.dir;
  var mbaSheet  = screenSheet('Семейство МВА', 'Тип', scr.mba, 'ИТОГО');
  var dirSheet  = screenSheet('Направления', 'Направление', scr.dirs, 'ИТОГО (все направления)');
  var prodSheet = screenSheet(prodDir ? ('Продукты - ' + prodDir).replace(/./g, function(ch){ return '[]:*?/'.indexOf(ch) >= 0 || ch.charCodeAt(0) === 92 ? ' ' : ch; }).slice(0, 31) : 'Продукты',
    'Продукт', scr.products, prodDir ? 'ИТОГО (' + prodDir + ')' : 'ИТОГО (все продукты)');

  var pct = function(a,b){ return b ? r1(a/b*100) : 0; };
  var src = (d.src_funnel || []).filter(function(s){ return s.name; });
  var srcSheet = {
    name: 'Источники',
    header: ['Источник','Лиды','Сумма лидов, ₽','MQL','SQL','Счёт','Сделки','Поступления, ₽','Ср.чек, ₽','Цикл, дн','Лиды→MQL, %','MQL→SQL, %','SQL→Счёт, %','Счёт→Сделка, %','Лид→Сделка, %','Тип трафика'],
    rows: src.map(function(s){ return [s.name, s.leads||0, s.mql_sum||0, s.mql||0, s.sql||0, s.invoice_cnt||0, s.deals||0, s.postupleniya||0, s.avg_check||0, r1(s.avg_dur), pct(s.mql,s.leads), pct(s.sql,s.mql), pct(s.invoice_cnt,s.sql), pct(s.deals,s.invoice_cnt), pct(s.deals,s.leads), s.type==='internal'?'ВНБ':(s.type==='marketing'?'МТ':'')]; })
  };

  var comps = (d.top_companies || []).filter(function(c){ return c.name; });
  var compAll = comps.reduce(function(s,c){ return s + (c.sum||0); }, 0) || 1;
  var compSheet = {
    name: 'Компании',
    header: ['#','Компания','Поступления, ₽','Сделок','Сделки ОМ, шт','Сделки ОМ, ₽','Сделки КОМ, шт','Сделки КОМ, ₽','Ср.чек, ₽','Доля, %','Посл. оплата'],
    rows: comps.map(function(c,i){ return [i+1, (typeof shortCompany==='function'?shortCompany(c.name):c.name), c.sum||0, c.cnt||0, c.om_cnt||0, c.om_sum||0, c.kom_cnt||0, c.kom_sum||0, c.avg_check||0, r1((c.sum||0)/compAll*100), c.last_date||'—']; })
  };

  var sheets = [mbaSheet, dirSheet, prodSheet, srcSheet, compSheet].filter(function(s){ return s && s.rows.length; });
  var fileName = 'ratings_' + (period.replace(/[^\d]/g,'_') || new Date().toISOString().substring(0,10)) + '.xlsx';
  try {
    var resp = await fetch((window.BASE_PATH || '') + '/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheets: sheets, fileName: fileName })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var blob = await resp.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  } catch (e) {
    alert('Ошибка экспорта: ' + e.message);
  }
}

// --- Кастомный календарь выбора периода (как в управленческом, /vendor/range-calendar/) ---
// #periodDisplay — видимое поле с попапом; #dateFrom/#dateTo — скрытые ISO-значения,
// которые читает весь фильтр (renderFilteredData). rcPeriod объявлен в app-core.js.
(function() {
  var disp = document.getElementById('periodDisplay');
  if (disp && typeof RangeCalendar !== 'undefined') {
    rcPeriod = RangeCalendar.attach(disp, {
      mode: 'range',
      onApply: function(startISO, endISO) {
        document.getElementById('dateFrom').value = startISO;
        document.getElementById('dateTo').value = endISO;
        renderFilteredData();
      }
    });
  }
  var exBtn = document.getElementById('exportExcelBtn');
  if (exBtn) exBtn.addEventListener('click', exportRatingsExcel);
})();

// Защищённый запуск: ошибка не должна блокировать UI
loadAll().catch(function(e) {
  var area = document.getElementById('contentArea');
  if (area) area.innerHTML = '<div class="error-state">Ошибка загрузки: ' + escapeHtml(e.message) + '<br>Нажмите «Обновить данные»</div>';
  var areaNew = document.getElementById('contentAreaNew');
  if (areaNew) areaNew.innerHTML = areaNew.innerHTML || '<div class="error-state">Ошибка загрузки: ' + escapeHtml(e.message) + '</div>';
});
