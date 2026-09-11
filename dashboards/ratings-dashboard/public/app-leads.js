/**
 * app-leads.js — вкладка «Лиды по направлениям» (ratings-dashboard).
 *
 * Грузится ПОСЛЕ app-render.js и ДО app-export.js (общий global-scope).
 *
 * ЧТО ДЕЛАЕТ:
 *   Таблица 1 — сводка по направлениям за период (сделки, СОЗДАННЫЕ в периоде,
 *   воронки Sale + Pre Sale, без КОМ): Заведено / Добавлено при работе продаж /
 *   Оплачено / Сумма. Направление — приоритет из товара, иначе «при создании».
 *   Таблица 2 — список сделок с фильтром по направлению и группе стадий
 *   (Оплачено / Отказ / В работе), причиной отказа и собственной кнопкой «Выгрузить».
 *
 * Данные: GET /api/leads-by-direction?from=&to= (buildLeadsByDirection, analyze.js).
 * Период берётся из общего верхнего фильтра даты (#dateFrom/#dateTo).
 */

var leadsState = { data: null, dir: '', group: '' };
var LEADS_GROUP_LABELS = { paid: 'Оплачено', refuse: 'Отказ', work: 'В работе' };
var LEADS_GROUP_ORDER = ['paid', 'refuse', 'work'];

