/**
 * plan-fact-dashboard/app.js — фронтенд дашборда «План-факт выручки».
 *
 * ЗАЧЕМ: показывает выручку в разрезах неделя × направление × формат и вкладки
 *   сравнения план/факт. Вся агрегация — на сервере (/api/data); здесь только рендер.
 * ЧТО ДЕЛАЕТ: грузит готовые агрегаты в dataCache, переключает вкладки (currentTab),
 *   рисует таблицы (renderWeekly и др.) с ИТОГО по неделям.
 *
 * Хелперы api(), fmt(), escapeHtml(), initTableSort() — в /shared.js.
 */

var dataCache = null;
var currentTab = 'weekly';

function money(n) { return n ? fmt(n) : '—'; }
function num(n) { return n ? fmt(n) : '—'; }

// ── «По неделям»: неделя × направление × формат, ИТОГО по каждой неделе ──────
function renderWeekly(d) {
  var weekly = d.weekly || [];
  if (!weekly.length) return '<div class="alert alert-warning">Нет данных по неделям</div>';

  // Селектор недели: все + конкретная (по умолчанию — все)
  var html = '<div class="d-flex align-items-center gap-2 mb-3">'
    + '<label for="weekFilter" class="mb-0 fw-semibold">Неделя:</label>'
    + '<select id="weekFilter" class="form-select form-select-sm w-auto">'
    + '<option value="">Все недели</option>';
  weekly.forEach(function(w) {
    html += '<option value="' + w.week + '">' + w.dates + '</option>';
  });
  html += '</select></div>';

  html += '<div id="weeklyTableWrap">' + buildWeeklyTable(weekly, null) + '</div>';
  return html;
}

function buildWeeklyTable(weekly, onlyWeek) {
  var html = '<table class="table table-sm table-hover align-middle text-center"><thead><tr>'
    + '<th class="text-nowrap sticky-top">Месяц</th>'
    + '<th class="text-nowrap sticky-top">Неделя</th>'
    + '<th class="text-nowrap sticky-top">Формат</th>'
    + '<th class="text-nowrap sticky-top text-start">Направление</th>'
    + '<th class="text-nowrap sticky-top">Факт выручка, ₽</th>'
    + '<th class="text-nowrap sticky-top">Участники</th>'
    + '<th class="text-nowrap sticky-top">Уч. очно</th>'
    + '<th class="text-nowrap sticky-top">Уч. онлайн</th>'
    + '<th class="text-nowrap sticky-top">Дней обучения</th>'
    + '</tr></thead><tbody>';

  var grand = { revenue: 0, participants: 0, uchOch: 0, uchOnl: 0 };
  weekly.forEach(function(w) {
    if (onlyWeek && w.week !== onlyWeek) return;
    w.rows.forEach(function(r) {
      html += '<tr>'
        + '<td>' + escapeHtml(w.month) + '</td>'
        + '<td class="text-nowrap">' + escapeHtml(w.dates) + '</td>'
        + '<td>' + escapeHtml(r.format) + '</td>'
        + '<td class="text-start">' + escapeHtml(r.direction) + '</td>'
        + '<td>' + money(r.revenue) + '</td>'
        + '<td>' + num(r.participants) + '</td>'
        + '<td>' + num(r.uchOch) + '</td>'
        + '<td>' + num(r.uchOnl) + '</td>'
        + '<td>' + num(r.days) + '</td>'
        + '</tr>';
    });
    html += '<tr class="subtotal"><td></td><td class="text-nowrap">' + escapeHtml(w.dates) + '</td><td></td><td class="text-start">ИТОГО</td>'
      + '<td>' + money(w.total.revenue) + '</td>'
      + '<td>' + num(w.total.participants) + '</td>'
      + '<td>' + num(w.total.uchOch) + '</td>'
      + '<td>' + num(w.total.uchOnl) + '</td>'
      + '<td></td></tr>';
    grand.revenue += w.total.revenue;
    grand.participants += w.total.participants;
    grand.uchOch += w.total.uchOch;
    grand.uchOnl += w.total.uchOnl;
  });

  html += '<tr class="grand-total"><td></td><td></td><td></td><td class="text-start"><b>ИТОГО' + (onlyWeek ? '' : ' ГОД') + '</b></td>'
    + '<td>' + money(grand.revenue) + '</td>'
    + '<td>' + num(grand.participants) + '</td>'
    + '<td>' + num(grand.uchOch) + '</td>'
    + '<td>' + num(grand.uchOnl) + '</td>'
    + '<td></td></tr>';
  return html + '</tbody></table>';
}

