/**
 * app-kpi.js — вкладка «КПЭ» дашборда ДРОП.
 *
 * Карточки за ПОЛНЫЙ месяц (фильтр — выбор месяца, без календаря):
 *   план / факт (₽+шт) / выполнение % / ожидания (₽+шт) / прогноз (₽+шт) /
 *   отклонение ₽ / темп ₽/день / средний чек / цикл сделки.
 * Динамика — к предыдущему месяцу. Разметка карточек — как в renderPageMainNew
 *   вкладки «Продажи»: .lbl → flex(.val-big + span text-success/text-danger ↑/↓) → .pp-val.
 * План вводит админ (POST /api/plans), хранится в data/plans.json.
 *
 * API: GET /api/kpi-month?month=YYYY-MM, GET/POST /api/plans.
 */

// ── Переключение вкладок ─────────────────────────────────────────────────────
// Признак админа и последний ответ /api/kpi-slices. Раньше админ определялся
// чтением editor.style.display: после выбора группы редактор скрывался и обратно
// уже не появлялся, а раскрытие просрочки перезагружало все запросы целиком.
var kpiIsAdmin = false;
var kpiLastSlices = null;

window.switchDashTab = function (tab) {
  var salesBar = document.getElementById('salesFilterBar');
  var sales = document.getElementById('contentAreaNew');
  var kpi = document.getElementById('kpiTab');
  var showKpi = tab === 'kpi';
  if (salesBar) salesBar.style.display = showKpi ? 'none' : '';
  if (sales) sales.style.display = showKpi ? 'none' : '';
  if (kpi) kpi.style.display = showKpi ? '' : 'none';
  document.querySelectorAll('.kpi-tab').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  if (showKpi) loadKpi();
};

// ── Дельта в том же стиле, что на вкладке «Продажи» (pctDelta в app-render.js):
//    <span class="text-success|text-danger|text-body-secondary">↑|↓|→ 12.3%</span>
//    opts.isInv — меньше лучше (цикл сделки); isPp — разница в п.п.; isRub — в ₽.
function kpiDelta(cur, prev, opts) {
  if (cur === undefined || cur === null || prev === undefined || prev === null || prev === 0) return '';
  opts = opts || {};
  var diff = (opts.isRub || opts.isPp) ? (cur - prev) : ((cur - prev) / Math.abs(prev) * 100);
  var p = diff.toFixed(1);
  var s = diff > 0 ? '↑' : (diff < 0 ? '↓' : '→');
  // Плохо: рост для обычных метрик, и падение для «меньше — лучше» (цикл сделки)
  var bad = opts.isInv ? diff > 0 : diff < 0;
  var cl = bad ? 'text-danger' : (diff === 0 ? 'text-body-secondary' : 'text-success');
  var val = Math.abs(diff);
  var txt = opts.isRub ? fmt(val) + ' ₽' : (opts.isPp ? val.toFixed(1) + ' п.п.' : val.toFixed(1) + '%');
  return ' <span class="' + cl + '">' + s + ' ' + txt + '</span>';
}

// ── Инициализация вкладки ────────────────────────────────────────────────────
window.initKpiTab = function () {
  var sel = document.getElementById('kpiMonthSelect');
  var mgrSel = document.getElementById('kpiMgrSelect');
  var editor = document.getElementById('kpiPlanEditor');

  api('/api/data').then(function (d) {
    var year = (d && d.year) || new Date().getFullYear();
    var now = new Date();
    var cur = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var opts = [];
    for (var m = 1; m <= 12; m++) {
      var ms = year + '-' + String(m).padStart(2, '0');
      opts.push('<option value="' + ms + '"' + (ms === cur ? ' selected' : '') + '>' + ms + '</option>');
    }
    sel.innerHTML = opts.join('');
    sel.onchange = loadKpi;
    // Список менеджеров — из срезов (main персонально + нулевые + группы)
    api('/api/kpi-slices?month=' + cur).then(function (s) {
      var rows = (s.managers && s.managers.rows) || [];
      var zero = (s.managers && s.managers.zero_ids) || [];
      var html = '<option value="all">Весь отдел</option>';
      rows.filter(function (r) { return r.group === 'main' && r.id !== 'zero'; })
        .forEach(function (r) { html += '<option value="' + r.id + '">' + escapeHtml(r.name) + '</option>'; });
      zero.forEach(function (z) { html += '<option value="' + z.id + '">' + escapeHtml(z.name) + '</option>'; });
      html += '<option disabled>──────────</option>'
        + '<option value="group:autopay">Автооплаты</option>'
        + '<option value="group:ozk">ОЗК</option>'
        + '<option value="group:bond">Бот</option>'
        + '<option value="group:afanasyev">Афанасьев</option>'
        + '<option value="group:artifact">Артефакт</option>';
      mgrSel.innerHTML = html;
      mgrSel.onchange = loadKpi;
    }).catch(function () { mgrSel.innerHTML = '<option value="all">Весь отдел</option>'; mgrSel.onchange = loadKpi; });
  }).catch(function () { sel.innerHTML = '<option>—</option>'; });

  // Редактор плана — только админам
  api('/api/user').then(function (u) {
    if (u && u.role === 'admin') { kpiIsAdmin = true; editor.style.display = ''; }
  }).catch(function () {});
};

