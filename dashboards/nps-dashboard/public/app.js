/**
 * nps-dashboard/app.js — фронтенд NPS-дашборда.
 * Хелперы api(), fmt(), escapeHtml(), initTableSort() — из /shared.js (общие).
 */

const MONTHS = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];

let state = { year: new Date().getFullYear(), data: null };

const $ = id => document.getElementById(id);

// ── Презентационные хелперы (специфичны для NPS, не дублируют shared) ───────────

// Дельта со знаком и цветом. Классы .delta-up/.delta-down/.delta-flat — из shared.css.
function deltaHtml(val, pp) {
  if (val === null || val === undefined || val === 0) return '—';
  const cls = val > 0 ? 'delta-up' : 'delta-down';
  const sign = val > 0 ? '+' : '';
  return '<span class="' + cls + '">' + sign + val.toFixed(1) + (pp ? ' п.п.' : '%') + '</span>';
}

function npsClass(val) {
  if (val >= 70) return 'nps-high';
  if (val >= 30) return 'nps-mid';
  return 'nps-low';
}

function pct(val) { return val > 0 ? val + '%' : '—'; }
function score(val) { return val > 0 ? val.toFixed(2) : '—'; }

function setKpi(cardId, text) {
  const el = document.querySelector('#' + cardId + ' .val');
  if (el) el.textContent = text;
}

// ── Рендер ──────────────────────────────────────────────────────────────────────

function monthRowHtml(m, isTotal) {
  const label = isTotal ? 'Итого' : MONTHS[m.month - 1];
  const npsCell = m.sent > 0
    ? '<td class="' + npsClass(m.nps) + '">' + m.nps.toFixed(1) + '%</td>'
    : '<td>—</td>';
  return '' +
    '<td><strong>' + label + '</strong></td>' +
    '<td>' + fmt(m.sent) + '</td>' +
    '<td>' + fmt(m.notFilled) + '</td>' +
    '<td>' + fmt(m.filled) + '</td>' +
    '<td>' + pct(m.conversion) + '</td>' +
    '<td>' + deltaHtml(m.conversionGrowth) + '</td>' +
    '<td>' + fmt(m.promoters) + '</td>' +
    '<td>' + fmt(m.neutrals) + '</td>' +
    '<td>' + fmt(m.detractors) + '</td>' +
    '<td>' + pct(m.detractorPct) + '</td>' +
    npsCell +
    '<td>' + score(m.avgScore) + '</td>' +
    '<td>' + deltaHtml(m.npsGrowth) + '</td>' +
    '<td>' + deltaHtml(m.npsGrowthAbs, true) + '</td>';
}

function sliceRowsHtml(items) {
  return items.map(d =>
    '<tr>' +
      '<td><strong>' + escapeHtml(d.label) + '</strong></td>' +
      '<td>' + fmt(d.sent) + '</td>' +
      '<td>' + fmt(d.filled) + '</td>' +
      '<td>' + pct(d.conversion) + '</td>' +
      '<td>' + fmt(d.promoters) + '</td>' +
      '<td>' + fmt(d.neutrals) + '</td>' +
      '<td>' + fmt(d.detractors) + '</td>' +
      '<td class="' + npsClass(d.nps) + '">' + d.nps + '%</td>' +
      '<td>' + score(d.avgScore) + '</td>' +
    '</tr>'
  ).join('');
}

function render() {
  const { data, year } = state;
  if (!data || !data.months) return;

  const loaded = data._loadedAt
    ? new Date(data._loadedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  $('refreshInfo').textContent = '(за ' + year + ' год' + (loaded ? ' · данные на ' + loaded : '') + ')';

  // KPI — последний месяц с данными
  const last = [...data.months].reverse().find(m => m.sent > 0);
  if (last) {
    setKpi('kpiNps', last.nps.toFixed(1) + '%');
    setKpi('kpiConversion', pct(last.conversion));
    setKpi('kpiFilled', fmt(last.filled));
    setKpi('kpiSent', fmt(last.sent));
  }

  // Помесячная таблица
  const body = $('npsTableBody');
  const rows = data.months.filter(m => m.sent > 0).map(m => '<tr>' + monthRowHtml(m, false) + '</tr>');
  if (data.total && data.total.sent > 0) {
    const promoters = data.months.reduce((s, m) => s + m.promoters, 0);
    const neutrals  = data.months.reduce((s, m) => s + m.neutrals, 0);
    const detractors = data.months.reduce((s, m) => s + m.detractors, 0);
    const filled = data.total.filled;
    rows.push('<tr class="total-row">' + monthRowHtml({
      month: 0, sent: data.total.sent, notFilled: data.total.sent - filled, filled,
      conversion: data.total.conversion, conversionGrowth: null,
      promoters, neutrals, detractors,
      detractorPct: filled > 0 ? Math.round((detractors / filled) * 1000) / 10 : 0,
      nps: data.total.nps, avgScore: data.total.avgScore,
      npsGrowth: null, npsGrowthAbs: null,
    }, true) + '</tr>');
  }
  body.innerHTML = rows.join('');

  // Срезы
  const s = data.slices || {};
  const hasAny = ['directions', 'formats', 'clientTypes'].some(k => (s[k] || []).length > 0);
  $('slicesCard').style.display = hasAny ? 'block' : 'none';
  if (hasAny) {
    $('directionsBody').innerHTML = sliceRowsHtml(s.directions || []);
    $('formatBody').innerHTML = sliceRowsHtml(s.formats || []);
    $('b2bBody').innerHTML = sliceRowsHtml(s.clientTypes || []);
  }

  // Текстовые выводы — Bootstrap alerts
  const insights = $('insightsBlock');
  if (data.insights && data.insights.length) {
    const alertClass = { good: 'alert-success', bad: 'alert-danger', mid: 'alert-warning', neutral: 'alert-info' };
    const emoji = { good: '🟢', bad: '🔴', mid: '🟡', neutral: '💡' };
    insights.innerHTML = data.insights.map(i =>
      '<div class="alert ' + (alertClass[i.type] || 'alert-info') + ' py-2 mb-2">' +
        (emoji[i.type] || '💡') + ' ' + escapeHtml(i.text) +
      '</div>'
    ).join('');
    insights.style.display = 'block';
  } else {
    insights.style.display = 'none';
  }

  // Сортировка — после отрисовки ВСЕХ таблиц
  ['npsTable', 'directionsTable', 'formatTable', 'b2bTable'].forEach(id => initTableSort(id));
}

// ── Загрузка ──────────────────────────────────────────────────────────────────

async function loadData(year) {
  try {
    state.data = await api('/api/data?year=' + year);
    state.year = year;
    render();
  } catch (e) {
    console.error('loadData error:', e);
    $('npsTableBody').innerHTML =
      '<tr><td colspan="14" class="text-danger p-3">Ошибка загрузки: ' + escapeHtml(e.message) + '</td></tr>';
  }
}

async function init() {
  await loadData(state.year);
}

init();
