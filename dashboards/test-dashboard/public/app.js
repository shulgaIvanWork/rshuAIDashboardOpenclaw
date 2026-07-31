/**
 * test-dashboard/app.js — фронтенд тестового дашборда «прогноз» (В РАЗРАБОТКЕ).
 * ЗАЧЕМ: рендер прогноза и внешней аналитики (Метрика/Roistat/Bitrix), расчёт мотивации.
 * Данные тянутся из BASE = '/test-dashboard/api' (ниже).
 */

// ============ DATA FETCHING ============
const BASE = '/test-dashboard/api';

async function safeFetch(url, opts) {
  var resp = await fetch(url, opts);
  if (resp.redirected || resp.url.endsWith('/login')) { window.location.href = '/login'; throw new Error('redirect'); }
  var text = await resp.text();
  if (text.startsWith('<!DOCTYPE')) { window.location.href = '/login'; throw new Error('redirect'); }
  return JSON.parse(text);
}

let metrikaData = null, roistatOrders = null, roistatCalls = null, bitrixDeals = null;
let motivCalcData = null, motivationCharts = {};
let plansData = {};
let exportAnalysisData = null, exportCharts = {};
let productsData = null;

async function loadAll() {
  loadMotivation();
  safeFetch(BASE + '/export-analysis').then(d => {
    exportAnalysisData = d;
    renderExportAnalysis();
  }).catch(() => {});

  try {
    const [visits, srcs, orders, calls, deals] = await Promise.all([
      safeFetch(BASE + '/metrika-visits'),
      safeFetch(BASE + '/metrika-sources'),
      safeFetch(BASE + '/roistat-orders'),
      safeFetch(BASE + '/roistat-calls'),
      safeFetch(BASE + '/bitrix-deals'),
    ]);
    metrikaData = { visits, sources: srcs };
    roistatOrders = orders;
    roistatCalls = calls;
    bitrixDeals = deals;
    renderFunnel();
    renderCalls();
    renderChannels();
    renderConversion();
  } catch(e) {
    document.querySelectorAll('.tab-content').forEach(el => {
      el.innerHTML = `<div class="card"><div class="value red">⚠️ Ошибка: ${e.message}</div></div>`;
    });
  }
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, function(m) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
  });
}
function fmt(n) { return (n || 0).toLocaleString('ru-RU'); }

// ============ RENDER ============

// --- 1. Воронка ---
function renderFunnel() {
  const d = bitrixDeals?.sale;
  if (!d) return;
  const total = d.total_all || 0;
  const won = d.won_positive || 0;
  const lose = d.lose || 0;
  const inWork = d.in_progress || 0;
  const tech = d.won_zero || 0;
  const revenue = d.revenue || 0;
  const visitsTotal = metrikaData?.visits?.totals?.[0] || 0;

  document.getElementById('funnel-cards').innerHTML = `
    <div class="card"><h3>Визиты (Метрика)</h3><div class="value blue">${fmt(visitsTotal)}</div><div class="sub">за май 2026</div></div>
    <div class="card"><h3>Сделки Sale</h3><div class="value purple">${fmt(total)}</div><div class="sub">всего в воронке</div></div>
    <div class="card"><h3>WON (с суммой)</h3><div class="value green">${fmt(won)}</div><div class="sub">+ ${fmt(tech)} тех.нулевых</div></div>
    <div class="card"><h3>Выручка</h3><div class="value green">${fmt(revenue)} ₽</div><div class="sub">по WON сделкам с суммой > 0</div></div>
    <div class="card"><h3>Проиграно</h3><div class="value red">${fmt(lose)}</div></div>
    <div class="card"><h3>В работе</h3><div class="value orange">${fmt(inWork)}</div></div>
  `;

  new Chart(document.getElementById('funnelChart'), {
    type: 'bar',
    data: {
      labels: ['Трафик (визиты)', 'Сделки Sale', 'WON (сумма >0)', 'Проиграно', 'В работе'],
      datasets: [{
        label: 'Количество',
        data: [visitsTotal, total, won, lose, inWork],
        backgroundColor: ['#3b82f6', '#8b5cf6', '#22c55e', '#ef4444', '#f59e0b'],
        borderRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => fmt(v) } } }
    }
  });

  const convVisitsToDeals = visitsTotal > 0 ? ((total / visitsTotal) * 100).toFixed(2) : 0;
  const convToWon = total > 0 ? ((won / total) * 100).toFixed(1) : 0;
  const convWonToRev = won > 0 ? (revenue / won).toFixed(0) : 0;
  document.getElementById('funnel-table').innerHTML = `
    <table>
      <tr><th>Этап</th><th>Кол-во</th><th>Конверсия</th><th>Сумма / Средний чек</th></tr>
      <tr><td>🌐 Трафик (визиты)</td><td>${fmt(visitsTotal)}</td><td>100%</td><td>—</td></tr>
      <tr><td>📋 Сделки Sale</td><td>${fmt(total)}</td><td>${convVisitsToDeals}% от трафика</td><td>—</td></tr>
      <tr><td>✅ WON (с суммой)</td><td>${fmt(won)}</td><td>${convToWon}% от сделок</td><td>${fmt(revenue)} ₽</td></tr>
      <tr><td>💰 Средний чек</td><td>—</td><td>—</td><td><strong>${fmt(parseInt(convWonToRev))} ₽</strong></td></tr>
    </table>
  `;
}