// ── Загрузка и отрисовка ─────────────────────────────────────────────────────
function loadKpi() {
  var sel = document.getElementById('kpiMonthSelect');
  var mgrSel = document.getElementById('kpiMgrSelect');
  var cards = document.getElementById('kpiCards');
  var info = document.getElementById('kpiWorkdaysInfo');
  if (!sel.value) return;
  var mgr = mgrSel ? mgrSel.value : 'all';
  var isPersonal = mgr && mgr !== 'all';
  cards.innerHTML = '<div class="text-center text-secondary py-5" style="grid-column:1/-1"><div class="spinner-border text-primary mb-2" role="status"></div><div>Загрузка…</div></div>';
  api('/api/kpi-month?month=' + sel.value + '&mgr=' + encodeURIComponent(mgr)).then(function (d) {
    var calcTxt = d.calculated_at ? ' · данные от ' + d.calculated_at.substring(0, 16).replace('T', ' ') : '';
    info.textContent = 'рабочих дней в месяце: ' + d.workdays.total + ' · осталось: ' + d.workdays.left + calcTxt;
    // Редактор плана: весь отдел → план отдела; персональный менеджер → личный план;
    // группы (Автооплаты/ОЗК/…) — личных планов нет, редактор скрываем
    var editor = document.getElementById('kpiPlanEditor');
    var isGroup = mgr && mgr.indexOf('group:') === 0;
    if (editor) {
      editor.style.display = (kpiIsAdmin && !isGroup) ? '' : 'none';
      if (!isGroup) {
        document.getElementById('kpiPlanMonth').textContent = d.month + (isPersonal ? ' · личный план' : '');
        document.getElementById('kpiPlanInput').value = d.plan || '';
      }
    }
    cards.innerHTML = renderKpiCards(d, isPersonal);
    loadArtifacts(mgr); // блок «Аномалии данных» (баги выбранного менеджера или отдела)
  }).catch(function (e) {
    cards.innerHTML = '<div class="alert alert-danger" style="grid-column:1/-1">⚠️ Ошибка: ' + escapeHtml(e.message || e) + '</div>';
  });
  // 4 среза: покрытие / недели / менеджеры / календарь
  var slicesEl = document.getElementById('kpiSlices');
  slicesEl.innerHTML = '<div class="text-center text-secondary py-4"><div class="spinner-border text-primary mb-2" role="status"></div><div>Загрузка срезов…</div></div>';
  api('/api/kpi-slices?month=' + sel.value + '&mgr=' + encodeURIComponent(mgr)).then(function (d) {
    renderSlices(d, isPersonal);
  }).catch(function (e) {
    slicesEl.innerHTML = '<div class="alert alert-danger">⚠️ Срезы: ' + escapeHtml(e.message || e) + '</div>';
  });
}

window.saveKpiPlan = function () {
  var sel = document.getElementById('kpiMonthSelect');
  var mgrSel = document.getElementById('kpiMgrSelect');
  var input = document.getElementById('kpiPlanInput');
  var v = input.value === '' ? 0 : parseFloat(input.value);
  var body = { month: sel.value, value: v };
  if (mgrSel && mgrSel.value && mgrSel.value !== 'all' && mgrSel.value.indexOf('group:') !== 0) body.mgr = mgrSel.value;
  fetch((window.BASE_PATH || '') + '/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (r) {
    if (r.status === 403) { alert('Нет прав администратора'); return null; }
    return r.json();
  }).then(function () { loadKpi(); });
};

