/**
 * nps-dashboard/app.js — фронтенд NPS-дашборда.
 */

const MONTHS = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Окторябрь','Ноябрь','Декабрь'
];

// ── Состояние ─────────────────────────────────────────────────────────────────
let state = {
  year: new Date().getFullYear(),
  data: null,
};

// ── DOM-ссылки ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const yearSelect = $('yearSelect');
const npsTableBody = $('npsTableBody');
const kpiNps = $('kpiNps');
const kpiConversion = $('kpiConversion');
const kpiFilled = $('kpiFilled');
const kpiSent = $('kpiSent');
const refreshInfo = $('refreshInfo');

// ── Форматирование ────────────────────────────────────────────────────────────

function fmt(val, decimals) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    if (decimals !== undefined) return val.toFixed(decimals);
    return String(val);
  }
  return String(val);
}

function fmtPct(val, decimals) {
  if (val === null || val === undefined || val === 0) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(decimals !== undefined ? decimals : 1) + '%';
}

function deltaClass(val) {
  if (val === null || val === undefined || val === 0) return 'delta-neutral';
  return val > 0 ? 'delta-up' : 'delta-down';
}

function npsClass(val) {
  if (val >= 70) return 'nps-high';
  if (val >= 30) return 'nps-mid';
  return 'nps-low';
}

// ── Рендер ────────────────────────────────────────────────────────────────────

function renderMonthRow(m, isTotal) {
  const tr = document.createElement('tr');
  if (isTotal) tr.className = 'total-row';

  const label = isTotal ? 'Итого' : MONTHS[m.month - 1];
  const convStr = m.conversion > 0 ? m.conversion + '%' : '—';
  const convGrowthStr = m.conversionGrowth !== null
    ? ('<span class="delta ' + deltaClass(m.conversionGrowth) + '">' + fmtPct(m.conversionGrowth) + '</span>')
    : '—';
  const npsStr = m.sent > 0 ? '<span class="' + npsClass(m.nps) + '">' + fmt(m.nps, 1) + '%</span>' : '—';
  const npsGrowthStr = m.npsGrowth !== null
    ? ('<span class="delta ' + deltaClass(m.npsGrowth) + '">' + fmtPct(m.npsGrowth) + '</span>')
    : '—';
  const npsGrowthAbsStr = m.npsGrowthAbs !== null
    ? ('<span class="delta ' + deltaClass(m.npsGrowthAbs) + '">'
      + (m.npsGrowthAbs >= 0 ? '+' : '') + m.npsGrowthAbs.toFixed(1) + ' п.п.</span>')
    : '—';

  tr.innerHTML = `
    <td><strong>${label}</strong></td>
    <td class="num">${m.sent}</td>
    <td class="num">${m.notFilled}</td>
    <td class="num">${m.filled}</td>
    <td class="num">${convStr}</td>
    <td class="num">${convGrowthStr}</td>
    <td class="num">${m.promoters}</td>
    <td class="num">${m.neutrals}</td>
    <td class="num">${m.detractors}</td>
    <td class="num">${m.detractorPct > 0 ? m.detractorPct + '%' : '—'}</td>
    <td class="num">${npsStr}</td>
    <td class="num">${m.avgScore > 0 ? fmt(m.avgScore, 2) : '—'}</td>
    <td class="num">${npsGrowthStr}</td>
    <td class="num">${npsGrowthAbsStr}</td>
  `;

  return tr;
}