// --- 2. Коллтрекинг ---
function renderCalls() {
  const calls = roistatCalls?.summary;
  if (!calls) return;
  const visitsTotal = metrikaData?.visits?.totals?.[0] || 0;

  document.getElementById('calls-cards').innerHTML = `
    <div class="card"><h3>Всего звонков</h3><div class="value blue">${fmt(calls.total)}</div><div class="sub">за май 2026</div></div>
    <div class="card"><h3>Дозвоны</h3><div class="value green">${fmt(calls.answered)}</div><div class="sub">${((calls.answered / calls.total) * 100).toFixed(1)}% дозвон</div></div>
    <div class="card"><h3>Уникальных номеров</h3><div class="value purple">${fmt(calls.unique_callers)}</div></div>
    <div class="card"><h3>Средняя длит.</h3><div class="value orange">${Math.round(calls.avg_duration || 0)} сек</div><div class="sub">по ответившим</div></div>
  `;

  const callsByDay = roistatCalls?.by_day || [];
  const visits = metrikaData?.visits?.rows || [];
  const labels = Array.from({length: 31}, (_, i) => `0${i+1}.05`.slice(-5));
  const callData = labels.map((_,i) => {
    const day = `2026-05-${String(i+1).padStart(2,'0')}`;
    const match = callsByDay.find(c => c.date?.slice(0,10) === day);
    return match?.count || 0;
  });
  const visitData = labels.map((_,i) => {
    const day = `2026-05-${String(i+1).padStart(2,'0')}`;
    const match = visits.find(v => v.date === day);
    return match?.visits || 0;
  });

  new Chart(document.getElementById('callsChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Звонки', data: callData, backgroundColor: '#3b82f6', borderRadius: 2 },
        { label: 'Визиты (Метрика)', data: visitData, backgroundColor: '#22c55e', borderRadius: 2, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Звонки' } },
        y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Визиты' } }
      }
    }
  });

  const callDates = roistatCalls?.by_day || [];
  document.getElementById('calls-table').innerHTML = `
    <table>
      <tr><th>Дата</th><th>Звонков</th><th>Дозвонов</th><th>Длительность (средн.)</th><th>Визитов</th></tr>
      ${callDates.slice(0, 31).map(c => {
        const v = visits.find(v2 => v2.date === c.date?.slice(0,10));
        return `<tr><td>${c.date?.slice(0,10) || '—'}</td><td>${fmt(c.count||0)}</td><td>${fmt(c.answered||0)}</td><td>${Math.round(c.avg_duration||0)}</td><td>${fmt(v?.visits || 0)}</td></tr>`;
      }).join('')}
    </table>
  `;
}

// --- 3. Каналы ---
function renderChannels() {
  const srcs = metrikaData?.sources?.data || [];

  document.getElementById('channels-cards').innerHTML = `
    <div class="card"><h3>Источников трафика</h3><div class="value blue">${srcs.length}</div></div>
    <div class="card"><h3>Трафик из рекламы</h3><div class="value purple">${fmt(srcs.find(s => s.name?.includes('Ad') || s.id === 'ad')?.visits || 0)}</div><div class="sub">${((srcs.find(s => s.id === 'ad')?.visits || 0) / (metrikaData?.visits?.totals?.[0] || 1) * 100).toFixed(0)}% трафика</div></div>
    <div class="card"><h3>Органика (поиск)</h3><div class="value green">${fmt(srcs.find(s => s.id === 'organic')?.visits || 0)}</div></div>
    <div class="card"><h3>Прямые заходы</h3><div class="value orange">${fmt(srcs.find(s => s.id === 'direct')?.visits || 0)}</div></div>
  `;

  new Chart(document.getElementById('channelsChart'), {
    type: 'doughnut',
    data: {
      labels: srcs.map(s => s.name || s.id),
      datasets: [{
        data: srcs.map(s => s.visits || 0),
        backgroundColor: ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'],
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } }
    }
  });

  const totalOrderVisits = roistatOrders?.total || 0;
  document.getElementById('channels-table').innerHTML = `
    <table>
      <tr><th>Источник (Метрика)</th><th>Визиты</th><th>% трафика</th><th>Заказов в Roistat</th></tr>
      ${srcs.map(s => `
        <tr>
          <td>${s.name || s.id}</td>
          <td>${fmt(s.visits || 0)}</td>
          <td>${((s.visits || 0) / (metrikaData?.visits?.totals?.[0] || 1) * 100).toFixed(1)}%</td>
          <td>—</td>
        </tr>
      `).join('')}
      <tr style="font-weight:700;border-top:2px solid #333">
        <td>ИТОГО</td>
        <td>${fmt(metrikaData?.visits?.totals?.[0] || 0)}</td>
        <td>100%</td>
        <td>${fmt(totalOrderVisits)}</td>
      </tr>
    </table>
  `;
}