// Карточка в той же разметке, что KPI-блоки вкладки «Продажи»:
//   .lbl → flex(.val-big + дельта) → .pp-val (предыдущий период)
function kpiCard(label, val, deltaHtml, ppVal, cntTxt) {
  return '<div class="kpi kpi-total"><div class="lbl">' + label + '</div>'
    + '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline"><div class="val-big">' + val + '</div>' + (deltaHtml || '') + '</div>'
    + (cntTxt ? '<div class="sub" style="font-size:12px;color:#0F172A;font-weight:600">' + cntTxt + '</div>' : '')
    + (ppVal ? '<div class="pp-val">' + ppVal + '</div>' : '')
    + '</div>';
}

function renderKpiCards(d, isPersonal) {
  var c = [];
  var sign = function (n) { return n > 0 ? '+' + fmt(n) : fmt(n); };
  // В персональном режиме без личного плана план-зависимые карточки скрываем
  var hidePlan = isPersonal && !d.plan_set;

  // 1. План
  if (!hidePlan) {
    c.push(kpiCard('План поступлений, ₽', fmt(d.plan),
      kpiDelta(d.plan, d.prev_plan),
      d.prev_plan ? 'пред. месяц: ' + fmt(d.prev_plan) : ''));
  }

  // 2. Факт
  c.push(kpiCard('Факт поступлений, ₽', fmt(d.fact.sum),
    kpiDelta(d.fact.sum, d.prev_fact.sum),
    'пред. месяц: ' + fmt(d.prev_fact.sum) + ' · ' + d.prev_fact.cnt + ' шт.',
    d.fact.cnt + ' шт.'));

  // 3. Выполнение плана
  if (!hidePlan) {
    c.push(kpiCard('Выполнение плана, %', d.pct === null ? '—' : fmtPct(d.pct) + '%',
      (d.pct !== null && d.prev_pct !== null) ? kpiDelta(d.pct, d.prev_pct, { isPp: true }) : '',
      d.prev_pct === null ? '' : 'пред. месяц: ' + fmtPct(d.prev_pct) + '%'));
  }

  // 4. Прогноз выполнения плана (с учётом ожиданий)
  if (!hidePlan) {
    c.push(kpiCard('Прогноз выполнения плана, %', d.pct_forecast === null ? '—' : fmtPct(d.pct_forecast) + '%',
      (d.pct_forecast !== null && d.prev_pct_forecast !== null) ? kpiDelta(d.pct_forecast, d.prev_pct_forecast, { isPp: true }) : '',
      d.prev_pct_forecast === null ? '' : 'пред. месяц: ' + fmtPct(d.prev_pct_forecast) + '%'));
  }

  // 5. План на дату: равномерная раскладка плана по рабочим дням; рядом — отставание/опережение факта
  if (!hidePlan) {
    var gapTxt = '';
    if (d.plan_on_date > 0) {
      var gap = d.fact_gap;
      var gapCl = gap < 0 ? 'text-danger' : 'text-success';
      var gapSign = gap > 0 ? '+' : '';
      gapTxt = ' <span class="' + gapCl + '">' + gapSign + fmt(gap) + ' ₽</span>';
    }
    c.push(kpiCard('План на дату, ₽', fmt(d.plan_on_date), gapTxt,
      'прошло ' + d.passed_wd + ' из ' + d.workdays.total + ' раб. дней'));
  }

  // 6. Ожидания (актуальные + переходящие просроченные)
  var ovdTxt = d.expect_overdue && d.expect_overdue.sum > 0
    ? ' · просрочено: ' + fmt(d.expect_overdue.sum) + ' ₽ / ' + d.expect_overdue.cnt + ' шт.' : '';
  c.push(kpiCard('Ожидания в периоде, ₽', fmt(d.expect.sum),
    kpiDelta(d.expect.sum, d.prev_expect.sum),
    'пред. месяц: ' + fmt(d.prev_expect.sum) + ' · ' + d.prev_expect.cnt + ' шт.',
    d.expect.cnt + ' шт.' + ovdTxt));

  // 7. Прогноз
  c.push(kpiCard('Прогноз до конца месяца, ₽', fmt(d.forecast.sum),
    kpiDelta(d.forecast.sum, d.prev_forecast.sum),
    'пред. месяц: ' + fmt(d.prev_forecast.sum) + ' · ' + d.prev_forecast.cnt + ' шт.',
    d.forecast.cnt + ' шт.'));

  // 8. Отклонение (прогноз − план)
  if (!hidePlan) {
    c.push(kpiCard('Отклонение от плана, ₽', sign(d.diff),
      kpiDelta(d.diff, d.prev_diff, { isRub: true }),
      d.prev_plan ? 'пред. месяц: ' + sign(d.prev_diff) : ''));
  }

  // 9. Темп (пред. периода нет)
  if (!hidePlan) {
    c.push(kpiCard('Необходимый темп, ₽/день', d.pace === null ? '—' : fmt(d.pace),
      '',
      'осталось раб. дней: ' + d.workdays.left + ' · (план − факт − ожид.) ÷ дни'));
  }

  // 10. Потенциал: текущий срез воронки (SQL — сумма+штуки, MQL — штуки)
  c.push(kpiCard('Потенциал (SQL), ₽', fmt(d.potential.sql.sum), '',
    'на сегодня · SQL: ' + d.potential.sql.cnt + ' шт. · MQL: ' + d.potential.mql_cnt + ' шт.'));

  // 11. Средний чек
  c.push(kpiCard('Средний чек, ₽', fmt(d.avg_check),
    kpiDelta(d.avg_check, d.prev_avg_check),
    'пред. месяц: ' + fmt(d.prev_avg_check)));

  // 12. Цикл сделки (меньше — лучше)
  c.push(kpiCard('Цикл сделки, дн.', (d.cycle || 0).toFixed(1),
    kpiDelta(d.cycle, d.prev_cycle, { isInv: true }),
    'пред. месяц: ' + (d.prev_cycle || 0).toFixed(1) + ' дн.'));

  return c.join('');
}

