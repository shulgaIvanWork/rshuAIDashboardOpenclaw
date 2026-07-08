// api(), fmt(), escapeHtml(), initTableSort() — в /shared.js (общие для всех дашбордов)

let dataCache = null;
let currentTab = 'participants';

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
    '<th class="sort" data-col="0" style="text-align:left;min-width:100px">Направление</th>' +
    '<th class="sort" data-col="1" style="text-align:left;min-width:120px">Программа</th>' +
    '<th class="sort" data-col="2" style="text-align:left;min-width:150px">Тема / Сделка</th>' +
    '<th class="sort" data-col="3" style="text-align:left;min-width:80px">Формат</th>' +
    '<th class="sort" data-col="4" style="text-align:left;min-width:120px">ФИО</th>' +
    '<th class="sort" data-col="5" style="text-align:left;min-width:100px">Регион</th>' +
    '<th class="sort" data-col="6" style="text-align:left;min-width:150px">Компания</th>' +
    '<th class="sort" data-col="7">Тип</th>' +
    '<th class="sort" data-col="8" style="text-align:right">Сумма, ₽</th>' +
    '<th class="sort" data-col="9">Даты</th>' +
    '<th class="sort" data-col="10" style="text-align:right">Длит., дн.</th>' +
    '<th class="sort" data-col="11" style="text-align:right">Цикл, дн.</th>' +
    '<th class="sort" data-col="12">Статус</th>' +
    '<th class="sort" data-col="13" style="text-align:left">Менеджер</th>' +
    '<th class="sort" data-col="14" style="text-align:left">Пред. обучение</th>' +
    '<th class="sort" data-col="15" style="text-align:left">Посл. обучение (компания)</th>' +
    '<th class="sort" data-col="16">Участник</th>' +
    '<th class="sort" data-col="17" style="text-align:right">Скидка, %</th>' +
    '<th class="sort" data-col="18" style="text-align:left">Статус счета</th>' +
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
      '<td class="tdleft"><b>' + escapeHtml(p.direction || '—') + '</b></td>' +
      '<td class="tdleft">' + escapeHtml(p.program) + '</td>' +
      '<td class="tdleft" style="font-size:11px;color:#666">' + escapeHtml(p.title) + '</td>' +
      '<td><span style="color:' + fmtColor + ';font-weight:600">' + fmtLabel + '</span></td>' +
      '<td class="tdleft">' + escapeHtml(p.participant) + '</td>' +
      '<td class="tdleft">' + regionLabel + '</td>' +
      '<td class="tdleft">' + escapeHtml(p.company.substring(0, 60)) + (p.company.length > 60 ? '…' : '') + '</td>' +
      '<td><span style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700;background:' + (p.clientType === 'B2B' ? '#E8F5E9' : '#E3F2FD') + ';color:' + (p.clientType === 'B2B' ? '#2E7D32' : '#1565C0') + '">' + (p.clientType || '—') + '</span></td>' +
      '<td class="tdright">' + amount + '</td>' +
      '<td style="font-size:11px;line-height:1.6">' + (p.date || '—') + '<br>—<br>' + (p.dateEnd || '—') + '</td>' +
      '<td class="tdright">' + (p.moduleDuration != null ? p.moduleDuration : '—') + '</td>' +
      '<td class="tdright">' + (p.dealCycle != null ? p.dealCycle : '—') + '</td>' +
      '<td style="color:' + stageColor + ';font-weight:600">' + p.stage + '</td>' +
      '<td class="tdleft">' + escapeHtml(p.manager) + '</td>' +
      '<td class="tdleft">' + (p.hadPrevTraining ? '<span style="color:#E65100;font-weight:600">Да</span>' + (p.prevTrainingDate ? ' <span style="color:#888;font-size:11px">' + p.prevTrainingDate + '</span>' : '') : '<span style="color:#999">нет</span>') + '</td>' +
      '<td class="tdleft">' + (p.lastCompanyTraining ? '<span style="color:#1565C0;font-size:11px">' + p.lastCompanyTraining + '</span>' : '<span style="color:#999">—</span>') + '</td>' +
      '<td>' + (p.participantFlag === 'Да' ? '<span style="color:#2E7D32;font-weight:600">Да</span>' : p.participantFlag === 'Нет' ? '<span style="color:#C62828">Нет</span>' : '<span style="color:#999">—</span>') + '</td>' +
      '<td class="tdright">' + (p.invoiceDiscount != null ? Number(p.invoiceDiscount).toLocaleString('ru-RU') : '—') + '</td>' +
      '<td class="tdleft">' + (p.invoiceStatus ? '<span style="color:#1565C0">' + escapeHtml(p.invoiceStatus) + '</span>' : '<span style="color:#999">—</span>') + '</td>' +
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
