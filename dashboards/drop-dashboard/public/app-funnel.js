/**
 * app-funnel.js — вкладка «Воронка продаж» дашборда ДРОП.
 *
 * Когортная воронка по сделкам, СОЗДАННЫМ в выбранном периоде (дедуп по ID).
 * Для каждой сделки — максимальный восстанавливаемый этап:
 *   Создано → MQL → SQL → Счёт → Оплачено   (накопительно, без истории переходов).
 * PreSale (кат.8) — отдельная воронка «Квалификации» (до передачи в отдел продаж).
 *
 * API: GET /api/funnel?from&to&mgr  (расчёт — data-service/lib/sales-funnel.js).
 *
 * Цвета этапов (единые, без градиентов):
 *   Создано #F968B6 · MQL #3F8BCD · SQL #2E2D93 · Счёт #B02FB0 · Оплачено #96B833.
 */

// ── Состояние ─────────────────────────────────────────────────────────────────
var funnelInited = false;
var funnelMgrReady = false;
var funnelState = { from: null, to: null, mgr: 'all' };

// Первичная инициализация контролов (вызывается один раз из loadFunnelTab)
function initFunnelControls() {
  funnelInited = true;
  var now = new Date();
  var iso = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  // Период — тем же попап-календарём, что в «Продажах»/управленческом дашборде
  // (селект месяца/года + клики по дням; месяц выбирается в шапке попапа).
  var rc = RangeCalendar.attach(document.getElementById('funnelPeriod'), {
    mode: 'range',
    onApply: function (startISO, endISO) {
      funnelState.from = startISO;
      funnelState.to = endISO;
      loadFunnel();
    }
  });
  window.__funnelRC = rc;
  rc.setRange(now.getFullYear() + '-01-01', iso(now));
  funnelState.from = now.getFullYear() + '-01-01';
  funnelState.to = iso(now);
  fillMonthQuick(now);
  document.getElementById('funnelMgrSelect').onchange = loadFunnel;
  loadFunnel();
}

// Быстрый выбор месяца (селект) — ставит диапазон «01.MM—последний день месяца»
function fillMonthQuick(now) {
  var year = now.getFullYear();
  var curMonth = now.getMonth(); // 0..11
  var months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var sel = document.getElementById('funnelMonthQuick');
  var html = '<option value="all">Весь год</option>';
  for (var i = 0; i <= curMonth; i++) {
    html += '<option value="' + (i + 1) + '">' + months[i] + ' ' + year + '</option>';
  }
  sel.innerHTML = html;
  sel.onchange = function () {
    applyQuickMonth(sel.value, year, now);
  };
}

function applyQuickMonth(v, year, now) {
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var from, to;
  if (!v || v === 'all') {
    from = year + '-01-01';
    to = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  } else {
    var m = parseInt(v, 10);
    var last = new Date(year, m, 0).getDate();
    from = year + '-' + pad(m) + '-01';
    to = year + '-' + pad(m) + '-' + pad(last);
  }
  window.__funnelRC && window.__funnelRC.setRange(from, to);
  funnelState.from = from;
  funnelState.to = to;
  loadFunnel();
}

// Вызывается из switchDashTab при каждом открытии вкладки
window.loadFunnelTab = function () {
  if (!document.getElementById('funnelTab')) return;
  if (!funnelInited) initFunnelControls();
};

function loadFunnel() {
  var from = funnelState.from;
  var to = funnelState.to;
  if (!from || !to || from > to) return;
  var mgr = document.getElementById('funnelMgrSelect').value || 'all';
  funnelState = { from: from, to: to, mgr: mgr };
  var content = document.getElementById('funnelContent');
  content.innerHTML = '<div class="text-center text-secondary py-5"><div class="spinner-border text-primary mb-2" role="status"></div><div>Расчёт воронки…</div></div>';
  var url = '/api/funnel?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
  if (mgr && mgr !== 'all') url += '&mgr=' + encodeURIComponent(mgr);
  api(url).then(function (d) {
    if (!funnelMgrReady) fillMgrSelect(d.managers || []);
    renderFunnel(d);
  }).catch(function (e) {
    content.innerHTML = '<div class="alert alert-danger" style="margin-top:10px">⚠️ Ошибка расчёта воронки: ' + escapeHtml(e.message || e) + '</div>';
  });
}

