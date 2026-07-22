var _p = window.location.pathname;
var _m = _p.match(/^\/([^/]+)\//);
window.BASE_PATH = _m ? '/' + _m[1] : '';

const NAVY = '#1F3A5F', BLUE = '#2E6DA4', GREEN = '#38A169', ORANGE = '#DD6B20';
let chartInstances = {}, dataCache = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurr(v) { return v ? Number(v).toLocaleString('ru-RU') + ' ₽' : '0 ₽'; }
function fmtPct(v)  { return (v !== undefined && v !== null) ? Number(v).toFixed(1) + '%' : '0.0%'; }
function fmtNum(v)  { return (v !== undefined && v !== null) ? Number(v).toLocaleString('ru-RU') : '0'; }
function fmtDur(v)  { return v ? v + ' дн.' : '0 дн.'; }
function escapeHtml(s) {
  return s ? s.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
}

async function safeFetch(path) {
  const resp = await fetch((window.BASE_PATH || '') + path);
  if (resp.redirected || resp.url.endsWith('/login')) { window.location.href = '/login'; throw new Error('redirect'); }
  const text = await resp.text();
  if (text.startsWith('<!DOCTYPE')) { window.location.href = '/login'; throw new Error('redirect'); }
  return JSON.parse(text);
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.getElementById('komTabs').addEventListener('click', function(e) {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  const id = tab.dataset.tab;
  document.querySelectorAll('#komTabs .tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.querySelectorAll('.tab-area').forEach(a => a.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  setTimeout(() => { Object.values(chartInstances).forEach(c => { if (c && c.resize) c.resize(); }); }, 100);
});

// ── Table sort ────────────────────────────────────────────────────────────────

function initTableSort() {
  document.querySelectorAll('table.sortable').forEach(tbl => {
    const ths = tbl.querySelectorAll('thead th.sort');
    ths.forEach(th => {
      if (th._sortBound) return;
      th._sortBound = true;
      th.addEventListener('click', () => {
        const col = parseInt(th.dataset.col);
        const tbody = tbl.querySelector('tbody');
        if (!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('tr:not(.total-row)'));
        const totalRows = Array.from(tbody.querySelectorAll('tr.total-row'));
        const isAsc = th.classList.contains('asc');
        ths.forEach(h => h.classList.remove('asc', 'desc'));
        th.classList.add(isAsc ? 'desc' : 'asc');
        rows.sort((a, b) => {
          const va = (a.cells[col]?.innerText || '').trim();
          const vb = (b.cells[col]?.innerText || '').trim();
          const na = parseFloat(va.replace(/[^\d\-.,]/g, '').replace(',', ''));
          const nb = parseFloat(vb.replace(/[^\d\-.,]/g, '').replace(',', ''));
          if (!isNaN(na) && !isNaN(nb)) return isAsc ? na - nb : nb - na;
          return isAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        });
        [...totalRows, ...rows].forEach(r => tbody.appendChild(r));
      });
    });
  });
}

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const data = await safeFetch('/api/data');
    if (!data.ready) {
      document.getElementById('kpiGrid').innerHTML = '<div class="error-state">❌ ' + escapeHtml(data.error || 'Нет данных') + '</div>';
      return;
    }
    dataCache = data;
    renderAll(data);
    setTimeout(initTableSort, 150);
    loadExtended();
  } catch (e) {
    document.getElementById('kpiGrid').innerHTML = '<div class="error-state">❌ ' + escapeHtml(e.message) + '</div>';
  }
}

async function loadExtended() {
  try {
    const ext = await safeFetch('/api/kom-extended');
    renderCompaniesTable(ext.companies || []);
    renderManagersTable(ext.managers || []);
    renderPotentialTable(ext.potential || []);
    setTimeout(initTableSort, 100);
  } catch (e) {
    console.error('loadExtended:', e);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll(data) {
  const k = data.kpi;
  const timeEl = document.getElementById('updateTime');
  if (timeEl && data.updatedAt) {
    const dt = new Date(data.updatedAt);
    timeEl.textContent = '(Данные на: ' + dt.toLocaleDateString('ru-RU') + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ')';
  }

  if (data.note) {
    const ib = document.getElementById('infoBox');
    ib.innerHTML = '<b>📌 ' + escapeHtml(data.note) + '</b>';
    ib.style.display = '';
  }

  document.getElementById('kpiGrid').innerHTML =
    '<div class="kpi-card accent"><div class="label">Поступления КОМ</div><div class="value">' + fmtCurr(k.totalRevenue) + '</div><div class="sub">Факт. поступлений</div></div>' +
    '<div class="kpi-card"><div class="label">Лиды КОМ ✋</div><div class="value">' + fmtNum(k.totalLeads) + '</div><div class="sub">Входящих обращений</div></div>' +
    '<div class="kpi-card"><div class="label">Платящие КОМ</div><div class="value">' + fmtNum(k.totalPaid) + '</div><div class="sub">Оплаченных сделок</div></div>' +
    '<div class="kpi-card accent"><div class="label">Ср. чек сделки</div><div class="value">' + fmtCurr(k.avgCheck) + '</div><div class="sub">WON сделки</div></div>' +
    '<div class="kpi-card warn"><div class="label">Конверсия Лиды→Плат</div><div class="value">' + fmtPct(k.conversion) + '</div><div class="sub">Из лидов в оплату</div></div>' +
    '<div class="kpi-card warn"><div class="label">Длительность закрытия</div><div class="value">' + fmtDur(k.avgDuration) + '</div><div class="sub">Ср. срок</div></div>' +
    '<div class="kpi-card"><div class="label">Тренинг дней КОМ</div><div class="value">' + fmtNum(k.trainingDays) + '</div><div class="sub">Суммарно</div></div>' +
    '<div class="kpi-card"><div class="label">Участников</div><div class="value">' + fmtNum(k.participants) + '</div><div class="sub"></div></div>';

  if (data.dealsNote) document.getElementById('dealsNote').textContent = data.dealsNote;
  renderMonthlyTable(data.monthly);
  renderWeeklyTable(data.weekly);
  renderDealsTable(data.topDeals);
  renderCharts(data.monthly, data.weekly);
}

function renderMonthlyTable(monthly) {
  if (!monthly || !monthly.length) { document.getElementById('monthlyTableWrap').innerHTML = '<div class="error-state">Нет данных</div>'; return; }
  let html = '<div class="scroll-x"><table class="sortable"><thead><tr>' +
    '<th class="sort" data-col="0">Месяц</th><th class="sort" data-col="1">Поступления</th><th class="sort" data-col="2">Лиды ✋</th><th class="sort" data-col="3">Платящие</th>' +
    '<th class="sort" data-col="4">Ср. чек</th><th class="sort" data-col="5">Конверсия %</th><th class="sort" data-col="6">Длит. закрытия</th><th class="sort" data-col="7">Участников</th>' +
    '</tr></thead><tbody>';
  let tr = 0, tl = 0, tp = 0, tpt = 0, tdur_weighted = 0, tdur_paid = 0;
  for (const m of monthly) {
    tr += m.revenue; tl += m.leads; tp += m.paid; tpt += m.participants || 0;
    if (m.paid > 0) { tdur_weighted += m.avgDuration * m.paid; tdur_paid += m.paid; }
    html += '<tr><td><b>' + m.monthName + '</b></td><td>' + fmtCurr(m.revenue) + '</td><td>' + m.leads + '</td><td>' + m.paid + '</td>' +
      '<td>' + fmtCurr(m.avgCheck) + '</td><td>' + fmtPct(m.conversion) + '</td><td>' + fmtDur(m.avgDuration) + '</td><td>' + (m.participants || 0) + '</td></tr>';
  }
  const tac = tp ? Math.round(tr / tp) : 0;
  const tconv = (tp && tl) ? tp / tl * 100 : 0;
  const tdur_avg = tdur_paid ? Math.round(tdur_weighted / tdur_paid) : 0;
  html += '<tr class="total-row"><td>ИТОГО</td><td>' + fmtCurr(tr) + '</td><td>' + tl + '</td><td>' + tp + '</td><td>' + fmtCurr(tac) + '</td><td>' + fmtPct(tconv) + '</td><td>' + fmtDur(tdur_avg) + '</td><td>' + tpt + '</td></tr>';
  html += '</tbody></table></div>';
  document.getElementById('monthlyTableWrap').innerHTML = html;
}

function renderWeeklyTable(weekly) {
  if (!weekly || !weekly.length) { document.getElementById('weeklyTableWrap').innerHTML = '<div class="error-state">Нет данных</div>'; return; }
  let html = '<div class="scroll-x"><table class="sortable"><thead><tr>' +
    '<th class="sort" data-col="0">Неделя</th><th class="sort" data-col="1">Даты</th><th class="sort" data-col="2">Выручка</th><th class="sort" data-col="3">Лиды</th><th class="sort" data-col="4">Платящие</th>' +
    '<th class="sort" data-col="5">Ср. чек</th><th class="sort" data-col="6">Конв. %</th><th class="sort" data-col="7">Длит. закрытия</th>' +
    '</tr></thead><tbody>';
  let tr = 0, tl = 0, tp = 0, tdur_weighted = 0, tdur_paid = 0;
  for (const w of weekly) {
    tr += w.revenue; tl += w.leads; tp += w.paid;
    if (w.paid > 0) { tdur_weighted += w.avgDuration * w.paid; tdur_paid += w.paid; }
    html += '<tr><td>' + w.label + '</td><td>' + w.dates + '</td><td>' + fmtCurr(w.revenue) + '</td><td>' + w.leads + '</td><td>' + w.paid + '</td>' +
      '<td>' + fmtCurr(w.avgCheck) + '</td><td>' + fmtPct(w.conversion) + '</td><td>' + fmtDur(w.avgDuration) + '</td></tr>';
  }
  const tac = tp ? Math.round(tr / tp) : 0;
  const tconv = (tp && tl) ? tp / tl * 100 : 0;
  const tdur_avg = tdur_paid ? Math.round(tdur_weighted / tdur_paid) : 0;
  html += '<tr class="total-row"><td><b>📊 ИТОГО</b></td><td></td><td>' + fmtCurr(tr) + '</td><td>' + tl + '</td><td>' + tp + '</td><td>' + fmtCurr(tac) + '</td><td>' + fmtPct(tconv) + '</td><td>' + fmtDur(tdur_avg) + '</td></tr>';
  html += '</tbody></table></div>';
  document.getElementById('weeklyTableWrap').innerHTML = html;
}

function renderDealsTable(deals) {
  if (!deals || !deals.length) { document.getElementById('dealsTableWrap').innerHTML = '<div class="error-state">Нет данных</div>'; return; }
  let html = '<div class="scroll-x"><table class="sortable"><thead><tr>' +
    '<th class="sort" data-col="0">#</th><th class="sort" data-col="1" style="text-align:left">Сделка / Менеджер</th><th class="sort" data-col="2">Поступления</th><th class="sort" data-col="3">Тип клиента</th>' +
    '<th class="sort" data-col="4">Нач. обучения</th><th class="sort" data-col="5">Конец обучения</th><th class="sort" data-col="6">Гонорар препод.</th><th class="sort" data-col="7">Дата оплаты</th>' +
    '</tr></thead><tbody>';
  for (const d of deals) {
    html += '<tr' + (d.rank <= 3 ? ' class="top3"' : '') + '><td>' + d.rank + '</td>' +
      '<td class="tdleft"><span class="deal-title">' + escapeHtml(d.title) + '</span><br><small class="muted">' + escapeHtml(d.manager) + '</small></td>' +
      '<td>' + fmtCurr(d.revenue) + '</td><td><span class="badge ' + (d.clientType === 'repeat' ? 'badge-return' : 'badge-new') + '">' + (d.clientType === 'repeat' ? '🔄 Повторный' : '🆕 Новый') + '</span></td>' +
      '<td>' + (d.trainStart || '—') + '</td><td>' + (d.trainEnd || '—') + '</td>' +
      '<td>' + (d.teacherFee !== null && d.teacherFee !== undefined ? fmtCurr(d.teacherFee) : '—') + '</td><td>' + (d.payDate || '—') + '</td></tr>';
  }
  html += '</tbody></table></div>';
  document.getElementById('dealsTableWrap').innerHTML = html;
}

function renderCompaniesTable(companies) {
  if (!companies.length) { document.getElementById('companiesTableWrap').innerHTML = '<div class="error-state">Нет данных</div>'; return; }
  let html = '<div class="scroll-x"><table class="sortable"><thead><tr>' +
    '<th class="sort tight" data-col="0">#</th><th class="sort wide" data-col="1" style="text-align:left">Компания</th>' +
    '<th class="sort mid" data-col="2">Доход, ₽</th><th class="sort tight3" data-col="3">Оплач.</th><th class="sort tight3" data-col="4">Сд.</th>' +
    '<th class="sort tdlong" data-col="5" style="text-align:left">Менеджер</th>' +
    '</tr></thead><tbody>';
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    html += '<tr' + (i < 3 ? ' class="top3"' : '') + '><td class="tight">' + (i + 1) + '</td><td class="tdleft wide"><b>' + escapeHtml(c.name) + '</b></td>' +
      '<td class="mid"><b>' + fmtCurr(c.paidRevenue) + '</b></td><td class="tight3">' + c.paidCount + '</td><td class="tight3">' + c.dealCount + '</td>' +
      '<td class="tdleft tdlong">' + (c.managers || []).join(', ') + '</td></tr>';
  }
  html += '</tbody></table></div>';
  document.getElementById('companiesTableWrap').innerHTML = html;
}

function renderManagersTable(managers) {
  if (!managers.length) { document.getElementById('managersTableWrap').innerHTML = '<div class="error-state">Нет данных</div>'; return; }
  let html = '<div class="scroll-x"><table class="sortable"><thead><tr>' +
    '<th class="sort tight" data-col="0">#</th><th class="sort tdlong" data-col="1" style="text-align:left">Менеджер</th>' +
    '<th class="sort mid" data-col="2">Пост., ₽</th><th class="sort tight2" data-col="3">Сд.</th><th class="sort tight2" data-col="4">WON</th><th class="sort tdlong" data-col="5" style="text-align:left">Компании</th>' +
    '</tr></thead><tbody>';
  for (let i = 0; i < managers.length; i++) {
    const m = managers[i];
    html += '<tr><td class="tight">' + (i + 1) + '</td><td class="tdleft tdlong"><b>' + escapeHtml(m.name) + '</b></td>' +
      '<td class="mid"><b>' + fmtCurr(m.totalRevenue) + '</b></td><td class="tight2">' + m.dealCount + '</td><td class="tight2">' + (m.wonCount || 0) + '</td>' +
      '<td class="tdleft tdlong">' + (m.companies || []).slice(0, 3).join(', ') + ((m.companies || []).length > 3 ? '…' : '') + '</td></tr>';
  }
  html += '</tbody></table></div>';
  document.getElementById('managersTableWrap').innerHTML = html;
}

function renderPotentialTable(potential) {
  if (!potential.length) { document.getElementById('potentialTableWrap').innerHTML = '<div class="error-state">Нет данных</div>'; return; }
  let html = '<div class="scroll-x"><table class="sortable"><thead><tr>' +
    '<th class="sort tight" data-col="0">#</th><th class="sort wide" data-col="1" style="text-align:left">Компания</th>' +
    '<th class="sort mid" data-col="2">Потенциал, ₽</th><th class="sort tight3" data-col="3">Сд.</th>' +
    '<th class="sort tdlong" data-col="4" style="text-align:left">Темы</th><th class="sort tdlong" data-col="5" style="text-align:left">Менеджер</th>' +
    '</tr></thead><tbody>';
  for (let i = 0; i < potential.length; i++) {
    const c = potential[i];
    html += '<tr' + (i < 3 ? ' class="top3"' : '') + '><td class="tight">' + (i + 1) + '</td><td class="tdleft wide"><b>' + escapeHtml(c.name) + '</b></td>' +
      '<td class="mid"><b>' + fmtCurr(c.pendingRevenue) + '</b></td><td class="tight3">' + c.dealCount + '</td>' +
      '<td class="tdleft tdlong">' + (c.themes || []).slice(0, 3).join('; ') + '</td>' +
      '<td class="tdleft tdlong">' + (c.managers || []).join(', ') + '</td></tr>';
  }
  html += '</tbody></table></div>';
  document.getElementById('potentialTableWrap').innerHTML = html;
}

// ── Charts ────────────────────────────────────────────────────────────────────

function renderCharts(monthly, weekly) {
  function dstr(id, cfg) {
    if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
    const el = document.getElementById(id);
    if (el) chartInstances[id] = new Chart(el, cfg);
  }
  const opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } } };
  const ml  = monthly.map(m => m.monthName.substring(0, 3));
  const mr  = monthly.map(m => Math.round(m.revenue / 1000));
  const ll  = monthly.map(m => m.leads);
  const pl  = monthly.map(m => m.paid);
  const cl  = monthly.map(m => m.conversion);
  const dl  = monthly.map(m => m.avgDuration);
  const wl  = weekly.map(w => w.label);
  const wr  = weekly.map(w => Math.round(w.revenue / 1000));
  const wle = weekly.map(w => w.leads);
  const wpa = weekly.map(w => w.paid);

  dstr('chartLidsMonth', { type: 'bar',  data: { labels: ml, datasets: [{ label: 'Лиды',     data: ll, backgroundColor: BLUE }, { label: 'Платящие', data: pl, backgroundColor: GREEN }] }, options: opts });
  dstr('chartRevMonth',  { type: 'line', data: { labels: ml, datasets: [{ label: 'Выручка, тыс.₽', data: mr, borderColor: NAVY, backgroundColor: 'rgba(31,58,95,.1)', fill: true, tension: .3 }] }, options: opts });
  dstr('chartConvMonth', { type: 'line', data: { labels: ml, datasets: [{ label: 'Конверсия %', data: cl, borderColor: ORANGE, backgroundColor: 'rgba(221,107,32,.1)', fill: true, tension: .3 }] }, options: { ...opts, scales: { y: { beginAtZero: true, ticks: { callback: v => v + '%' } } } } });
  dstr('chartDurMonth',  { type: 'line', data: { labels: ml, datasets: [{ label: 'Длит., дн.',  data: dl, borderColor: NAVY, backgroundColor: 'rgba(31,58,95,.1)', fill: true, tension: .3 }] }, options: opts });
  dstr('chartFunnelMonth', { type: 'bar', data: { labels: ml, datasets: [{ label: 'Лиды', data: ll, backgroundColor: BLUE }, { label: 'Платящие', data: pl, backgroundColor: GREEN }] }, options: opts });
  dstr('chartRevMonth2',   { type: 'line', data: { labels: ml, datasets: [{ label: 'Выручка, тыс.₽', data: mr, borderColor: NAVY, backgroundColor: 'rgba(31,58,95,.1)', fill: true, tension: .3 }] }, options: opts });
  dstr('chartLidsWeek',    { type: 'bar',  data: { labels: wl, datasets: [{ label: 'Лиды', data: wle, backgroundColor: BLUE }, { label: 'Платящие', data: wpa, backgroundColor: GREEN }] }, options: opts });
  dstr('chartRevWeek',     { type: 'line', data: { labels: wl, datasets: [{ label: 'Выручка, тыс.₽', data: wr, borderColor: NAVY, backgroundColor: 'rgba(31,58,95,.1)', fill: true, tension: .3 }] }, options: opts });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

loadData();
