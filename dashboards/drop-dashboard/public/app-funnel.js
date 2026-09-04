/**
 * app-funnel.js — вкладка «Воронка продаж» дашборда ДРОП.
 *
 * Когортная воронка по сделкам, СОЗДАННЫМ в выбранном периоде (дедуп по ID).
 * Для каждой сделки — максимальный восстанавливаемый этап:
 *   Создано → MQL → SQL → Счёт → Оплачено   (накопительно, без истории переходов).
 * Разница между этапами — этап НЕ подтверждён, а не отказ (подписи «потеря» нет).
 * Отказы (LOSE + дата отказа) — красной полосой-шкалой после «Оплачено»
 * (% от «Создано»; не ступень воронки — этапы не накапливают).
 * PreSale (кат.8) — полоса-распределение по текущему состоянию в начале страницы
 * (прогрев маркетингом → тёплый лид → квалификация → передано в ОП → отказы),
 * в основную воронку не входит.
 *
 * API: GET /api/funnel?from&to&mgr  (расчёт — data-service/lib/sales-funnel.js).
 *
 * Цвета этапов основной воронки (единые, без градиентов):
 *   Создано #F968B6 · MQL #3F8BCD · SQL #2E2D93 · Счёт #B02FB0 · Оплачено #96B833.
 * Цвета сегментов PreSale-полосы: прогрев коричневый · тёплый оранжевый ·
 * квалификация жёлтый · передано в ОП зелёный · отказы красный.
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
    if (m === now.getMonth() + 1) {
      // текущий месяц — по сегодняшнюю дату (иначе to = конец месяца уходит в будущее,
      // и у Sankey пропадает разбивка остатка: она считается на дату окончания периода)
      from = year + '-' + pad(m) + '-01';
      to = year + '-' + pad(m) + '-' + pad(now.getDate());
    } else {
      var last = new Date(year, m, 0).getDate();
      from = year + '-' + pad(m) + '-01';
      to = year + '-' + pad(m) + '-' + pad(last);
    }
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
  var pfUrl = '/api/portfolio-flow?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
  if (mgr && mgr !== 'all') pfUrl += '&mgr=' + encodeURIComponent(mgr);
  Promise.all([
    api(url),                                        // воронка — критична
    api(pfUrl).catch(function () { return null; }),  // Sankey — до рестарта API может отсутствовать
  ]).then(function (rs) {
    var d = rs[0];
    if (!funnelMgrReady) fillMgrSelect(d.managers || []);
    renderFunnel(d, rs[1]);
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
// Квалификация PreSale — сегменты полосы (текущее состояние сделки,
// взаимоисключающе; created = сумма). Цвета по решению владельца дашборда.
var PRE_SEGMENTS = [
  { key: 'warming', label: 'Прогрев маркетингом', color: '#8B5A2B' },
  { key: 'warm', label: 'Тёплый лид', color: '#F57C00' },
  { key: 'qualified', label: 'На квалификации', color: '#FBC02D' },
  { key: 'handoff', label: 'Передано в ОП', color: '#96B833' },
  { key: 'lose', label: 'Отказы', color: '#C62828' },
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

// Строка «потеря» между этапами — НЕ показывается: разница этапов означает, что
// следующий этап не подтверждён, а не отказ. (функция удалена намеренно)

// Полосы для массива этапов keys + счётчики {key: cnt} (без строк «потеря»)
function funnelBarsHtml(keys, counts) {
  var html = '<div class="funnel-bars">';
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var prev = i > 0 ? (counts[keys[i - 1].key] || 0) : null;
    html += stageBar(k, counts[k.key] || 0, prev, counts[keys[0].key] || 0);
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
    + 'Тех. WON (&lt;11 ₽, создаются ботом) исключены из «Создано»: ' + fmt(stages.tech_won || 0) + ' шт.';
  return mgrGroupTableHtml(built, keys, { note: note });
}

// Блок артефактов — только реальные проблемы данных (отказы сюда не входят)
function artifactsHtml(a) {
  var rows = [];
  function add(key, label) {
    var v = a[key];
    if (v && v.cnt) rows.push('<tr><td>' + label + '</td><td style="text-align:right"><b>' + fmt(v.cnt) + '</b> шт.</td><td style="text-align:right;color:#C62828">' + fmt(Math.round(v.sum || 0)) + ' ₽</td></tr>');
  }
  add('tech_won', '🤖 Технические WON (исключены из «Создано»)');
  add('returns', '🔙 Возвраты (оплата + закрыты отказом)');
  add('refuse_no_lose', '🗓 Дата отказа заполнена, стадия не LOSE');
  add('won_no_pay', '✅ WON «Счёт оплачен» без даты оплаты 1С');
  add('paid_no_inv', '🧾 Оплата без даты счёта');
  add('paid_in_progress', '📌 Оплата, но сделка «в работе»');
  add('neg_dur', '⏪ Оплата раньше создания');
  if (!rows.length) return '<div class="funnel-note" style="padding:8px 0">Аномалий в когорте нет ✅</div>';
  return '<div class="funnel-artifacts"><b>⚠ Артефакты данных</b><table style="width:100%;margin-top:8px;font-size:14px;border-collapse:collapse">'
    + rows.join('') + '</table></div>';
}

// ── Полоса PreSale (кат.8): распределение по текущему состоянию воронки ─────
// Визуально — как блок «Покрытие месячного плана» на вкладке КПЭ:
// горизонтальный бар сегментами + карточки-цифры под ним.
function preStripHtml(qs) {
  qs = qs || {};
  var created = qs.created || 0;
  var inner;
  if (!created) {
    inner = '<div class="text-secondary" style="font-size:14px;padding:6px 0">Нет сделок PreSale за выбранный период</div>';
  } else {
    var scale = Math.max(created, 1);
    var pctW = function (v) { return Math.round(v / scale * 1000) / 10; };
    var segHtml = '';
    PRE_SEGMENTS.forEach(function (sg) {
      var cnt = qs[sg.key] || 0;
      if (!cnt) return;
      segHtml += '<div style="width:' + pctW(cnt) + '%;background:' + sg.color + ';height:34px;display:inline-block;vertical-align:top" title="'
        + escapeHtml(sg.label) + ': ' + fmt(cnt) + ' шт. (' + pct(cnt, created) + ')"></div>';
    });
    var bar = '<div style="position:relative;border:1px solid #d5dbe8;border-radius:6px;overflow:hidden;height:34px;margin:8px 0">'
      + segHtml + '</div>';
    var cards = '';
    PRE_SEGMENTS.forEach(function (sg) {
      var cnt = qs[sg.key] || 0;
      var color = cnt ? sg.color : '#94A3B8';
      cards += '<div class="kpi"><div class="lbl">' + escapeHtml(sg.label) + '</div>'
        + '<div class="val-big" style="color:' + color + '">' + fmt(cnt) + '</div>'
        + '<div class="sub">' + pct(cnt, created) + '</div></div>';
    });
    inner = bar + '<div class="kpis" style="grid-template-columns:repeat(5,1fr);margin:0">' + cards + '</div>';
  }
  return '<div class="card funnel-card" style="margin-top:10px;padding:16px 20px">'
    + '<h2 class="funnel-h">PreSale · Квалификация <span class="funnel-sub">· прогрев маркетингом до передачи в отдел продаж (кат. 8) · сделки, созданные в периоде · текущее состояние</span></h2>'
    + inner + '</div>';
}

// Полоса «Отказы» — НЕ ступень воронки (ненаследственная категория когорты):
// красная шкала с % от «Создано», без конверсии «от предыдущего».
function refuseBarHtml(s) {
  var cnt = s.refuse || 0;
  if (!cnt) return '';
  var total = s.created || 0;
  var w = total > 0 ? Math.max(cnt / total * 100, 0.5) : 0;
  return '<div class="funnel-stage st-refuse" style="margin-top:10px">'
    + '<div class="fstage-head"><b>Отказы</b>'
    + '<span class="fstage-num" style="color:#C62828">' + fmt(cnt) + '</span></div>'
    + '<div class="fbar"><div class="fbar-fill" style="width:' + w + '%;background:#C62828"></div></div>'
    + '<div class="fstage-meta">от «Создано»: <b>' + (total > 0 ? pct(cnt, total) : '—') + '</b> · не ступень воронки — закрыты отказом, этапы не накапливают</div>'
    + '</div>';
}

function renderFunnel(d, pf) {
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
  var q = d.qual || { stages: {} };
  var qs = q.stages || {};
  var a = d.artifacts || {};

  var html = '';

  // PreSale — полоса в начале страницы, над основной воронкой
  html += preStripHtml(qs);

  // Основная воронка
  html += '<div class="card funnel-card" style="margin-top:8px;padding:16px 20px">';
  html += '<h2 class="funnel-h">Воронка продаж <span class="funnel-sub">· сделки Sale + КОМ, созданные в периоде</span></h2>';
  html += '<div class="funnel-note" style="margin:0 0 14px">Максимальный восстанавливаемый этап · накопительно: оплачено ⊆ счёт ⊆ SQL ⊆ MQL ⊆ создано. '
    + 'Разница между этапами — следующий этап не подтверждён (не отказ).</div>';
  html += funnelBarsHtml(STAGE_KEYS, s);
  // Отказы — красной полосой-шкалой (не ступень воронки)
  html += refuseBarHtml(s);
  html += '</div>';

  // Таблица менеджеров
  html += '<div class="card funnel-card" style="margin-top:8px;padding:16px 20px">';
  html += '<h2 class="funnel-h">По менеджерам</h2>';
  html += '<div class="funnel-note" style="margin:0 0 10px">В ячейке — сделки этапа и конверсия от предыдущего этапа</div>';
  html += '<div style="overflow-x:auto">' + mgrTableHtml(m.by_manager || [], s) + '</div>';
  html += '</div>';

  // Sankey «Движение портфеля» (после таблицы менеджеров)
  html += portfolioHtml(pf);

  // Артефакты
  html += '<div class="card funnel-card" style="margin-top:8px;padding:16px 20px">';
  html += '<h2 class="funnel-h">Артефакты когорты</h2>';
  html += artifactsHtml(a);
  html += '</div>';

  // Дисклеймер
  html += '<div class="card funnel-card" style="margin-top:8px;padding:14px 20px;background:#f8f9ff">';
  html += '<div class="funnel-note" style="line-height:1.7;color:#475569">'
    + 'ℹ️ <b>Расчёт по максимальному восстанавливаемому этапу, без истории переходов.</b> '
    + 'MQL/SQL определяются по текущей/финальной стадии сделки; «Счёт» = дата «Счёт отправлен» '
    + 'или стадия «Счёт отправлен»/«Частично оплачен»/«Постоплата» или фактическая оплата; '
    + '«Оплачено» = только фактическая оплата из 1С (сумма ≥ 11 ₽, дата оплаты может быть позже периода). '
    + 'Сделка, достигшая позднего этапа, включена во все предыдущие (конверсия между соседними этапами ≤ 100%). '
    + 'Отказы к этапам не приписываются (без истории стадий пик невосстановим) — '
    + 'вынесены одной строкой; детальная аналитика отказов будет на отдельной вкладке. '
    + 'Разница между этапами означает только, что следующий этап не подтверждён, а не отказ. '
    + 'Технические WON (сумма &lt; 11 ₽) в когорту не входят. '
    + 'PreSale (прогрев до передачи в ОП) показан полосой сверху и в основную воронку не входит. '
    + 'Итог когортной таблицы сходится с итогом воронки; '
    + 'с общим KPI оплат он совпадать не обязан: там выборка по дате поступления, здесь — по дате создания.'
    + '</div>';
  html += '</div>';

  document.getElementById('funnelContent').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// Sankey «Движение портфеля»
// Остаток на начало + Создано в периоде → Всего доступно в работе →
// Оплачено / Отказано / Остаток на конец (→ разбивка остатка по этапам —
// только для периода, заканчивающегося сегодня). Ширина потока — по количеству.
// API: GET /api/portfolio-flow (data-service/lib/portfolio-flow.js).
// ═══════════════════════════════════════════════════════════════════════════

var PF_COLORS = {
  start: '#64748B', created: '#F06292', reopened: '#B0BEC5',
  available: '#1F2A44', paid: '#2E7D32', refused: '#C62828', end: '#5B21B6',
};
var PF_STAGE_COLORS = {
  pre_mql: '#94A3B8', mql: '#3F8BCD', sql: '#2E2D93',
  inv_proposal: '#9C27B0', inv_partial: '#E0A458', inv_postpay: '#1B5E20', deferred: '#795548',
  paid_after: '#2E7D32', refused_after: '#C62828',
};
var PF_LABELS = {
  start: 'Остаток на начало', created: 'Создано в периоде', reopened: 'Возвращены в работу',
  available: 'Всего доступно в работе', paid: 'Оплачено', refused: 'Отказано', end: 'Остаток на конец',
};

// ── Карточка «Движение портфеля» ─────────────────────────────────────────────
function portfolioHtml(pf) {
  if (!pf || !pf.nodes) return '';
  var n = pf.nodes;
  var title = '<h2 class="funnel-h">Движение портфеля · воронка Sale <span class="funnel-sub">· относится ТОЛЬКО к воронке Sale (кат. 0): КОМ и PreSale не входят — у них другие этапы</span></h2>';
  if (!n.available || !n.available.cnt) {
    return '<div class="card funnel-card" style="margin-top:8px;padding:16px 20px">'
      + title
      + '<div class="funnel-note">Нет сделок в портфеле за выбранный период</div></div>';
  }
  var html = '<div class="card funnel-card" style="margin-top:8px;padding:16px 20px">';
  html += title;
  html += '<div class="funnel-note" style="margin:0 0 10px">Остаток на начало + создано → в работе → оплачено / отказано / остаток на конец · '
    + 'ширина потока — по количеству сделок · в узле — количество и сумма · '
    + 'сделка ровно в одном исходе (возвраты — в «Оплачено»)</div>';
  // Контрольный баланс (количество и сумма)
  html += balanceHtml(pf);
  html += sankeySvg(pf);
  html += sankeyArtifactsHtml(pf);
  html += '</div>';
  return html;
}

// Контрольная строка: Остаток на начало + Создано = Оплачено + Отказано + Остаток на конец
function balanceHtml(pf) {
  var n = pf.nodes;
  var Lcnt = n.start.cnt + n.created.cnt, Lsum = n.start.sum + n.created.sum;
  var Rcnt = n.paid.cnt + n.refused.cnt + n.end.cnt, Rsum = n.paid.sum + n.refused.sum + n.end.sum;
  var diffCnt = Rcnt - Lcnt, diffSum = Rsum - Lsum;
  var ok = diffCnt === 0 && diffSum === 0;
  var sign = ok ? '✅' : '⚠️';
  var signColor = ok ? '#2E7D32' : '#C62828';
  return '<div class="pf-balance" style="' + (ok ? '' : 'border-color:#FECACA;background:#FEF2F2;') + '">'
    + '<div class="pf-balance-side">Остаток на начало + Создано'
    + '<div class="pf-balance-num">' + fmt(Lcnt) + ' шт · ' + fmt(Lsum) + ' ₽</div></div>'
    + '<div class="pf-balance-sign" style="color:' + signColor + '">' + sign + ' ' + (ok ? '=' : '≠') + '</div>'
    + '<div class="pf-balance-side">Оплачено + Отказано + Остаток на конец'
    + '<div class="pf-balance-num">' + fmt(Rcnt) + ' шт · ' + fmt(Rsum) + ' ₽</div></div>'
    + '</div>';
}

// Артефакты Sankey — сразу под блоком (расхождения/аномалии, не «проблемы когорты»)
function sankeyArtifactsHtml(pf) {
  var rows = [];
  var n = pf.nodes;
  var meta = pf.meta || {};
  if (n.reopened && n.reopened.cnt > 0) {
    rows.push('<div class="pf-artifact">🔁 Возвращены в работу из отказов (закрыты до периода, лид-менеджер вернул, продажи обрабатывают): '
      + '<b>' + fmt(n.reopened.cnt) + ' шт</b> · ' + fmt(n.reopened.sum) + ' ₽ — показаны отдельным потоком, в баланс «Остаток на начало + Создано» не входят</div>');
  }
  if (meta.tech_purge && meta.tech_purge.cnt) {
    rows.push('<div class="pf-artifact">🧹 Технические зачистки (массовое закрытие старого хвоста: день с &gt;30 закрытиями LOSE, возраст &gt;180 дн — напр. 24.08.2026): '
      + '<b>' + fmt(meta.tech_purge.cnt) + ' шт</b> · ' + fmt(meta.tech_purge.sum) + ' ₽ — исключены из портфеля целиком</div>');
  }
  if (meta.ignored && meta.ignored.cnt) {
    rows.push('<div class="pf-artifact">⚠️ Исключено аномалий с противоречивыми датами (созданы в периоде, но закрыты до его начала): '
      + '<b>' + fmt(meta.ignored.cnt) + ' шт</b> · ' + fmt(meta.ignored.sum) + ' ₽</div>');
  }
  var src = pf.breakdownSource || '';
  if (src === 'approx' && n.end && n.end.cnt > 0) {
    rows.push('<div class="pf-note2">Разбивка «Остатка на конец» — по ТЕКУЩИМ стадиям сделок, фиксируется как состояние на конец периода. '
      + 'Это приближение: стадии могли поменяться после конца периода; закрывшиеся после него (сейчас LOSE/WON) показаны отдельными '
      + 'сегментами «Оплачены/Отказаны после периода». Точная разбивка для прошлых дат появится по мере накопления ежедневных снапшотов '
      + '(создаются при каждом обновлении данных).</div>');
  } else if (src.indexOf('snapshot:') === 0 && n.end && n.end.cnt > 0) {
    rows.push('<div class="pf-note2">Разбивка «Остатка на конец» — по ежедневному снапшоту на ' + escapeHtml(src.slice(9)) + '.</div>');
  } else if (!src && n.end && n.end.cnt > 0) {
    rows.push('<div class="pf-note2">Разбивка остатка по этапам недоступна — нет состояния на дату окончания периода.</div>');
  }
  return rows.join('');
}

// ── SVG-Sankey (растягивается на всю ширину блока) ───────────────────────────
function sankeySvg(pf) {
  var n = pf.nodes;
  var breakdown = pf.endBreakdown || [];

  // Узлы колонок: слева — вход (остаток/создано/возвращены), центр — «в работе»,
  // справа — исходы; крайняя колонка — этапы остатка (только для to == сегодня)
  var mk = function (key, cnt, sum) {
    return { key: key, cnt: cnt || 0, sum: sum || 0, color: PF_COLORS[key] || '#94A3B8', label: PF_LABELS[key] || key };
  };
  var col0 = [mk('start', n.start.cnt, n.start.sum), mk('created', n.created.cnt, n.created.sum)];
  if (n.reopened && n.reopened.cnt > 0) col0.push(mk('reopened', n.reopened.cnt, n.reopened.sum));
  var col1 = [mk('available', n.available.cnt, n.available.sum)];
  var col2 = [mk('paid', n.paid.cnt, n.paid.sum), mk('refused', n.refused.cnt, n.refused.sum), mk('end', n.end.cnt, n.end.sum)];
  var col3 = breakdown.map(function (s) {
    return { key: s.key, cnt: s.cnt, sum: s.sum, color: PF_STAGE_COLORS[s.key] || '#94A3B8', label: 'Остаток · ' + (s.label || s.key) };
  });
  var cols = [col0, col1, col2];
  if (col3.length) cols.push(col3);

  var maxCnt = 1;
  cols.forEach(function (col) { col.forEach(function (u) { if (u.cnt > maxCnt) maxCnt = u.cnt; }); });

  // Геометрия: широкие горизонтальные интервалы, подписи в вертикальных зазорах
  var H_MAX = 250, MIN_H = 12, GAP_Y = 58, TOP = 26, BOTTOM = 70;
  var nodeW = 190, GAP_X = 180, X0 = 16;
  var hOf = function (cnt) { return Math.max(MIN_H, Math.round(cnt / maxCnt * H_MAX)); };
  cols.forEach(function (col) { col.forEach(function (u) { u.h = hOf(u.cnt); }); });
  var colH = function (col) { return col.reduce(function (a, u) { return a + u.h; }, 0) + GAP_Y * (col.length - 1); };
  var maxColH = Math.max.apply(null, cols.map(colH));
  var totalH = maxColH + TOP + BOTTOM;
  var x = X0;
  cols.forEach(function (col) { col.x = x; x += nodeW + GAP_X; });
  var svgW = x - GAP_X + nodeW + 30;
  x = X0;
  cols.forEach(function (col) {
    col.forEach(function (u) { u.x = x; });  // ← x узла (раньше вешался на колонку — узлы были NaN!)
    x += nodeW + GAP_X;
  });
  cols.forEach(function (col) {
    var y = Math.round((totalH - colH(col)) / 2);
    col.forEach(function (u) { u.y = y; y += u.h + GAP_Y; });
  });

  // Рёбра между соседними колонками
  var byKey = {};
  cols.forEach(function (col) { col.forEach(function (u) { byKey[u.key] = u; }); });
  var edges = [];
  function link(aKey, bKey) {
    var a = byKey[aKey], b = byKey[bKey];
    if (a && b && a.cnt > 0) {
      // Сумма потока: для распределяющих узлов (available, end) — доля приёмника,
      // иначе узел-источник перетекает целиком
      var sum = (aKey === 'available' || aKey === 'end') ? b.sum : a.sum;
      edges.push({ a: a, b: b, cnt: a.cnt, sum: sum, color: b.color, label: PF_LABELS[aKey] + ' → ' + PF_LABELS[bKey] });
    }
  }
  link('start', 'available'); link('created', 'available'); link('reopened', 'available');
  link('available', 'paid'); link('available', 'refused'); link('available', 'end');
  if (col3.length) {
    col3.forEach(function (u) { if (u.cnt > 0) edges.push({ a: byKey['end'], b: u, cnt: u.cnt, sum: u.sum, color: u.color, label: 'Остаток на конец → ' + u.label }); });
  }

  // Сегменты потоков на сторонах узлов (сверху вниз по порядку соседней колонки)
  function layout(node, list, side) {
    var y = node.y, total = node.cnt || 1;
    list.forEach(function (e) {
      var h = Math.max(1, Math.round(e.cnt / total * node.h));
      if (side === 'out') { e.yA1 = y; e.yA2 = y + h; } else { e.yB1 = y; e.yB2 = y + h; }
      y += h;
    });
  }
  col0.forEach(function (u) { layout(u, edges.filter(function (e) { return e.a === u; }), 'out'); });
  layout(byKey['available'], edges.filter(function (e) { return e.b === byKey['available']; }), 'in');
  layout(byKey['available'], edges.filter(function (e) { return e.a === byKey['available']; }), 'out');
  col2.forEach(function (u) { if (u.key !== 'end') layout(u, edges.filter(function (e) { return e.b === u; }), 'in'); });
  layout(byKey['end'], edges.filter(function (e) { return e.b === byKey['end']; }), 'in'); // available → end
  layout(byKey['end'], edges.filter(function (e) { return e.a === byKey['end']; }), 'out');
  col3.forEach(function (u) { layout(u, edges.filter(function (e) { return e.b === u; }), 'in'); });

  function edgePath(e) {
    var x0 = e.a.x + nodeW, x1 = e.b.x;
    var dx = Math.min(120, Math.max(16, (x1 - x0) / 2));
    return 'M' + x0 + ',' + e.yA1
      + ' C' + (x0 + dx) + ',' + e.yA1 + ' ' + (x1 - dx) + ',' + e.yB1 + ' ' + x1 + ',' + e.yB1
      + ' L' + x1 + ',' + e.yB2
      + ' C' + (x1 - dx) + ',' + e.yB2 + ' ' + (x0 + dx) + ',' + e.yA2 + ' ' + x0 + ',' + e.yA2 + ' Z';
  }

  var svg = '<div style="width:100%;overflow-x:auto">'
    + '<svg viewBox="0 0 ' + svgW + ' ' + totalH + '" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;min-width:820px" role="img" aria-label="Sankey движения портфеля">';
  edges.forEach(function (e) {
    svg += '<path d="' + edgePath(e) + '" fill="' + e.color + '" opacity="0.42">'
      + '<title>' + escapeHtml(e.label) + ': ' + fmt(e.cnt) + ' шт · ' + fmt(e.sum) + ' ₽</title></path>';
  });
  cols.forEach(function (col) {
    col.forEach(function (u) {
      svg += '<rect x="' + u.x + '" y="' + u.y + '" width="' + nodeW + '" height="' + u.h + '" rx="5" fill="' + u.color + '" opacity="0.92">'
        + '<title>' + escapeHtml(u.label) + ': ' + fmt(u.cnt) + ' шт · ' + fmt(u.sum) + ' ₽</title></rect>';
      // Подпись под узлом (в вертикальном зазоре; потоков в зазорах нет)
      var y1 = u.y + u.h + 22, y2 = y1 + 17;
      svg += '<text x="' + (u.x + 2) + '" y="' + y1 + '" font-size="13" font-weight="700" fill="#1f2a44">' + escapeHtml(u.label) + '</text>';
      svg += '<text x="' + (u.x + 2) + '" y="' + y2 + '" font-size="12" fill="#475569">' + fmt(u.cnt) + ' шт · ' + fmt(u.sum) + ' ₽</text>';
    });
  });
  svg += '</svg></div>';
  return svg;
}