function fillMgrSelect(managers) {
  funnelMgrReady = true;
  var sel = document.getElementById('funnelMgrSelect');
  var html = '<option value="all">Весь отдел</option>';
  managers.forEach(function (m) {
    html += '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name) + '</option>';
  });
  sel.innerHTML = html;
}

// ── Рендер ────────────────────────────────────────────────────────────────────

// Этапы основной воронки: ключ = поле в данных, label, цвет (единый для всех
// графиков и таблиц — без градиентов)
var STAGE_KEYS = [
  { key: 'created', label: 'Создано', color: '#F968B6' },
  { key: 'mql', label: 'MQL', color: '#3F8BCD' },
  { key: 'sql', label: 'SQL', color: '#2E2D93' },
  { key: 'invoice', label: 'Счёт', color: '#B02FB0' },
  { key: 'paid', label: 'Оплачено', color: '#96B833' },
];
// Квалификация PreSale
var QUAL_KEYS = [
  { key: 'created', label: 'Создано', color: '#F968B6' },
  { key: 'work', label: 'Взят в работу', color: '#3F8BCD' },
  { key: 'warm', label: 'Тёплый лид', color: '#2E2D93' },
  { key: 'qualified', label: 'Квалификация', color: '#B02FB0' },
  { key: 'handoff', label: 'Передано в ОП', color: '#96B833' },
];
// Группы таблицы менеджеров: порядок строк после персональных (main)
var GROUP_ORDER = [
  { group: 'autopay', label: 'Автооплаты' },
  { group: 'ozk', label: 'ОЗК' },
  { group: 'other', label: 'Прочее' },
  { group: 'tech', label: 'Артефакт' },
];

function pct(a, b) {
  if (!b) return '—';
  return (a / b * 100).toFixed(1) + '%';
}

// Полосы одного этапа (возвращает html)
function stageBar(st, cnt, prevCnt, total) {
  var w = total > 0 ? Math.max(cnt / total * 100, 0.5) : 0;
  var convPrev = prevCnt == null ? '—' : pct(cnt, prevCnt);
  var convTot = total > 0 ? pct(cnt, total) : '—';
  return '<div class="funnel-stage st-' + st.key + '">'
    + '<div class="fstage-head"><b>' + st.label + '</b>'
    + '<span class="fstage-num" style="color:' + st.color + '">' + fmt(cnt) + '</span></div>'
    + '<div class="fbar"><div class="fbar-fill st-' + st.key + '" style="width:' + w + '%;background:' + st.color + '"></div></div>'
    + '<div class="fstage-meta">от предыдущего: <b>' + convPrev + '</b> · от «Создано»: <b>' + convTot + '</b></div>'
    + '</div>';
}

// Строка «потеря» между этапами
function lossLine(fromCnt, toCnt, extraHtml) {
  if (fromCnt == null) return '';
  var loss = fromCnt - toCnt;
  if (loss <= 0) return '';
  return '<div class="funnel-loss">↓ потеря: <b>' + fmt(loss) + '</b> шт (' + pct(loss, fromCnt) + ' от предыдущего)' + (extraHtml || '') + '</div>';
}

// Полосы для массива этапов keys + счётчики {key: cnt}
function funnelBarsHtml(keys, counts, loseUnknown) {
  var html = '<div class="funnel-bars">';
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var prev = i > 0 ? (counts[keys[i - 1].key] || 0) : null;
    html += stageBar(k, counts[k.key] || 0, prev, counts[keys[0].key] || 0);
    if (i < keys.length - 1) {
      var extra = '';
      if (i === 0 && loseUnknown > 0) {
        var fromC = counts[keys[0].key] || 0;
        var toC = counts[keys[1].key] || 0;
        var rest = Math.max(fromC - toC - loseUnknown, 0);
        extra = '<div class="funnel-loss-detail">из них LOSE (пик неизвестен): <b>' + fmt(loseUnknown) + '</b>'
          + (rest > 0 ? ' · в работе / на ранних стадиях: ' + fmt(rest) : '') + '</div>';
      }
      html += lossLine(counts[keys[i].key] || 0, counts[keys[i + 1].key] || 0, extra);
    }
  }
  html += '</div>';
  return html;
}