// --- 4. Конверсия ---
function renderConversion() {
  const visits = metrikaData?.visits?.rows || [];
  const deals = bitrixDeals?.sale;
  if (!visits.length || !deals) return;

  const totalVisits = metrikaData?.visits?.totals?.[0] || 1;
  const totalWon = deals.won_positive || 0;
  const overallConv = ((totalWon / totalVisits) * 100).toFixed(2);

  document.getElementById('conversion-cards').innerHTML = `
    <div class="card"><h3>Общая конверсия</h3><div class="value green">${overallConv}%</div><div class="sub">визит → сделка WON</div></div>
    <div class="card"><h3>Визитов на 1 WON</h3><div class="value blue">${Math.round(totalVisits / totalWon)}</div></div>
    <div class="card"><h3>Конверсия сделка→WON</h3><div class="value purple">${deals.total_all > 0 ? ((deals.won_positive / deals.total_all) * 100).toFixed(1) : 0}%</div><div class="sub">Sale → WON</div></div>
    <div class="card"><h3>Средний чек WON</h3><div class="value orange">${deals.won_positive > 0 ? fmt(Math.round(deals.revenue / deals.won_positive)) : 0} ₽</div></div>
  `;

  const labels = ['1-4 мая', '5-11 мая', '12-18 мая', '19-25 мая', '26-31 мая'];
  const weekRanges = [[1,4],[5,11],[12,18],[19,25],[26,31]];
  const weekVisits = weekRanges.map(([s,e]) =>
    visits.filter(v => { const day = parseInt(v.date?.split('-')[2]); return day >= s && day <= e; })
      .reduce((sum, v) => sum + (v.visits || 0), 0)
  );
  const weeklyWon = weekVisits.map(wv => Math.round((wv / totalVisits) * totalWon));
  const weeklyConv = weekVisits.map((wv, i) => wv > 0 ? ((weeklyWon[i] / wv) * 100).toFixed(2) : '0');

  new Chart(document.getElementById('conversionChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Визиты', data: weekVisits, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, yAxisID: 'y' },
        { label: 'WON (оценка)', data: weeklyWon, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, yAxisID: 'y1' },
        { label: 'Конверсия %', data: weeklyConv, borderColor: '#f59e0b', fill: false, yAxisID: 'y2', borderDash: [5,5] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y:  { beginAtZero: true, position: 'left',  title: { display: true, text: 'Визиты' } },
        y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'WON' } },
        y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Конв. %' } }
      }
    }
  });

  document.getElementById('conversion-table').innerHTML = `
    <table>
      <tr><th>Неделя</th><th>Визиты</th><th>WON (оценка)</th><th>Конверсия</th></tr>
      ${labels.map((l, i) => `<tr><td>${l}</td><td>${fmt(weekVisits[i])}</td><td>${fmt(weeklyWon[i])}</td><td><strong>${weeklyConv[i]}%</strong></td></tr>`).join('')}
      <tr style="font-weight:700;border-top:2px solid #333">
        <td>МАЙ 2026</td><td>${fmt(totalVisits)}</td><td>${fmt(totalWon)}</td><td><strong>${overallConv}%</strong></td>
      </tr>
    </table>
  `;
}

// ============ 5. Мотивация ============

async function loadMotivation() {
  try {
    [motivCalcData, plansData] = await Promise.all([
      safeFetch(BASE + '/motivation-calc'),
      safeFetch(BASE + '/plans'),
    ]);
    renderMotivation();
    renderPlansEditor();
  } catch(e) {
    document.getElementById('motivation-table').innerHTML = `<div class="error-state">❌ ${e.message}</div>`;
  }
}

