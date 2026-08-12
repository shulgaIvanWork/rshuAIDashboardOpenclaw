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

  var prods = (d.top_products || []).filter(function(p){ return p.name; });
  var prodSheet = {
    name: 'Продукты',
    header: ['#','Продукт','Лиды','Сделки','Поступления, ₽','Ср.чек, ₽','Цикл, дн','Доля, %','Очно, шт','Онлайн, шт','Дистанц., шт'],
    rows: prods.map(function(p,i){ return [i+1, p.name, p.mql||0, p.cnt||p.deals||0, p.sum||0, p.avg_check||0, r1(p.avg_won_days), r1(p.share), p.fmt_ochn_cnt||0, p.fmt_om_cnt||0, p.fmt_sdo_cnt||0]; })
  };

  var pct = function(a,b){ return b ? r1(a/b*100) : 0; };
  var src = (d.src_funnel || []).filter(function(s){ return s.name; });
  var srcSheet = {
    name: 'Источники',
    header: ['Источник','Лиды','MQL','SQL','Счёт','Сделки','Поступления, ₽','Ср.чек, ₽','Цикл, дн','Лиды→MQL, %','MQL→SQL, %','SQL→Счёт, %','Счёт→Сделка, %','Лид→Сделка, %','Тип трафика'],
    rows: src.map(function(s){ return [s.name, s.leads||0, s.mql||0, s.sql||0, s.invoice_cnt||0, s.deals||0, s.postupleniya||0, s.avg_check||0, r1(s.avg_dur), pct(s.mql,s.leads), pct(s.sql,s.mql), pct(s.invoice_cnt,s.sql), pct(s.deals,s.invoice_cnt), pct(s.deals,s.leads), s.type==='internal'?'ВНБ':(s.type==='marketing'?'МТ':'')]; })
  };

  var comps = (d.top_companies || []).filter(function(c){ return c.name; });
  var compAll = comps.reduce(function(s,c){ return s + (c.sum||0); }, 0) || 1;
  var compSheet = {
    name: 'Компании',
    header: ['#','Компания','Поступления, ₽','Сделок','Сделки ОМ, шт','Сделки КОМ, шт','Ср.чек, ₽','Доля, %','Посл. оплата'],
    rows: comps.map(function(c,i){ return [i+1, (typeof shortCompany==='function'?shortCompany(c.name):c.name), c.sum||0, c.cnt||0, c.om_cnt||0, c.kom_cnt||0, c.avg_check||0, r1((c.sum||0)/compAll*100), c.last_date||'—']; })
  };

  var mba = (d.mba_rating || []);
  var mbaAll = mba.reduce(function(s,m){ return s + (m.sum||0); }, 0) || 1;
  var mbaSheet = {
    name: 'Семейство МВА',
    header: ['Тип','Лиды','Сделки','Поступления, ₽','Ср.чек, ₽','Цикл, дн','Доля, %','Очно, шт','Онлайн, шт','Дистанц., шт'],
    rows: mba.map(function(m){ return [m.type, m.mql||0, m.cnt||m.deals||0, m.sum||0, m.avg_check||0, r1(m.avg_won_days), r1((m.sum||0)/mbaAll*100), m.fmt_ochn_cnt||0, m.fmt_om_cnt||0, m.fmt_sdo_cnt||0]; })
  };

  var sheets = [prodSheet, srcSheet, compSheet, mbaSheet].filter(function(s){ return s.rows.length; });
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
  if (area) area.innerHTML = '<div class="error-state">⚠️ Ошибка загрузки: ' + escapeHtml(e.message) + '<br>Нажмите «Обновить данные»</div>';
  var areaNew = document.getElementById('contentAreaNew');
  if (areaNew) areaNew.innerHTML = areaNew.innerHTML || '<div class="error-state">⚠️ Ошибка загрузки: ' + escapeHtml(e.message) + '</div>';
});