// ── 4 среза: покрытие (bullet) / недели (combo) / менеджеры (h-stacked) / календарь (v-bar) ──
var kpiChartInstances = {};
var KPI_COLORS = {
  fact: '#2E7D32',        // зелёный — факт (оплаты)
  actual: '#9C27B0',      // фиолетовый — ожидания с актуальной датой (как «Счёт отправлен»/КОМ)
  overdue: '#F57C00',     // оранжевый — просроченные ожидания (проблемный)
  deficit: 'rgba(245,124,0,.30)', // полупрозрачный оранжевый — непокрытый остаток
  plan: '#093EB4',        // синий — маркер/линия плана
};

function kpiChartDestroy(id) {
  if (kpiChartInstances[id]) { kpiChartInstances[id].destroy(); delete kpiChartInstances[id]; }
}

function renderSlices(d, isPersonal) {
  var el = document.getElementById('kpiSlices');
  if (!el) return;
  kpiLastSlices = d;
  var hideCoverage = isPersonal && !d.plan_set; // без личного плана покрытие не считаем
  var hideManagers = isPersonal;                // в персональном режиме график менеджеров скрыт
  if (d.weeks.length === 0 && d.managers.rows.length === 0 && d.calendar.length === 0) {
    el.innerHTML = '<div class="text-secondary" style="font-size:13px">Нет данных для срезов</div>';
    return;
  }
  el.innerHTML = ''
    + (hideCoverage ? '' : renderCoverage(d))
    + '<div class="card" style="margin-top:14px"><h2>План-факт по неделям месяца</h2><div style="height:340px;position:relative"><canvas id="kpiChWeeks"></canvas></div></div>'
    + (hideManagers ? '' : '<div class="card" style="margin-top:14px"><h2>Факт и ожидания по менеджерам <span style="font-size:12px;color:#475569;font-weight:400">(основные — персонально; автооплаты/ОЗК/bond/afanasyev — строками; «Артефакт» — уволенные и тех. аккаунты)</span></h2><div style="position:relative"><canvas id="kpiChManagers"></canvas></div><div id="mgrZeroDrill" style="display:none;margin-top:8px;font-size:12px;color:#475569"></div></div>')
    + renderOverdueBlock(d.overdue)
    + '<div class="card" style="margin-top:14px"><h2>Календарь ожидаемых оплат <span style="font-size:12px;color:#475569;font-weight:400">(оставшиеся рабочие дни)</span></h2><div style="height:320px;position:relative"><canvas id="kpiChCalendar"></canvas></div></div>';

  // Расшифровку заполняем ПОСЛЕ вставки разметки: раньше fillOverdueDrill вызывался
  // из renderOverdueBlock, то есть до innerHTML, и писал в ещё не созданный узел.
  if (window._overdueOpen && d.overdue && d.overdue.cnt) fillOverdueDrill(d.overdue);

  kpiChartDestroy('weeks'); kpiChartDestroy('managers'); kpiChartDestroy('calendar');
  renderWeeksChart(d);
  if (!hideManagers) renderManagersChart(d);
  renderCalendarChart(d);
}