// ── Сборка строк таблицы менеджеров (группы по mgr-groups) ───────────────────
// Порядок: 1) ИТОГО; 2) действующие (main) персонально; 3) Автооплаты;
//          4) ОЗК; 5) Прочее (other+afanasyev+bond); 6) Артефакт (tech).
function sumCounts(rows, keys) {
  var out = {};
  keys.forEach(function (k) { out[k.key] = 0; });
  rows.forEach(function (r) {
    keys.forEach(function (k) { out[k.key] += r[k.key] || 0; });
  });
  return out;
}
function hasAny(r, keys) {
  return keys.some(function (k) { return (r[k.key] || 0) > 0; });
}
function buildMgrRows(rows, keys) {
  var out = { main: [], groups: {} };
  (GROUP_ORDER).forEach(function (g) { out.groups[g.group] = []; });
  rows.forEach(function (r) {
    if (!r || !r.id) return;
    if (r.group === 'main') {
      if (hasAny(r, keys)) out.main.push(r);            // нулевые персональные скрываем
    } else if (r.group === 'autopay' || r.group === 'ozk' || r.group === 'tech') {
      out.groups[r.group].push(r);
    } else {
      out.groups.other.push(r);                          // other + afanasyev + bond → «Прочее»
    }
  });
  out.main.sort(function (a, b) { return (b.created || 0) - (a.created || 0) || a.name.localeCompare(b.name); });
  var total = sumCounts(rows, keys);                     // ИТОГО = все менеджеры (включая скрытых нулевых)
  return { main: out.main, groups: out.groups, total: total, all: rows };
}

// Ячейка этапа: число + конверсия от предыдущего этапа
function cellHtml(st, cnt, prevCnt) {
  var conv = prevCnt == null ? '—' : pct(cnt, prevCnt);
  return '<td><span class="cnt">' + fmt(cnt) + '</span><div class="cell-conv">от пред.: ' + conv + '</div></td>';
}

// Заголовок таблицы с цветным маркером этапа
function thHtml(keys, lastLabel) {
  var h = '<tr><th style="min-width:150px">Менеджер</th>';
  keys.forEach(function (k) {
    h += '<th><span class="dot-st st-' + k.key + '" style="background:' + k.color + '"></span>' + k.label + '</th>';
  });
  h += '<th>Общая конв.</th></tr>';
  return h;
}

// Основная строка данных (менеджер или группа)
function dataRowHtml(name, sub, counts, keys, totalCreated) {
  var h = '<tr><td><b>' + name + '</b>' + (sub ? '<div class="cell-sub">' + sub + '</div>' : '') + '</td>';
  keys.forEach(function (k, i) {
    var prev = i > 0 ? (counts[keys[i - 1].key] || 0) : null;
    h += cellHtml(k, counts[k.key] || 0, prev);
  });
  h += '<td>' + ((counts[keys[0].key] || 0) ? pct(counts[keys[keys.length - 1].key] || 0, counts[keys[0].key]) : '—') + '</td>';
  h += '</tr>';
  return h;
}