async function loadLeadsTab() {
  var area = document.getElementById('contentAreaNew');
  if (!area) return;
  var from = document.getElementById('dateFrom').value;
  var to = document.getElementById('dateTo').value;
  area.innerHTML = '<div class="loading-state"><div class="spinner"></div><div>Загрузка лидов…</div></div>';
  try {
    var d = await safeFetch((window.BASE_PATH || '') + '/api/leads-by-direction?from='
      + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
    if (d && d.error) throw new Error(d.error);
    leadsState.data = d;
    var names = (d.summary || []).map(function (s) { return s.name; });
    if (leadsState.dir && names.indexOf(leadsState.dir) < 0) leadsState.dir = '';
    renderLeadsTab();
  } catch (e) {
    area.innerHTML = '<div class="error-state">❌ Ошибка загрузки: ' + escapeHtml(e.message) + '</div>';
  }
}

function leadsFilteredDeals() {
  var d = leadsState.data;
  if (!d) return [];
  return (d.deals || []).filter(function (x) {
    if (leadsState.dir && x.dirName !== leadsState.dir) return false;
    if (leadsState.group && x.group !== leadsState.group) return false;
    return true;
  });
}

function leadsStageGroupLabel(g) { return LEADS_GROUP_LABELS[g] || g || '—'; }

function renderLeadsTab() {
  var area = document.getElementById('contentAreaNew');
  var d = leadsState.data;
  if (!area || !d) return;

  var infoEl = document.getElementById('filterInfo');
  if (infoEl) infoEl.textContent = 'точные даты ' + d.from + ' — ' + d.to;

  var html = '';

  // ── Таблица 1: сводка по направлениям ─────────────────────────────────────
  html += '<div class="card" style="margin-top:8px">'
    + '<h2 style="margin:0">Лиды по направлениям</h2>'
    + '<div class="sub" style="margin:6px 0 12px">Сделки, созданные за период (Sale + Pre Sale, без КОМ). '
    + 'Клик по заголовку для сортировки.</div>'
    + '<div style="overflow-x:auto"><table id="leadsSummaryTable"><thead><tr>'
    + '<th class="sort" data-col="0">Направление</th>'
    + '<th class="sort" data-col="1">Заведено, шт</th>'
    + '<th class="sort" data-col="2">Добавлено при работе продаж, шт</th>'
    + '<th class="sort" data-col="3">Оплачено, шт</th>'
    + '<th class="sort" data-col="4">Сумма, ₽</th>'
    + '</tr></thead><tbody id="leadsSummaryBody"></tbody></table></div></div>';

  // ── Таблица 2: список сделок ──────────────────────────────────────────────
  html += '<div class="card" style="margin-top:16px">'
    + '<div class="d-flex align-items-center justify-content-between flex-wrap gap-2">'
    + '<h2 style="margin:0">Сделки по направлениям</h2>'
    + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    + '<label style="font-size:12px;color:#475569">Направление: <select id="leadsDirFilter" class="rc-input" style="width:auto;font-size:12px;padding:4px 8px"></select></label>'
    + '<label style="font-size:12px;color:#475569">Стадии: <select id="leadsGroupFilter" class="rc-input" style="width:auto;font-size:12px;padding:4px 8px"></select></label>'
    + '<button type="button" id="leadsExportBtn" class="btn-excel">📥 Выгрузить</button>'
    + '</div></div>'
    + '<div class="sub" style="margin:6px 0 12px" id="leadsDealsCount"></div>'
    + '<div style="overflow-x:auto"><table id="leadsDealsTable"><thead><tr>'
    + '<th class="sort" data-col="0">ID</th>'
    + '<th class="sort" data-col="1">Название</th>'
    + '<th class="sort" data-col="2">Направление</th>'
    + '<th class="sort" data-col="3">Стадия</th>'
    + '<th class="sort" data-col="4">Причина отказа</th>'
    + '<th class="sort" data-col="5">Сумма, ₽</th>'
    + '<th class="sort" data-col="6">Дата создания</th>'
    + '</tr></thead><tbody id="leadsDealsBody"></tbody></table></div></div>';

  // ── Артефакты ─────────────────────────────────────────────────────────────
  var art = d.artifacts || {};
  var ex = art.excluded || [], un = art.unresolved || [];
  if (ex.length || un.length || art.noDirection || art.refusalsWithoutReason) {
    html += '<div class="card" style="margin-top:16px"><h3 style="margin:0 0 8px">⚠️ Артефакты</h3><div class="sub" style="line-height:1.7">';
    if (ex.length) html += 'Исключено (не направление): <b>' + ex.length + '</b> — ' + escapeHtml(ex.map(function (x) { return x.id; }).slice(0, 20).join(', ')) + (ex.length > 20 ? ' …' : '') + '<br>';
    if (un.length) html += 'Нераспознанный текст направления: <b>' + un.length + '</b> — ' + escapeHtml(un.map(function (x) { return x.dir; }).slice(0, 20).join(', ')) + '<br>';
    if (art.noDirection) html += 'Без направления (ни товар, ни при создании): <b>' + art.noDirection + '</b><br>';
    if (art.refusalsWithoutReason) html += 'Отказных без причины: <b>' + art.refusalsWithoutReason + '</b><br>';
    html += '</div></div>';
  }

  area.innerHTML = html;

  // Сводка
  var body = document.getElementById('leadsSummaryBody');
  var list = (d.summary || []);
  var tot = list.reduce(function (s, x) { return { created: s.created + x.created, added: s.added + x.added, paid: s.paid + x.paid, sum: s.sum + x.sum }; }, { created: 0, added: 0, paid: 0, sum: 0 });
  body.innerHTML = list.map(function (s) {
    return '<tr><td>' + escapeHtml(s.name) + '</td><td>' + fmt(s.created) + '</td><td>' + fmt(s.added) + '</td><td>' + fmt(s.paid) + '</td><td>' + fmt(s.sum) + ' ₽</td></tr>';
  }).join('') + '<tr class="total-row" style="background:#fff8e1;font-weight:700"><td><b>ИТОГО</b></td><td><b>' + fmt(tot.created) + '</b></td><td><b>' + fmt(tot.added) + '</b></td><td><b>' + fmt(tot.paid) + '</b></td><td><b>' + fmt(tot.sum) + ' ₽</b></td></tr>';

  // Фильтры таблицы 2
  var dirSel = document.getElementById('leadsDirFilter');
  dirSel.innerHTML = '<option value="">Все направления</option>' + list.map(function (s) {
    return '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</option>';
  }).join('');
  dirSel.value = leadsState.dir;

  var grpSel = document.getElementById('leadsGroupFilter');
  grpSel.innerHTML = '<option value="">Все стадии</option>' + LEADS_GROUP_ORDER.map(function (g) {
    return '<option value="' + g + '">' + LEADS_GROUP_LABELS[g] + '</option>';
  }).join('');
  grpSel.value = leadsState.group;

  dirSel.addEventListener('change', function () { leadsState.dir = dirSel.value; renderLeadsRows(); });
  grpSel.addEventListener('change', function () { leadsState.group = grpSel.value; renderLeadsRows(); });
  document.getElementById('leadsExportBtn').addEventListener('click', exportLeadsTable);

  renderLeadsRows();
  initTableSort('leadsSummaryTable');
  initTableSort('leadsDealsTable');
}

function renderLeadsRows() {
  var body = document.getElementById('leadsDealsBody');
  if (!body) return;
  var rows = leadsFilteredDeals();
  var cntEl = document.getElementById('leadsDealsCount');
  if (cntEl) {
    var sum = rows.reduce(function (s, x) { return s + (x.sum || 0); }, 0);
    cntEl.textContent = 'Сделок: ' + fmt(rows.length) + ' · сумма: ' + fmt(sum) + ' ₽';
  }
  body.innerHTML = rows.map(function (x) {
    return '<tr>'
      + '<td>' + escapeHtml(x.id) + '</td>'
      + '<td>' + escapeHtml(x.title || '') + '</td>'
      + '<td>' + escapeHtml(x.dirName || '—') + '</td>'
      + '<td>' + escapeHtml(x.stageName || '—') + '</td>'
      + '<td>' + escapeHtml(x.reason || '—') + '</td>'
      + '<td>' + fmt(x.sum) + ' ₽</td>'
      + '<td>' + escapeHtml(x.created || '—') + '</td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:#888;padding:16px">Нет сделок под фильтром</td></tr>';
}

// Выгрузка ТОЛЬКО таблицы 2 (с учётом выбранных фильтров).
async function exportLeadsTable() {
  var d = leadsState.data;
  if (!d) return;
  var rows = leadsFilteredDeals();
  var sheet = {
    name: 'Лиды по направлениям',
    header: ['ID', 'Название', 'Направление', 'Стадия', 'Причина отказа', 'Сумма, ₽', 'Дата создания'],
    rows: rows.map(function (x) {
      return [x.id, x.title || '', x.dirName || '—', x.stageName || '—', x.reason || '—', x.sum || 0, x.created || '—'];
    })
  };
  var fileName = 'leads_by_direction_' + (d.from || '') + '_' + (d.to || '') + '.xlsx';
  try {
    var resp = await fetch((window.BASE_PATH || '') + '/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheets: [sheet], fileName: fileName })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var blob = await resp.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  } catch (e) {
    alert('Ошибка выгрузки: ' + e.message);
  }
}