// ── 1. Покрытие месячного плана (bullet chart на HTML: полный контроль маркера) ──
function renderCoverage(d) {
  if (!d.plan_set) {
    return '<div class="card" style="margin-top:14px"><h2>Покрытие месячного плана</h2>'
      + '<div class="text-secondary" style="font-size:14px">План не задан · план/покрытие/дефицит — «—»</div></div>';
  }
  var plan = d.plan;
  var scale = Math.max(plan, d.forecast.sum, 1);
  var pct = function (v) { return Math.round(v / scale * 1000) / 10; };
  var seg = function (w, color, title) {
    return '<div style="width:' + w + '%;background:' + color + ';height:34px;display:inline-block;vertical-align:top" title="' + title + '"></div>';
  };
  var markerPos = pct(plan);
  var bar = '<div style="position:relative;border:1px solid #d5dbe8;border-radius:6px;overflow:hidden;height:34px;margin:8px 0">'
    + seg(pct(d.fact.sum), KPI_COLORS.fact, 'Факт: ' + fmt(d.fact.sum) + ' ₽')
    + seg(pct(d.expected_actual.sum), KPI_COLORS.actual, 'Ожидания актуальные: ' + fmt(d.expected_actual.sum) + ' ₽')
    + seg(pct(d.expected_overdue.sum), KPI_COLORS.overdue, 'Просроченные: ' + fmt(d.expected_overdue.sum) + ' ₽')
    + seg(pct(d.deficit), KPI_COLORS.deficit, 'Дефицит: ' + fmt(d.deficit) + ' ₽')
    + '<div style="position:absolute;left:' + markerPos + '%;top:0;bottom:0;width:2px;background:#0F172A" title="План: ' + fmt(plan) + ' ₽"></div>'
    + '</div>';
  var covTxt = d.coverage_pct === null ? '—' : fmtPct(d.coverage_pct) + '%';
  var diffTxt = d.excess > 0 ? '+' + fmt(d.excess) : fmt(d.deficit);
  return '<div class="card" style="margin-top:14px"><h2>Покрытие месячного плана <span style="font-size:12px;color:#475569;font-weight:400">(план: ' + fmt(plan) + ' ₽ · маркер — план)</span></h2>'
    + bar
    + '<div class="kpis kpis-4" style="grid-template-columns:repeat(4,1fr)">'
    + '<div class="kpi kpi-total"><div class="lbl">Факт</div><div class="val-big">' + fmt(d.fact.sum) + ' ₽</div></div>'
    + '<div class="kpi kpi-total"><div class="lbl">Ожидания</div><div class="val-big">' + fmt(d.expected.sum) + ' ₽</div><div class="sub">из них просрочено ' + fmt(d.expected_overdue.sum) + ' ₽</div></div>'
    + '<div class="kpi kpi-total"><div class="lbl">Покрытие плана</div><div class="val-big">' + covTxt + '</div></div>'
    + '<div class="kpi kpi-total"><div class="lbl">Дефицит / превышение</div><div class="val-big">' + diffTxt + ' ₽</div></div>'
    + '</div></div>';
}