// Таблица менеджеров: ИТОГО первой, затем main персонально и агрегированные группы
function mgrGroupTableHtml(built, keys, opt) {
  opt = opt || {};
  var html = '<table class="table table-sm" style="margin:0">'
    + '<thead>' + thHtml(keys) + '</thead><tbody>';
  // 1) ИТОГО
  html += '<tr class="total-row" style="background:#fff8e1;font-weight:700">'
    + '<td>📊 ИТОГО</td>';
  keys.forEach(function (k, i) {
    var prev = i > 0 ? (built.total[keys[i - 1].key] || 0) : null;
    html += cellHtml(k, built.total[k.key] || 0, prev);
  });
  html += '<td>' + ((built.total[keys[0].key] || 0) ? pct(built.total[keys[keys.length - 1].key] || 0, built.total[keys[0].key]) : '—') + '</td></tr>';
  // 2) действующие менеджеры персонально
  built.main.forEach(function (r) {
    html += dataRowHtml(escapeHtml(r.name), null, r, keys);
  });
  // 3–6) агрегированные группы
  GROUP_ORDER.forEach(function (g) {
    var list = built.groups[g.group] || [];
    var counts = sumCounts(list, keys);
    var sub = list.length ? (list.length + ' ' + (list.length === 1 ? 'менеджер' : (list.length < 5 ? 'менеджера' : 'менеджеров'))) : 'нет сделок';
    html += '<tr' + (g.group === 'tech' ? ' style="background:#ffebee"' : '') + '>'
      + '<td><b>' + escapeHtml(g.label) + '</b><div class="cell-sub">' + sub + '</div></td>';
    keys.forEach(function (k, i) {
      var prev = i > 0 ? (counts[keys[i - 1].key] || 0) : null;
      html += cellHtml(k, counts[k.key] || 0, prev);
    });
    html += '<td>' + ((counts[keys[0].key] || 0) ? pct(counts[keys[keys.length - 1].key] || 0, counts[keys[0].key]) : '—') + '</td></tr>';
  });
  html += '</tbody></table>';
  if (opt.note) html += '<div class="funnel-note">' + opt.note + '</div>';
  return html;
}

// Таблица менеджеров — основная воронка (ключи STAGE_KEYS)
function mgrTableHtml(byManager, stages) {
  var keys = STAGE_KEYS;
  var built = buildMgrRows(byManager || [], keys);
  var note = ''
    + 'Контроль: действующие + Автооплаты + ОЗК + Прочее + Артефакт = ИТОГО. '
    + '⚠ «Артефакт» — технические/служебные аккаунты (tech). '
    + 'Тех. WON (&lt;11 ₽, создаются ботом) исключены из «Создано»: ' + fmt(stages.tech_won || 0) + ' шт. '
    + 'LOSE без пика (входят в «Создано», не приписаны к MQL/SQL/Счёту): ' + fmt(stages.lose_unknown || 0) + ' шт.';
  return mgrGroupTableHtml(built, keys, { note: note });
}

// Таблица менеджеров — квалификация PreSale
function qualTableHtml(byManager, qs) {
  var keys = QUAL_KEYS;
  var built = buildMgrRows(byManager || [], keys);
  var note = ''
    + 'Контроль: действующие + Автооплаты + ОЗК + Прочее + Артефакт = ИТОГО. '
    + '⚠ LOSE (закрыты отказом) в квалификации — пик неизвестен, в этапы не включены: '
    + fmt(qs.lose_unknown || 0) + ' шт.';
  return mgrGroupTableHtml(built, keys, { note: note });
}

// Блок артефактов
function artifactsHtml(a, mainLose) {
  var rows = [];
  function add(key, label) {
    var v = a[key];
    if (v && v.cnt) rows.push('<tr><td>' + label + '</td><td style="text-align:right"><b>' + fmt(v.cnt) + '</b> шт.</td><td style="text-align:right;color:#C62828">' + fmt(Math.round(v.sum || 0)) + ' ₽</td></tr>');
  }
  if (mainLose) rows.push('<tr><td>🚫 LOSE — пик неизвестен (не приписаны к MQL/SQL)</td><td style="text-align:right"><b>' + fmt(mainLose) + '</b> шт.</td><td style="text-align:right">—</td></tr>');
  add('tech_won', '🤖 Технические WON (исключены из «Создано»)');
  add('returns', '🔙 Возвраты (оплата + закрыты отказом)');
  add('won_no_pay', '✅ WON «Счёт оплачен» без даты оплаты 1С');
  add('paid_no_inv', '🧾 Оплата без даты счёта');
  add('paid_in_progress', '📌 Оплата, но сделка «в работе»');
  add('neg_dur', '⏪ Оплата раньше создания');
  if (!rows.length) return '<div class="funnel-note" style="padding:8px 0">Аномалий в когорте нет ✅</div>';
  return '<div class="funnel-artifacts"><b>⚠ Артефакты данных</b><table style="width:100%;margin-top:8px;font-size:14px;border-collapse:collapse">'
    + rows.join('') + '</table></div>';
}