function renderMotivation() {
  if (!motivCalcData) return;

  let totalFact = 0, totalPlan = 0, totalItog = 0;
  motivCalcData.forEach(m => { totalFact += m.total.fact; totalPlan += m.total.plan; totalItog += m.total.itog; });
  const overallPct = totalPlan > 0 ? (totalFact / totalPlan * 100).toFixed(1) : 0;

  document.getElementById('motivation-cards').innerHTML = `
    <div class="card"><h3>Факт YTD</h3><div class="value ${totalFact >= totalPlan ? 'green' : 'red'}">${fmt(totalFact)} ₽</div><div class="sub">выполнение: ${overallPct}%</div></div>
    <div class="card"><h3>План YTD</h3><div class="value blue">${fmt(totalPlan)} ₽</div></div>
    <div class="card"><h3>Начислено мотивации</h3><div class="value purple">${fmt(totalItog)} ₽</div><div class="sub">${totalFact > 0 ? (totalItog / totalFact * 100).toFixed(2) : 0}% от факта</div></div>
  `;

  // График план vs факт по месяцам
  const monthLabels = motivCalcData.map(m => m.month_label.replace(' 2026', ''));
  if (motivationCharts.monthly) motivationCharts.monthly.destroy();
  motivationCharts.monthly = new Chart(document.getElementById('motivationMonthlyChart'), {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        { label: 'План (тыс)', data: motivCalcData.map(m => Math.round(m.total.plan / 1000)), backgroundColor: '#93c5fd', borderRadius: 4 },
        { label: 'Факт (тыс)', data: motivCalcData.map(m => Math.round(m.total.fact / 1000)), backgroundColor: '#22c55e', borderRadius: 4 },
        { label: '% выполнения', data: motivCalcData.map(m => m.total.pct), type: 'line', borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, yAxisID: 'y1', tension: 0.3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y:  { beginAtZero: true, title: { display: true, text: 'Тыс. ₽' } },
        y1: { beginAtZero: true, position: 'right', max: 200, grid: { drawOnChartArea: false }, title: { display: true, text: '%' } }
      }
    }
  });

  // График накопленная мотивация по сотрудникам
  const empMap = {};
  motivCalcData.forEach(m => m.managers.forEach(e => { empMap[e.name] = (empMap[e.name] || 0) + e.itog; }));
  const sortedEmps = Object.entries(empMap).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]);
  const empColors = ['#3b82f6','#22c55e','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#ec4899','#14b8a6','#f97316','#a855f7'];
  if (motivationCharts.employee) motivationCharts.employee.destroy();
  motivationCharts.employee = new Chart(document.getElementById('motivationEmployeeChart'), {
    type: 'bar',
    data: {
      labels: sortedEmps.map(e => e[0]),
      datasets: [{ label: 'Мотивация, ₽', data: sortedEmps.map(e => Math.round(e[1])), backgroundColor: sortedEmps.map((_,i) => empColors[i % empColors.length]), borderRadius: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { callback: v => fmt(v) } } } }
  });

  renderMotivationTable('all');
}

function renderMotivationTable(monthKey) {
  if (!motivCalcData) return;
  const isAll = monthKey === 'all';
  const data = isAll ? motivCalcData : motivCalcData.filter(m => m.month === monthKey);

  // Агрегируем по сотруднику
  const empMap = {};
  data.forEach(m => {
    m.managers.forEach(e => {
      if (!empMap[e.id]) empMap[e.id] = { name: e.name, fact: 0, plan: 0, itog: 0, months: 0 };
      empMap[e.id].fact  += e.fact;
      empMap[e.id].plan  += e.plan;
      empMap[e.id].itog  += e.itog;
      empMap[e.id].months++;
      if (!isAll) { empMap[e.id].bonus_pct = e.bonus_pct; empMap[e.id].pct = e.pct; }
    });
  });
  const sorted = Object.values(empMap).filter(r => r.fact > 0 || r.plan > 0).sort((a,b) => b.fact - a.fact);

  let html = `<table><tr><th>Сотрудник</th><th>Факт</th><th>План</th><th>%</th><th>Бонус %</th><th>Мотивация</th></tr>`;
  sorted.forEach(r => {
    const pct = r.plan > 0 ? (r.fact / r.plan * 100).toFixed(1) : '—';
    const bp  = isAll ? (r.fact > 0 ? (r.itog / r.fact * 100).toFixed(2) : '—') : (r.bonus_pct || '—');
    const pctColor = r.plan > 0 ? (r.fact >= r.plan ? 'color:#2E7D32' : 'color:#C62828') : '';
    html += `<tr>
      <td><strong>${r.name}</strong></td>
      <td>${fmt(r.fact)} ₽</td>
      <td>${r.plan > 0 ? fmt(r.plan) + ' ₽' : '<span style="color:#94a3b8">—</span>'}</td>
      <td style="${pctColor}">${r.plan > 0 ? pct + '%' : '—'}</td>
      <td>${bp !== '—' ? bp + '%' : '—'}</td>
      <td><strong>${r.itog > 0 ? fmt(r.itog) + ' ₽' : '—'}</strong></td>
    </tr>`;
  });

  const totFact = sorted.reduce((s,r) => s + r.fact, 0);
  const totPlan = sorted.reduce((s,r) => s + r.plan, 0);
  const totItog = sorted.reduce((s,r) => s + r.itog, 0);
  const totPct  = totPlan > 0 ? (totFact / totPlan * 100).toFixed(1) : '—';
  html += `<tr style="font-weight:700;border-top:2px solid #333">
    <td>ИТОГО</td><td>${fmt(totFact)} ₽</td><td>${fmt(totPlan)} ₽</td>
    <td>${totPct !== '—' ? totPct + '%' : '—'}</td><td>—</td><td>${fmt(totItog)} ₽</td>
  </tr></table>`;
  document.getElementById('motivation-table').innerHTML = html;
}