// ── 2. Недели: combo (stacked bar fact+expected + line plan) ──
function renderWeeksChart(d) {
  var ctx = document.getElementById('kpiChWeeks');
  if (!ctx) return;
  var labels = d.weeks.map(function (w) { return w.week_range; });
  kpiChartInstances.weeks = new Chart(ctx, {
    data: {
      labels: labels,
      datasets: [
        { type: 'bar', label: 'Факт', data: d.weeks.map(function (w) { return w.fact_sum; }), backgroundColor: KPI_COLORS.fact, stack: 's' },
        { type: 'bar', label: 'Ожидания (актуальные)', data: d.weeks.map(function (w) { return w.expected_sum; }), backgroundColor: KPI_COLORS.actual, stack: 's' },
        { type: 'line', label: 'План недели', data: d.weeks.map(function (w) { return w.plan_sum; }), borderColor: KPI_COLORS.plan, borderWidth: 2, pointRadius: 3, tension: 0 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: function (v) { return fmt(v); } } } },
      plugins: {
        tooltip: {
          callbacks: {
            label: function (c) {
              var w = d.weeks[c.dataIndex];
              if (c.dataset.type === 'line') return 'План недели: ' + fmt(w.plan_sum) + ' ₽';
              var f = w.fact_sum + ' ₽ / ' + w.fact_cnt + ' шт';
              var e = w.expected_sum + ' ₽ / ' + w.expected_cnt + ' шт';
              return c.datasetIndex === 0
                ? 'Факт: ' + f
                : 'Ожидания: ' + e;
            },
            footer: function (items) {
              var w = d.weeks[items[0].dataIndex];
              return 'Итого неделя: ' + fmt(w.forecast_sum) + ' ₽\nОтклонение от плана: ' + (w.variance >= 0 ? '+' : '') + fmt(w.variance) + ' ₽';
            }
          }
        },
        datalabels: {
          // Над столбцом — только итог (факт + ожидания); на линии плана и на факте — без подписей
          display: function (c) { return c.datasetIndex === 1; },
          anchor: 'end', align: 'end',
          formatter: function (v, c) { return fmt(d.weeks[c.dataIndex].forecast_sum); },
          color: '#0F172A', font: { weight: 600, size: 10 }
        }
      }
    },
    // Подписи итога стоят над столбцами и упирались в легенду — раздвигаем её блок
    // (тот же приём, что у воронки в app-render.js).
    plugins: [{
      id: 'legendSpacer',
      beforeLayout: function (chart) {
        var leg = chart.legend;
        if (leg && !leg.__spacer24) {
          var orig = leg.fit.bind(leg);
          leg.fit = function () { orig(); this.height += 24; };
          leg.__spacer24 = true;
        }
      }
    }]
  });
}

// ── 3. Менеджеры: horizontal stacked bar (fact + actual + overdue) ──
function renderManagersChart(d) {
  var ctx = document.getElementById('kpiChManagers');
  if (!ctx) return;
  var rows = d.managers.rows;
  var H = Math.max(280, rows.length * 34 + 40);
  ctx.parentNode.style.height = H + 'px';
  kpiChartInstances.managers = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map(function (r) { return r.name; }),
      datasets: [
        { label: 'Факт', data: rows.map(function (r) { return r.fact_sum; }), backgroundColor: KPI_COLORS.fact, stack: 'm' },
        { label: 'Ожидания актуальные', data: rows.map(function (r) { return r.expected_actual_sum; }), backgroundColor: KPI_COLORS.actual, stack: 'm' },
        { label: 'Просроченные', data: rows.map(function (r) { return r.expected_overdue_sum; }), backgroundColor: KPI_COLORS.overdue, stack: 'm' },
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true, ticks: { callback: function (v) { return fmt(v); } } }, y: { stacked: true } },
      onClick: function (evt, items) {
        if (!items.length) return;
        var r = rows[items[0].index];
        if (r && r.group === 'zero') {
          var el = document.getElementById('mgrZeroDrill');
          if (el) {
            el.style.display = el.style.display === 'none' ? '' : 'none';
            el.textContent = 'Без результата: ' + (d.managers.zero_names || []).join(', ');
          }
        }
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: function (c) {
              var r = rows[c.dataIndex];
              if (c.datasetIndex === 0) return 'Факт: ' + fmt(r.fact_sum) + ' ₽ / ' + r.fact_cnt + ' шт';
              if (c.datasetIndex === 1) return 'Ожидания актуальные: ' + fmt(r.expected_actual_sum) + ' ₽ / ' + r.expected_actual_cnt + ' шт';
              return 'Просроченные: ' + fmt(r.expected_overdue_sum) + ' ₽ / ' + r.expected_overdue_cnt + ' шт';
            },
            footer: function (items) {
              var r = rows[items[0].dataIndex];
              if (r.group === 'zero') return 'Клик по строке — список менеджеров';
              return 'Прогноз: ' + fmt(r.forecast_sum) + ' ₽ · доля: ' + fmtPct(r.share_pct) + '%';
            }
          }
        },
        datalabels: {
          display: true,
          anchor: 'end', align: 'end',
          formatter: function (v, c) {
            if (c.datasetIndex !== 2) return '';
            var r = rows[c.dataIndex];
            if (r.group === 'zero') return '';
            return fmt(r.forecast_sum) + ' · ' + fmtPct(r.share_pct) + '%';
          },
          color: '#0F172A', font: { weight: 600, size: 11 }
        }
      }
    }
  });
}