function renderFunnel(d) {
  var info = document.getElementById('funnelInfo');
  var calcTxt = d.calculated_at ? ' · данные от ' + d.calculated_at.substring(0, 16).replace('T', ' ') : '';
  if (info) {
    var mgrName = 'весь отдел';
    if (funnelState.mgr !== 'all') {
      var sel = document.getElementById('funnelMgrSelect');
      var opt = sel && sel.options[sel.selectedIndex];
      mgrName = opt ? opt.text : funnelState.mgr;
    }
    info.textContent = 'когорта: сделки, созданные ' + funnelState.from + ' — ' + funnelState.to + ' · ' + mgrName + calcTxt;
  }

  var m = d.main || { stages: {}, by_manager: [] };
  var s = m.stages || {};
  var q = d.qual || { stages: {}, by_manager: [] };
  var qs = q.stages || {};
  var a = d.artifacts || {};

  var html = '';
  // Основная воронка
  html += '<div class="card funnel-card" style="margin-top:10px;padding:16px 20px">';
  html += '<h2 class="funnel-h">Воронка продаж <span class="funnel-sub">· сделки Sale + КОМ, созданные в периоде</span></h2>';
  html += '<div class="funnel-note" style="margin:0 0 14px">Максимальный восстанавливаемый этап · накопительно: оплачено ⊆ счёт ⊆ SQL ⊆ MQL ⊆ создано</div>';
  html += funnelBarsHtml(STAGE_KEYS, s, s.lose_unknown || 0);
  html += '</div>';

  // Таблица менеджеров
  html += '<div class="card funnel-card" style="margin-top:8px;padding:16px 20px">';
  html += '<h2 class="funnel-h">По менеджерам</h2>';
  html += '<div class="funnel-note" style="margin:0 0 10px">В ячейке — сделки этапа и конверсия от предыдущего этапа</div>';
  html += '<div style="overflow-x:auto">' + mgrTableHtml(m.by_manager || [], s) + '</div>';
  html += '</div>';

  // Квалификация PreSale
  html += '<div class="card funnel-card" style="margin-top:8px;padding:16px 20px">';
  html += '<h2 class="funnel-h">Квалификация <span class="funnel-sub">· Pre Sale (прогрев до передачи в отдел продаж), созданные в периоде</span></h2>';
  html += '<div class="funnel-note" style="margin:0 0 14px">Не входит в основную воронку продаж — отдельный процесс</div>';
  html += funnelBarsHtml(QUAL_KEYS, qs, qs.lose_unknown || 0);
  html += '<div style="margin-top:14px;overflow-x:auto">' + qualTableHtml(q.by_manager || [], qs) + '</div>';
  html += '</div>';

  // Артефакты
  html += '<div class="card funnel-card" style="margin-top:8px;padding:16px 20px">';
  html += '<h2 class="funnel-h">Артефакты когорты</h2>';
  html += artifactsHtml(a, s.lose_unknown || 0);
  html += '</div>';

  // Дисклеймер
  html += '<div class="card funnel-card" style="margin-top:8px;padding:14px 20px;background:#f8f9ff">';
  html += '<div class="funnel-note" style="line-height:1.7;color:#475569">'
    + 'ℹ️ <b>Расчёт по максимальному восстанавливаемому этапу, без истории переходов.</b> '
    + 'MQL/SQL определяются по текущей/финальной стадии сделки; «Счёт» = дата «Счёт отправлен» '
    + 'или стадия «Счёт отправлен»/«Частично оплачен»/«Постоплата»/WON или фактическая оплата; '
    + '«Оплачено» = только фактическая оплата из 1С (сумма ≥ 11 ₽, дата оплаты может быть позже периода). '
    + 'Сделка, достигшая позднего этапа, включена во все предыдущие (конверсия между соседними этапами ≤ 100%). '
    + 'Закрытые отказом (LOSE) к MQL/SQL не приписываются — без истории стадий их пик невосстановим '
    + '(строки «Артефакт» и блок артефактов). Технические WON (сумма &lt; 11 ₽) в когорту не входят. '
    + 'PreSale считается отдельно (воронка квалификации). Итог когортной таблицы сходится с итогом воронки; '
    + 'с общим KPI оплат он совпадать не обязан: там выборка по дате поступления, здесь — по дате создания.'
    + '</div>';
  html += '</div>';

  document.getElementById('funnelContent').innerHTML = html;
}
