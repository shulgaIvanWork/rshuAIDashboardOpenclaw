// Автоопределение пути — работает и самостоятельным сайтом, и как sub-app
var _p = window.location.pathname;
var _m = _p.match(/^\/([^/]+?)(?:\/|$)/);
window.BASE_PATH = _m ? '/' + _m[1] : '';

let dataCache = null;
let currentTab = 'participants';

// ── API ───────────────────────────────────────────────────────────────────────

async function api(path) {
  var url = (window.BASE_PATH || '') + path;
  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 30000);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (r.redirected || r.url.endsWith('/login')) { window.location.href = '/login'; throw new Error('redirect'); }
    var text = await r.text();
    if (text.startsWith('<!DOCTYPE')) { window.location.href = '/login'; throw new Error('redirect'); }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n === undefined || n === null || n === 0) return '0';
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function escapeHtml(s) {
  return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
}

function initTableSort(tableId) {
  const tbl = document.getElementById(tableId);
  if (!tbl) return;
  const ths = tbl.querySelectorAll('thead th.sort');
  ths.forEach(th => {
    th.addEventListener('click', () => {
      const col = parseInt(th.dataset.col);
      const tbody = tbl.querySelector('tbody');
      if (!tbody) return;
      const rows = Array.from(tbody.querySelectorAll('tr'));
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
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.getElementById('tabBar').addEventListener('click', function(e) {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  const tabName = tab.dataset.tab;
  if (tabName === currentTab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('participantsArea').classList.toggle('active', tabName === 'participants');
  document.getElementById('participantsCurArea').classList.toggle('active', tabName === 'participantsCur');
  currentTab = tabName;
  if (tabName === 'participants') loadParticipants();
  if (tabName === 'participantsCur') loadParticipantsCurrent();
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function loadAll() {
  try {
    const d = await api('/api/data/new');
    if (!d || !d.ytd) return;
    dataCache = d;

    var dateEl = document.getElementById('updateDate');
    if (dateEl && d._loadedAt) {
      var dt = new Date(d._loadedAt);
      dateEl.textContent = '(Данные на: ' + dt.toLocaleDateString('ru-RU') + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ')';
    }

    var activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      var tabName = activeTab.dataset.tab;
      if (tabName === 'participants') loadParticipants();
      if (tabName === 'participantsCur') loadParticipantsCurrent();
    }
  } catch (e) {
    console.error('loadAll error:', e);
  }
}

// ── Participants table builder ─────────────────────────────────────────────────

function buildParticipantsTable(res, tableId) {
  let html = '<table class="sortable" id="' + tableId + '"><thead><tr>' +
    '<th class="sort" data-col="0" style="text-align:left;min-width:120px">Программа (модуль)</th>' +
    '<th class="sort" data-col="1" style="text-align:left;min-width:150px">Тема / Сделка</th>' +
    '<th class="sort" data-col="2" style="text-align:left;min-width:80px">Формат</th>' +
    '<th class="sort" data-col="3" style="text-align:left;min-width:120px">Участник</th>' +
    '<th class="sort" data-col="4" style="text-align:left;min-width:100px">Регион</th>' +
    '<th class="sort" data-col="5" style="text-align:left;min-width:150px">Компания</th>' +
    '<th class="sort" data-col="6">Тип</th>' +
    '<th class="sort" data-col="7" style="text-align:right">Сумма, ₽</th>' +
    '<th class="sort" data-col="8">Даты</th>' +
    '<th class="sort" data-col="9" style="text-align:right">Длит., дн.</th>' +
    '<th class="sort" data-col="10" style="text-align:right">Цикл, дн.</th>' +
    '<th class="sort" data-col="11">Статус</th>' +
    '<th class="sort" data-col="12" style="text-align:left">Менеджер</th>' +
    '<th class="sort" data-col="13" style="text-align:left">Пред. обучение</th>' +
    '</tr></thead><tbody>';

  for (let i = 0; i < res.participants.length; i++) {
    const p = res.participants[i];
    const amount = p.amount > 0 ? Number(p.amount).toLocaleString('ru-RU') : '—';
    const fmtColor = p.format === 'Онлайн' ? '#1976D2' : '#2E7D32';
    const fmtLabel = p.format === 'Онлайн' ? 'Онлайн' : 'Очно';
    const regionLabel = p.region ? escapeHtml(p.region) : '—';
    let stageColor = '#2E7D32';
    if (p.stage === 'Счёт отправлен') stageColor = '#9C27B0';
    else if (p.stage === 'Постоплата') stageColor = '#1B5E20';
    else if (p.stage === 'Частично оплачен') stageColor = '#FF9800';

    html += '<tr>' +
      '<td class="tdleft"><b>' + escapeHtml(p.program) + '</b></td>' +
      '<td class="tdleft" style="font-size:11px;color:#666">' + escapeHtml(p.title) + '</td>' +
      '<td><span style="color:' + fmtColor + ';font-weight:600">' + fmtLabel + '</span></td>' +
      '<td class="tdleft">' + escapeHtml(p.participant) + '</td>' +
      '<td class="tdleft">' + regionLabel + '</td>' +
      '<td class="tdleft">' + escapeHtml(p.company.substring(0, 60)) + (p.company.length > 60 ? '…' : '') + '</td>' +
      '<td><span style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700;background:' + (p.clientType === 'B2B' ? '#E8F5E9' : '#E3F2FD') + ';color:' + (p.clientType === 'B2B' ? '#2E7D32' : '#1565C0') + '">' + (p.clientType || '—') + '</span></td>' +
      '<td class="tdright">' + amount + '</td>' +
      '<td style="font-size:11px;line-height:1.6">' + p.date + '<br>—<br>' + (p.dateEnd || '—') + '</td>' +
      '<td class="tdright">' + (p.moduleDuration != null ? p.moduleDuration : '—') + '</td>' +
      '<td class="tdright">' + (p.dealCycle != null ? p.dealCycle : '—') + '</td>' +
      '<td style="color:' + stageColor + ';font-weight:600">' + p.stage + '</td>' +
      '<td class="tdleft">' + escapeHtml(p.manager) + '</td>' +
      '<td class="tdleft">' + (p.hadPrevTraining ? '<span style="color:#E65100;font-weight:600">Да</span>' + (p.prevTrainingDate ? ' <span style="color:#888;font-size:11px">' + p.prevTrainingDate + '</span>' : '') : '<span style="color:#999">нет</span>') + '</td>' +
      '</tr>';
  }
  return html + '</tbody></table>';
}

function formatWeekTitle(weekLabel) {
  var m = weekLabel.match(/W(\d+) \((.*?)\)/);
  return m ? m[1] + ' неделю (' + m[2] + ')' : weekLabel;
}

// ── Load prev week ────────────────────────────────────────────────────────────

async function loadParticipants() {
  const wrap = document.getElementById('participantsTableWrap');
  wrap.innerHTML = '<div class="loading-state"><div class="spinner"></div><div>Загрузка участников…</div></div>';
  try {
    const res = await api('/api/participants');
    if (!res.participants) {
      wrap.innerHTML = '<div class="error-state">❌ ' + (res.error || 'Нет данных') + '</div>';
      return;
    }
    document.getElementById('participantsTitle').textContent =
      '👥 Участники Очно / Онлайн за ' + formatWeekTitle(res.weekLabel) + ' · всего ' + res.total;
    wrap.innerHTML = buildParticipantsTable(res, 'participantsTable');
    setTimeout(() => initTableSort('participantsTable'), 100);
  } catch (e) {
    wrap.innerHTML = '<div class="error-state">❌ Ошибка: ' + escapeHtml(e.message) + '</div>';
  }
}

// ── Load current week ─────────────────────────────────────────────────────────

async function loadParticipantsCurrent() {
  const wrap = document.getElementById('participantsCurTableWrap');
  wrap.innerHTML = '<div class="loading-state"><div class="spinner"></div><div>Загрузка участников…</div></div>';
  try {
    const res = await api('/api/participants/current');
    if (!res.participants) {
      wrap.innerHTML = '<div class="error-state">❌ ' + (res.error || 'Нет данных') + '</div>';
      return;
    }
    document.getElementById('participantsCurTitle').textContent =
      '👥 Участники Очно / Онлайн за ' + formatWeekTitle(res.weekLabel) + ' · всего ' + res.total + ' сделок';
    wrap.innerHTML = buildParticipantsTable(res, 'participantsCurTable');
    setTimeout(() => initTableSort('participantsCurTable'), 100);
  } catch (e) {
    wrap.innerHTML = '<div class="error-state">❌ Ошибка: ' + escapeHtml(e.message) + '</div>';
  }
}

document.addEventListener('DOMContentLoaded', function() { loadAll(); });