// ============ Редактор планов ============

function renderPlansEditor() {
  if (!motivCalcData) return;
  const months = motivCalcData.map(m => ({ key: m.month, label: m.month_label }));

  // Собираем всех менеджеров у кого был факт хоть в один месяц
  const mgrSet = {};
  motivCalcData.forEach(m => m.managers.forEach(e => { mgrSet[e.id] = e.name; }));
  const mgrs = Object.entries(mgrSet).sort((a,b) => a[1].localeCompare(b[1]));

  let html = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <span style="font-size:13px;color:#475569">Месяц:</span>
      ${months.map(m => `<button class="tab${m.key===months[months.length-1].key?' active':''}" style="padding:5px 12px;font-size:12px" data-plan-month="${m.key}">${m.label.replace(' 2026','')}</button>`).join('')}
    </div>
    <div id="plans-month-tables">`;

  months.forEach(m => {
    html += `<div class="plans-month-block" data-month="${m.key}" style="display:${m.key===months[months.length-1].key?'block':'none'}">
      <table>
        <tr><th>Менеджер</th><th>План (₽)</th><th>Бонус %</th></tr>
        ${mgrs.map(([id, name]) => {
          const entry = plansData[id]?.[m.key] || {};
          return `<tr>
            <td>${name}</td>
            <td><input type="number" class="plan-input" data-mgr="${id}" data-month="${m.key}" data-field="plan" value="${entry.plan || ''}" placeholder="0" style="width:130px;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"></td>
            <td><input type="number" step="0.01" class="plan-input" data-mgr="${id}" data-month="${m.key}" data-field="bonus_pct" value="${entry.bonus_pct || ''}" placeholder="0.00" style="width:90px;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"></td>
          </tr>`;
        }).join('')}
      </table>
    </div>`;
  });

  html += `</div>
    <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
      <button id="savePlansBtn" style="background:#093EB4;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600">💾 Сохранить планы</button>
      <span id="saveStatus" style="font-size:13px;color:#475569"></span>
    </div>`;

  document.getElementById('plans-editor-body').innerHTML = html;

  // Переключение месяцев в редакторе
  document.getElementById('plans-editor-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-plan-month]');
    if (!btn) return;
    document.querySelectorAll('[data-plan-month]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.plans-month-block').forEach(b => b.style.display = 'none');
    document.querySelector(`.plans-month-block[data-month="${btn.dataset.planMonth}"]`).style.display = 'block';
  });

  document.getElementById('savePlansBtn').addEventListener('click', savePlans);
}

async function savePlans() {
  const btn = document.getElementById('savePlansBtn');
  const status = document.getElementById('saveStatus');
  btn.disabled = true;
  status.textContent = 'Сохраняем...';

  // Собираем все inputs → строим объект plans
  const newPlans = JSON.parse(JSON.stringify(plansData));
  document.querySelectorAll('.plan-input').forEach(input => {
    const { mgr, month, field } = input.dataset;
    const val = parseFloat(input.value);
    if (!newPlans[mgr]) newPlans[mgr] = {};
    if (!newPlans[mgr][month]) newPlans[mgr][month] = {};
    if (!isNaN(val) && val > 0) {
      newPlans[mgr][month][field] = val;
    } else {
      delete newPlans[mgr][month][field];
    }
  });

  try {
    await safeFetch(BASE + '/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPlans) });
    plansData = newPlans;
    // Перезагружаем расчёт
    motivCalcData = await safeFetch(BASE + '/motivation-calc');
    renderMotivation();
    status.textContent = '✅ Сохранено';
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch(e) {
    status.textContent = '❌ Ошибка: ' + e.message;
  }
  btn.disabled = false;
}

// ============ 6. Анализ экспорта ============
function renderExportAnalysis() {
  if (!exportAnalysisData || exportAnalysisData.error) return;

  // Берём последний доступный месяц
  const monthKey = Object.keys(exportAnalysisData).sort().reverse()[0];
  const data = exportAnalysisData[monthKey];
  if (!data) {
    document.getElementById('source-table').innerHTML = '<div class="card"><span class="value red">Нет данных</span></div>';
    return;
  }

  const managers = data.managers || [];

  let srcHtml = `<table>
    <tr><th>Менеджер</th><th>Входящий трафик</th><th>Исходящий трафик</th><th>Всего</th><th>% входящего</th></tr>`;
  managers.forEach(m => {
    const total = m.incoming + m.outgoing;
    const pct = total > 0 ? ((m.incoming / total) * 100).toFixed(1) : 0;
    srcHtml += `<tr><td><strong>${m.name}</strong></td><td>${fmt(m.incoming)} ₽</td><td>${fmt(m.outgoing)} ₽</td><td>${fmt(total)} ₽</td><td>${pct}%</td></tr>`;
  });
  srcHtml += `<tr style="font-weight:700;border-top:2px solid #333">
    <td>ИТОГО</td><td>${fmt(data.total_incoming)} ₽</td><td>${fmt(data.total_outgoing)} ₽</td>
    <td>${fmt(data.total_all)} ₽</td>
    <td>${data.total_all > 0 ? ((data.total_incoming / data.total_all) * 100).toFixed(1) : 0}%</td>
  </tr></table>`;

  srcHtml += '<div style="margin-top:12px"><h4 style="font-size:13px;color:#666;margin-bottom:8px">Детализация по источникам (топ-10):</h4><table><tr><th>Менеджер</th><th>Источник</th><th>Сумма</th><th>Тип</th></tr>';
  managers.forEach(m => {
    (m.sources || []).slice(0, 5).forEach(s => {
      const isOut = s.name.toLowerCase().includes('аккаунтинг') || s.name.toLowerCase().includes('up') || s.name.toLowerCase().includes('repe');
      srcHtml += `<tr><td>${m.name}</td><td>${s.name}</td><td>${fmt(s.amount)} ₽</td><td><span class="badge ${isOut ? 'badge-red' : 'badge-green'}">${isOut ? 'Исх' : 'Вх'}</span></td></tr>`;
    });
  });
  srcHtml += '</table></div>';
  document.getElementById('source-table').innerHTML = srcHtml;

  const labels = managers.map(m => m.name);
  if (exportCharts.source) exportCharts.source.destroy();
  exportCharts.source = new Chart(document.getElementById('sourceChart'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Входящий', data: managers.map(m => m.incoming), backgroundColor: '#22c55e', borderRadius: 4 },
      { label: 'Исходящий', data: managers.map(m => m.outgoing), backgroundColor: '#ef4444', borderRadius: 4 }
    ]},
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: v => fmt(v) } } }
    }
  });

  let fmtHtml = `<table>
    <tr><th>Менеджер</th><th>КОМ</th><th>Остальные форматы</th><th>Всего</th><th>% КОМ</th></tr>`;
  managers.forEach(m => {
    const total = m.kom + m.other;
    const pct = total > 0 ? ((m.kom / total) * 100).toFixed(1) : 0;
    fmtHtml += `<tr><td><strong>${m.name}</strong></td><td>${fmt(m.kom)} ₽</td><td>${fmt(m.other)} ₽</td><td>${fmt(total)} ₽</td><td>${pct}%</td></tr>`;
  });
  fmtHtml += `<tr style="font-weight:700;border-top:2px solid #333">
    <td>ИТОГО</td><td>${fmt(data.total_kom)} ₽</td><td>${fmt(data.total_other)} ₽</td>
    <td>${fmt(data.total_all)} ₽</td>
    <td>${data.total_all > 0 ? ((data.total_kom / data.total_all) * 100).toFixed(1) : 0}%</td>
  </tr></table>`;
  document.getElementById('format-table').innerHTML = fmtHtml;

  if (exportCharts.format) exportCharts.format.destroy();
  exportCharts.format = new Chart(document.getElementById('formatChart'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'КОМ', data: managers.map(m => m.kom), backgroundColor: '#8b5cf6', borderRadius: 4 },
      { label: 'Остальные', data: managers.map(m => m.other), backgroundColor: '#3b82f6', borderRadius: 4 }
    ]},
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: v => fmt(v) } } }
    }
  });
}

// ============ 0. Прогноз (разработка) ============
function rb(b) {
  if (b.sum !== undefined) {
    var sum = typeof b.sum === 'object' ? b.sum.value : b.sum;
    var cnt = typeof b.cnt === 'object' ? b.cnt.value : b.cnt;
    return '<div style="background:#f8f9fc;border-radius:8px;padding:10px 14px"><div style="font-size:11px;color:#888;margin-bottom:2px">'+esc(b.label)+'</div><div style="font-size:18px;font-weight:700;color:#1f2a44">'+fmt(sum)+' ₽'+(cnt!==undefined?' · '+cnt+' сд.':'')+'</div></div>';
  }
  return '<div style="background:#f8f9fc;border-radius:8px;padding:10px 14px"><div style="font-size:11px;color:#888;margin-bottom:2px">'+esc(b.label)+'</div><div style="font-size:18px;font-weight:700;color:#1f2a44">'+esc(String(b.value||''))+'</div></div>';
}

function renderScreenCard(s, color) {
  var hc = '<div class="card" style="border-left:4px solid '+color+';margin-bottom:0">';
  hc += '<div style="font-size:14px;font-weight:700;margin-bottom:8px">'+esc(s.title)+'</div>';
  if (s.subtitle) hc += '<div style="font-size:11px;color:#888;margin-bottom:10px">'+esc(s.subtitle)+'</div>';
  if (s.blocks) {
    hc += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
    for (var i=0;i<s.blocks.length;i++) hc += rb(s.blocks[i]);
    hc += '</div>';
  }
  if (s.pipeline) {
    hc += '<div style="margin-top:8px;font-size:11px;color:#888">';
    for (var st in s.pipeline) { var d=s.pipeline[st]; if(d.cnt>0) hc += '<span style="background:#eef4ff;padding:2px 6px;border-radius:4px;margin:2px;display:inline-block"><b>'+st+'</b>: '+fmt(d.sum)+' ₽ ('+d.cnt+')</span>'; }
    hc += '</div>';
  }
  if (s.recommendations) {
    hc += '<ul style="margin:8px 0 0;padding-left:16px;font-size:11px;line-height:1.6">';
    for (var i=0;i<s.recommendations.length;i++) hc += '<li>'+s.recommendations[i]+'</li>';
    hc += '</ul>';
  }
  hc += '</div>';
  return hc;
}

async function loadForecast() {
  var area = document.getElementById('forecast-content');
  area.innerHTML = '<div class="loading-state"><div class="spinner"></div><div>Загрузка прогноза…</div></div>';
  try {
    var r = await safeFetch(BASE + '/data/new');
    if (!r || !r.weeks) { area.innerHTML = '<div class="error-state">❌ Нет данных прогноза</div>'; return; }
    var dateEl = document.getElementById('updateDate');
    if (dateEl && r._loadedAt) {
      var dt = new Date(r._loadedAt);
      dateEl.textContent = '(Данные на: ' + dt.toLocaleDateString('ru-RU') + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ')';
    }
    var ytd = r.ytd || {};
    var h = '<div class="kpis" style="margin-bottom:12px">';
    h += '<div class="kpi kpi-total"><div class="lbl">Поступления YTD</div><div class="val">'+fmt(ytd.postupleniya)+' ₽</div><div class="sub">'+(ytd.won_relevant_cnt||0)+' сделок</div></div>';
    h += '<div class="kpi"><div class="lbl">Лиды YTD</div><div class="val">'+fmt(r.leads_ytd)+'</div></div>';
    h += '<div class="kpi"><div class="lbl">Конверсия YTD</div><div class="val">'+(ytd.conv_deal_pct||0).toFixed(1)+'%</div></div>';
    h += '<div class="kpi"><div class="lbl">Средний чек YTD</div><div class="val">'+fmt(ytd.avg_check)+' ₽</div></div>';
    h += '</div>';
    h += '<div class="card"><h2>Данные из data-service (актуальные)</h2>';
    h += '<p style="color:#475569;font-size:13px">Неделя '+(r.cur_week_label||'')+' · обновлено: '+(r.today||'')+'</p>';
    h += '</div>';
    area.innerHTML = h;
  } catch(e) { area.innerHTML = '<div class="error-state">❌ Ошибка: '+esc(e.message)+'</div>'; }
}

// ============ 7. Рейтинг продуктов ============
async function loadProducts() {
  try {
    productsData = await safeFetch(BASE + '/product-ranking');
    renderProducts();
  } catch(e) {
    document.getElementById('products-table').innerHTML = '<div style="padding:20px;color:#ef4444">❌ Ошибка: ' + e.message + '</div>';
  }
}

function renderProducts() {
  if (!productsData || productsData.error) {
    document.getElementById('products-table').innerHTML = '<div style="padding:20px;color:#888">⚠ ' + (productsData?.error || 'Нет данных') + '</div>';
    return;
  }
  document.getElementById('products-cards').innerHTML = `
    <div class="card"><h3>Всего сделок</h3><div class="value blue">${productsData.total_all}</div></div>
    <div class="card"><h3>Выручка (осн.)</h3><div class="value green">${fmt(productsData.main.revenue)} ₽</div></div>
    <div class="card"><h3>Товаров (осн.)</h3><div class="value">${productsData.main.itemsByCnt.length}</div></div>
    <div class="card"><h3>ILP</h3><div class="value orange">${productsData.ilp.count}</div><div class="sub">${fmt(productsData.ilp.revenue)} ₽</div></div>
    <div class="card"><h3>Корп.обуч.</h3><div class="value purple">${productsData.corp.count}</div><div class="sub">${fmt(productsData.corp.revenue)} ₽</div></div>
  `;

  const tableHtml = (items, cols) => `<table><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>${items.map((p,i)=>`<tr><td>${i+1}</td><td><strong>${esc(p.name)}</strong></td><td>${p.cnt}</td><td>${fmt(p.rev)} ₽</td><td>${fmt(Math.round(p.rev/p.cnt))} ₽</td></tr>`).join('')}</table>`;
  document.getElementById('products-table').innerHTML = tableHtml(productsData.main.itemsByCnt, ['#','Продукт','Кол-во','Выручка','Ср.чек']);
  document.getElementById('products-table-rev').innerHTML = tableHtml(productsData.main.itemsByRev, ['#','Продукт','Кол-во','Выручка','Ср.чек']);

  const shortTable = (items) => `<table><tr><th>#</th><th>Продукт</th><th>Кол-во</th><th>Выручка</th></tr>${items.map((p,i)=>`<tr><td>${i+1}</td><td><strong>${esc(p.name)}</strong></td><td>${p.cnt}</td><td>${fmt(p.rev)} ₽</td></tr>`).join('')}</table>`;
  document.getElementById('products-ilp').innerHTML = shortTable(productsData.ilp.items);
  document.getElementById('products-corp').innerHTML = shortTable(productsData.corp.items);
}