// ── Блок просроченных ожиданий + расшифровка по клику ──
function renderOverdueBlock(ovd) {
  if (!ovd || !ovd.cnt) return '';
  var h = '<div class="card" style="margin-top:14px;border-left:4px solid ' + KPI_COLORS.overdue + '">'
    + '<h2>⏰ Просроченные ожидания <span style="font-size:12px;color:#475569;font-weight:400">(согласованная дата оплаты уже прошла, оплаты нет — переходят между месяцами)</span></h2>'
    + '<div class="date-filter-row"><span style="font-size:16px;font-weight:700;color:' + KPI_COLORS.overdue + '">' + ovd.cnt + ' шт · ' + fmt(ovd.sum) + ' ₽</span>'
    + '<button id="overdueDrillBtn" class="btn btn-primary btn-sm" onclick="window.toggleOverdueDrill()">' + (window._overdueOpen ? 'Скрыть' : 'Расшифровать') + '</button></div>'
    + '<div id="overdueDrill" style="' + (window._overdueOpen ? '' : 'display:none') + ';margin-top:10px"></div>'
    + '</div>';
  return h;
}

window.toggleOverdueDrill = function () {
  window._overdueOpen = !window._overdueOpen;
  var el = document.getElementById('overdueDrill');
  var btn = document.getElementById('overdueDrillBtn');
  if (!el) return;
  el.style.display = window._overdueOpen ? '' : 'none';
  if (btn) btn.textContent = window._overdueOpen ? 'Скрыть' : 'Расшифровать';
  var ovd = kpiLastSlices && kpiLastSlices.overdue;
  if (window._overdueOpen && ovd && !el.innerHTML) fillOverdueDrill(ovd);
};

function fillOverdueDrill(ovd) {
  var el = document.getElementById('overdueDrill');
  if (!el || !ovd.deals) return;
  var rows = ovd.deals.map(function (x) {
    return '<tr><td>' + x.id + '</td><td>' + escapeHtml(x.title || '') + '</td><td>' + escapeHtml(x.manager) + '</td><td>' + escapeHtml(x.stage) + '</td><td style="text-align:right">' + fmt(x.sum) + ' ₽</td><td>' + x.agreed + '</td></tr>';
  }).join('');
  el.innerHTML = '<div class="scroll-x"><table class="table table-sm"><thead><tr><th>ID</th><th>Сделка</th><th>Менеджер</th><th>Стадия</th><th>Сумма</th><th>Согласованная дата</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// ── 4. Календарь ожидаемых оплат: vertical bar по рабочим дням ──
function renderCalendarChart(d) {
  var ctx = document.getElementById('kpiChCalendar');
  if (!ctx) return;
  var days = d.calendar;
  kpiChartInstances.calendar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days.map(function (x) { return x.label; }),
      datasets: [{
        label: 'Ожидания, ₽', data: days.map(function (x) { return x.expected_sum; }),
        backgroundColor: KPI_COLORS.actual, borderRadius: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return fmt(v); } } } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function (items) { return 'Дата: ' + days[items[0].dataIndex].date; },
            label: function (c) {
              var x = days[c.dataIndex];
              return 'Сумма: ' + fmt(x.expected_sum) + ' ₽ · сделок: ' + x.expected_cnt;
            },
            afterBody: function (items) {
              var x = days[items[0].dataIndex];
              var out = [];
              if (x.managers && x.managers.length) out.push('Менеджеры:', x.managers.map(function (m) { return '  ' + m.name + ' — ' + fmt(m.sum) + ' ₽'; }).join('\n'));
              if (x.stages && x.stages.length) out.push('Стадии:', x.stages.map(function (s) { return '  ' + s.name + ' — ' + fmt(s.sum) + ' ₽'; }).join('\n'));
              return out.join('\n');
            }
          }
        },
        datalabels: {
          display: function (c) { return days[c.dataIndex].expected_cnt > 0; },
          anchor: 'end', align: 'end',
          formatter: function (v, c) { return days[c.dataIndex].expected_cnt; },
          color: '#475569', font: { weight: 600, size: 10 }
        }
      }
    }
  });
}