function render() {
  const { data, year } = state;
  if (!data || !data.months) return;

  // Заголовок
  refreshInfo.textContent = 'за ' + year + ' год';

  // Вспомогательная функция отрисовки среза
  function renderSliceTable(bodyId, items) {
    const body = document.getElementById(bodyId);
    if (!body || !items || !items.length) return;
    body.innerHTML = items.map(d =>
      '<tr>' +
        '<td><strong>' + escapeHtml(d.label) + '</strong></td>' +
        '<td class="num">' + d.sent + '</td>' +
        '<td class="num">' + d.filled + '</td>' +
        '<td class="num">' + (d.conversion > 0 ? d.conversion + '%' : '—') + '</td>' +
        '<td class="num">' + d.promoters + '</td>' +
        '<td class="num">' + d.neutrals + '</td>' +
        '<td class="num">' + d.detractors + '</td>' +
        '<td class="num ' + (d.nps >= 70 ? 'nps-high' : d.nps >= 30 ? 'nps-mid' : 'nps-low') + '">' + d.nps + '%</td>' +
        '<td class="num">' + (d.avgScore > 0 ? d.avgScore.toFixed(2) : '—') + '</td>' +
      '</tr>'
    ).join('');
  }

  // Срезы
  if (data.slices) {
    const slicesCard = document.getElementById('slicesCard');
    if (slicesCard) {
      slicesCard.style.display = 'block';
    }
    renderSliceTable('directionsBody', data.slices.directions);
    renderSliceTable('b2bBody', data.slices.clientTypes);
  }

  // Текстовые выводы
  const insightsBlock = document.getElementById('insightsBlock');
  if (data.insights && data.insights.length > 0 && insightsBlock) {
    const emojiMap = { good: '🟢', bad: '🔴', mid: '🟡', neutral: '💡' };
    insightsBlock.innerHTML = data.insights.map(i =>
      '<div class="insight insight-' + i.type + '">' +
        '<span class="insight-icon">' + (emojiMap[i.type] || '💡') + '</span>' +
        '<span class="insight-text">' + escapeHtml(i.text) + '</span>' +
      '</div>'
    ).join('');
    insightsBlock.style.display = 'block';
  } else if (insightsBlock) {
    insightsBlock.style.display = 'none';
  }

  // KPI — берём последний месяц с данными
  const lastWithData = [...data.months].reverse().find(m => m.sent > 0);
  if (lastWithData) {
    kpiNps.querySelector('.kpi-value').textContent = lastWithData.sent > 0
      ? fmt(lastWithData.nps, 1) + '%'
      : '—';
    kpiConversion.querySelector('.kpi-value').textContent = lastWithData.conversion > 0
      ? fmt(lastWithData.conversion, 1) + '%'
      : '—';
    kpiFilled.querySelector('.kpi-value').textContent = fmt(lastWithData.filled);
    kpiSent.querySelector('.kpi-value').textContent = fmt(lastWithData.sent);
  }

  // Таблица
  npsTableBody.innerHTML = '';

  const monthsWithData = data.months.filter(m => m.sent > 0);

  // Строки по месяцам
  for (const m of monthsWithData) {
    npsTableBody.appendChild(renderMonthRow(m, false));
  }

  // Итоговая строка
  if (data.total && data.total.sent > 0) {
    npsTableBody.appendChild(renderMonthRow({
      month: 0,
      sent: data.total.sent,
      notFilled: data.total.sent - data.total.filled,
      filled: data.total.filled,
      conversion: data.total.conversion,
      conversionGrowth: null,
      promoters: data.months.reduce((s, m) => s + m.promoters, 0),
      neutrals: data.months.reduce((s, m) => s + m.neutrals, 0),
      detractors: data.months.reduce((s, m) => s + m.detractors, 0),
      detractorPct: data.total.filled > 0
        ? Math.round((data.months.reduce((s, m) => s + m.detractors, 0) / data.total.filled) * 1000) / 10
        : 0,
      nps: data.total.nps,
      avgScore: data.total.avgScore,
      npsGrowth: null,
      npsGrowthAbs: null,
    }, true));
  }
}

// ── Загрузка данных ───────────────────────────────────────────────────────────

async function loadData(year) {
  try {
    const res = await api('/api/data?year=' + year);
    state.data = res;
    state.year = year;
    render();
  } catch (e) {
    console.error('loadData error:', e);
    npsTableBody.innerHTML = '<tr><td colspan="13" style="color:#C62828;padding:20px;">Ошибка загрузки: ' + escapeHtml(e.message) + '</td></tr>';
  }
}

async function loadYears() {
  try {
    const years = await api('/api/years');
    yearSelect.innerHTML = years.map(y =>
      '<option value="' + y + '"' + (y === state.year ? ' selected' : '') + '>' + y + '</option>'
    ).join('');
    yearSelect.addEventListener('change', () => {
      state.year = parseInt(yearSelect.value, 10);
      loadData(state.year);
    });
  } catch (e) {
    // Если не загрузились — показываем текущий год
    yearSelect.innerHTML = '<option value="' + state.year + '">' + state.year + '</option>';
  }
}

// ── Инициализация ─────────────────────────────────────────────────────────────

async function init() {
  await loadYears();
  await loadData(state.year);
}

init();