// ── «Пост/Выр/Уч»: тематики × каналы, 3 группы метрик, переключатель года ───
var postYear = null;

function renderPost(d) {
  if (postYear === null) postYear = d.post.years[0];
  var html = '<div class="d-flex align-items-center gap-2 mb-3">'
    + '<label class="mb-0 fw-semibold">Год:</label>';
  d.post.years.forEach(function(y) {
    html += '<button class="btn btn-sm ' + (y === postYear ? 'btn-primary' : 'btn-outline-primary') + '" data-year="' + y + '">' + y + '</button>';
  });
  html += '</div><div id="postTableWrap">' + buildPostTable(d, postYear) + '</div>';
  return html;
}

function buildPostTable(d, year) {
  var chs = d.channels;
  var rows = d.post.byYear[year] || [];
  var html = '<table class="table table-sm table-hover align-middle text-center sortable" id="tblPost"><thead>';
  html += '<tr><th class="sticky-top"></th>'
    + '<th class="sticky-top group" colspan="4">Поступления, ₽</th>'
    + '<th class="sticky-top group" colspan="4">Участники</th>'
    + '<th class="sticky-top group" colspan="4">Выручка, ₽</th></tr>';
  html += '<tr><th class="sort text-nowrap sticky-top text-start" data-col="0">Тематика</th>';
  var col = 1;
  ['post', 'part', 'rev'].forEach(function() {
    chs.forEach(function(ch) {
      html += '<th class="sort text-nowrap sticky-top" data-col="' + col + '">' + ch + '</th>';
      col++;
    });
  });
  html += '</tr></thead><tbody>';

  var tot = { post: {}, part: {}, rev: {} };
  chs.forEach(function(ch) { tot.post[ch] = 0; tot.part[ch] = 0; tot.rev[ch] = 0; });

  rows.forEach(function(r) {
    html += '<tr><td class="text-start">' + escapeHtml(r.direction) + '</td>';
    ['post', 'part', 'rev'].forEach(function(g) {
      chs.forEach(function(ch) {
        var v = r[g][ch] || 0;
        tot[g][ch] += v;
        html += '<td>' + (g === 'part' ? num(v) : money(Math.round(v))) + '</td>';
      });
    });
    html += '</tr>';
  });

  html += '<tr class="total-row grand-total"><td class="text-start"><b>ИТОГО ' + year + '</b></td>';
  ['post', 'part', 'rev'].forEach(function(g) {
    chs.forEach(function(ch) {
      html += '<td>' + (g === 'part' ? num(tot[g][ch]) : money(Math.round(tot[g][ch]))) + '</td>';
    });
  });
  html += '</tr></tbody></table>';
  return html;
}

// ── «Выручка ОМ»: тематики × месяцы ──────────────────────────────────────────
function renderOm(d) {
  var months = d.om.months;
  var rows = d.om.rows || [];
  var html = '<table class="table table-sm table-hover align-middle text-center sortable" id="tblOm"><thead><tr>';
  html += '<th class="sort text-nowrap sticky-top text-start" data-col="0">Тематика</th>';
  months.forEach(function(m, i) {
    html += '<th class="sort text-nowrap sticky-top" data-col="' + (i + 1) + '">' + m.toLowerCase() + '</th>';
  });
  html += '<th class="sort text-nowrap sticky-top" data-col="13">Итог</th>';
  html += '</tr></thead><tbody>';

  var totByMonth = new Array(12).fill(0), grand = 0;
  rows.forEach(function(r) {
    html += '<tr><td class="text-start">' + escapeHtml(r.direction) + '</td>';
    r.byMonth.forEach(function(v, i) {
      totByMonth[i] += v;
      html += '<td>' + money(Math.round(v)) + '</td>';
    });
    grand += r.total;
    html += '<td><b>' + money(Math.round(r.total)) + '</b></td></tr>';
  });

  html += '<tr class="total-row grand-total"><td class="text-start"><b>ИТОГО</b></td>';
  totByMonth.forEach(function(v) { html += '<td>' + money(Math.round(v)) + '</td>'; });
  html += '<td><b>' + money(Math.round(grand)) + '</b></td></tr>';
  return html + '</tbody></table>';
}