// ============ TABS ============
document.getElementById('tabs').addEventListener('click', e => {
  const tab = e.target.closest('.tab[data-tab]');
  if (!tab) return;
  document.querySelectorAll('#tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

  if (tab.dataset.tab === 'forecast') {
    const contentEl = document.getElementById('forecast-content');
    if (contentEl && contentEl.innerHTML.indexOf('loading') !== -1) loadForecast();
  }
  if (tab.dataset.tab === 'products' && !productsData) loadProducts();
  if (tab.dataset.tab === 'avg-check') loadAvgCheck();
});

// ============ Мотивация: фильтр по месяцам ============
document.getElementById('tab-motivation').addEventListener('click', e => {
  const btn = e.target.closest('[data-motiv-month]');
  if (!btn) return;
  document.querySelectorAll('#tab-motivation [data-motiv-month]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMotivationTable(btn.dataset.motivMonth === 'all' ? 'all' : btn.dataset.motivMonth);
});

// ============ Редактор планов: toggle ============
document.getElementById('plansEditorToggle').addEventListener('click', () => {
  const body  = document.getElementById('plans-editor-body');
  const arrow = document.getElementById('plansEditorArrow');
  const open  = body.style.display === 'none';
  body.style.display  = open ? 'block' : 'none';
  arrow.textContent   = open ? '▲' : '▼';
});

// ============ СРЕДНИЙ ЧЕК ПО НЕДЕЛЯМ ============
let avgCheckChart = null;

async function loadAvgCheck() {
  try {
    const d = await safeFetch(BASE + '/data/new');
    const weeks = d.weeks || [];
    const labels = weeks.map(function(w) { return w.label_dates || ('Нед.' + w.week); });
    const avOom = weeks.map(function(w) { return w.oom_avg_check || 0; });
    const avKom = weeks.map(function(w) { return w.kom_avg_check || 0; });
    const canvas = document.getElementById('avgCheckChart');
    if (!canvas) return;
    if (avgCheckChart) { avgCheckChart.destroy(); avgCheckChart = null; }
    avgCheckChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'ООМ', data: avOom, borderColor: '#00bcd4', backgroundColor: 'rgba(0,188,212,.08)', tension: 0.3, fill: true },
          { label: 'КОМ', data: avKom, borderColor: '#9C27B0', backgroundColor: 'rgba(156,39,176,.06)', tension: 0.3, fill: true }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, datalabels: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return v.toLocaleString('ru-RU') + ' ₽'; } } } }
      }
    });
  } catch(e) {
    var el = document.getElementById('avgCheckChart');
    if (el && el.parentNode) el.parentNode.innerHTML = '<div class="error-state">Ошибка загрузки: ' + e.message + '</div>';
  }
}

// ============ INIT ============
loadAll();
window.addEventListener('load', () => setTimeout(loadForecast, 500));