// ── «Выручка СДО»: тематики × годы ───────────────────────────────────────────
function renderSdo(d) {
  var years = d.sdo.years;
  var rows = d.sdo.rows || [];
  var html = '<table class="table table-sm table-hover align-middle text-center sortable" id="tblSdo"><thead><tr>';
  html += '<th class="sort text-nowrap sticky-top text-start" data-col="0">Тематика</th>';
  var col = 1;
  years.forEach(function(y) {
    html += '<th class="sort text-nowrap sticky-top" data-col="' + col + '">' + y + ', ₽</th>'; col++;
    html += '<th class="sort text-nowrap sticky-top" data-col="' + col + '">Участники ' + y + '</th>'; col++;
  });
  html += '<th class="sort text-nowrap sticky-top" data-col="' + col + '">' + years[0] + ' к ' + years[1] + '</th>';
  html += '</tr></thead><tbody>';

  var tot = {};
  years.forEach(function(y) { tot[y] = { s: 0, c: 0 }; });

  rows.forEach(function(r) {
    html += '<tr><td class="text-start">' + escapeHtml(r.direction) + '</td>';
    years.forEach(function(y) {
      tot[y].s += r.sums[y] || 0;
      tot[y].c += r.counts[y] || 0;
      html += '<td>' + money(Math.round(r.sums[y] || 0)) + '</td><td>' + num(r.counts[y] || 0) + '</td>';
    });
    var prev = r.sums[years[1]] || 0;
    var pct = prev > 0 ? Math.round((r.sums[years[0]] || 0) / prev * 100) + '%' : '—';
    html += '<td>' + pct + '</td></tr>';
  });

  html += '<tr class="total-row grand-total"><td class="text-start"><b>ИТОГО</b></td>';
  years.forEach(function(y) {
    html += '<td>' + money(Math.round(tot[y].s)) + '</td><td>' + num(tot[y].c) + '</td>';
  });
  var totPct = tot[years[1]].s > 0 ? Math.round(tot[years[0]].s / tot[years[1]].s * 100) + '%' : '—';
  html += '<td>' + totPct + '</td></tr>';
  return html + '</tbody></table>';
}

// ── Вкладки и загрузка ────────────────────────────────────────────────────────

var RENDERERS = { weekly: renderWeekly, post: renderPost, om: renderOm, sdo: renderSdo };
var SORT_IDS  = { post: 'tblPost', om: 'tblOm', sdo: 'tblSdo' }; // weekly не сортируем: ИТОГО привязаны к неделям

function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tab); });
  var wrap = document.getElementById('tabContent');
  if (!dataCache) return;
  wrap.innerHTML = RENDERERS[tab](dataCache);
  if (SORT_IDS[tab]) setTimeout(function() { initTableSort(SORT_IDS[tab]); }, 50);
  var wf = document.getElementById('weekFilter');
  if (wf) {
    wf.addEventListener('change', function() {
      document.getElementById('weeklyTableWrap').innerHTML =
        buildWeeklyTable(dataCache.weekly, wf.value ? parseInt(wf.value, 10) : null);
    });
  }
  wrap.querySelectorAll('button[data-year]').forEach(function(b) {
    b.addEventListener('click', function() {
      postYear = parseInt(b.dataset.year, 10);
      showTab('post');
    });
  });
}

document.getElementById('tabBar').addEventListener('click', function(e) {
  var tab = e.target.closest('.tab');
  if (tab && tab.dataset.tab !== currentTab) showTab(tab.dataset.tab);
});

async function loadAll() {
  var wrap = document.getElementById('tabContent');
  try {
    dataCache = await api('/api/data');
    if (dataCache.error) {
      wrap.innerHTML = '<div class="alert alert-danger">❌ ' + escapeHtml(dataCache.error) + '</div>';
      return;
    }
    var dateEl = document.getElementById('updateDate');
    if (dateEl && dataCache.fetchedAt) {
      var dt = new Date(dataCache.fetchedAt);
      dateEl.textContent = '(Данные Б24 на: ' + dt.toLocaleDateString('ru-RU') + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ')';
    }
    showTab(currentTab);
  } catch (e) {
    wrap.innerHTML = '<div class="alert alert-danger">❌ Ошибка: ' + escapeHtml(e.message) + '</div>';
  }
}

document.addEventListener('DOMContentLoaded', loadAll);
