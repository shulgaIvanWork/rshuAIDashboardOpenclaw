// api(), fmt(), escapeHtml(), initTableSort() — в /shared.js (общие для всех дашбордов)

let dataCache = null;

function shortCompany(name) {
  if (!name) return name;
  var s = name.toUpperCase();
  if (s.startsWith('ИНОСТРАННОЕ ПРЕДПРИЯТИЕ ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ'))
    return 'ИП ООО' + name.substring(64);
  if (s.startsWith('ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ'))
    return 'ООО' + name.substring(40);
  if (s.startsWith('ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО'))
    return 'ПАО' + name.substring(30);
  if (s.startsWith('АКЦИОНЕРНОЕ ОБЩЕСТВО'))
    return 'АО' + name.substring(20);
  if (s.startsWith('ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО'))
    return 'ЗАО' + name.substring(29);
  if (s.startsWith('МУНИЦИПАЛЬНОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ'))
    return 'МУП' + name.substring(35);
  if (s.startsWith('ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ'))
    return 'ФГБОУ' + name.substring(64);
  if (s.startsWith('ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ'))
    return 'ИП' + name.substring(30);
  // Сокращение в скобках в конце: Банк ВТБ (публичное акционерное общество) → Банк ВТБ (ПАО)
  name = name.replace(/\(публичное акционерное общество\)/gi, '(ПАО)');
  name = name.replace(/\(акционерное общество\)/gi, '(АО)');
  name = name.replace(/\(общество с ограниченной ответственностью\)/gi, '(ООО)');
  return name;
}
let currentTab = 'participants';

var exportBtn = document.getElementById('exportBtn');
if (exportBtn) exportBtn.href = (window.BASE_PATH || '') + '/api/export';

// ── Tab switching ─────────────────────────────────────────────────────────────

document.getElementById('tabBar').addEventListener('click', function(e) {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  const tabName = tab.dataset.tab;
  if (tabName === currentTab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('participantsArea').classList.toggle('d-none', tabName !== 'participants');
  document.getElementById('participantsCurArea').classList.toggle('d-none', tabName !== 'participantsCur');
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

    // Грузим оба таба сразу — иначе заголовок неактивной вкладки остаётся статичным текстом
    loadParticipants();
    loadParticipantsCurrent();
  } catch (e) {
    console.error('loadAll error:', e);
  }
}

// ── Participants table builder ─────────────────────────────────────────────────

function buildParticipantsTable(res, tableId) {
  let html = '<table class="table table-sm table-hover align-middle text-center sortable" id="' + tableId + '"><thead><tr>' +
    '<th class="sort text-nowrap sticky-top" data-col="0">Направление</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="1">Программа</th>' +

    '<th class="sort text-nowrap sticky-top" data-col="2">Формат</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="3">ФИО</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="4">Регион</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="5">Компания</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="6">Тип</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="7">Сумма, ₽</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="8">Даты</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="9">Длит., дн.</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="10">Цикл, дн.</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="11">Статус</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="12">Пред. обучение</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="13">Посл. обучение (комп.)</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="14">Участник</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="15">Скидка, %</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="16">Статус счета</th>' +
    '</tr></thead><tbody>';

  for (let i = 0; i < res.participants.length; i++) {
    const p = res.participants[i];
    const amount = p.amount > 0 ? Number(p.amount).toLocaleString('ru-RU') : '—';
    const fmtBadge = p.format === 'Онлайн' ? 'text-bg-primary' : 'text-bg-success';
    const fmtLabel = p.format === 'Онлайн' ? 'Онлайн' : 'Очно';
    const regionLabel = p.region ? escapeHtml(p.region) : '—';
    let stageBadge = 'text-bg-success';    // Счёт оплачен (по умолчанию)
    if (p.stage === 'Счёт отправлен') stageBadge = 'text-bg-info';
    else if (p.stage === 'Постоплата') stageBadge = 'text-bg-primary';
    else if (p.stage === 'Частично оплачен') stageBadge = 'text-bg-warning';
    const typeBadge = p.clientType === 'B2B' ? 'text-bg-success-subtle text-success-emphasis' : 'text-bg-primary-subtle text-primary-emphasis';
    const invStatusColors = {
      'Черновик': 'text-secondary',
      'Отправлен клиенту': 'text-info',
      'Не принят 1С': 'text-danger',
      'Принят 1С': 'text-primary',
      'Частично оплачен': 'text-warning',
      'Оплачен': 'text-success',
      'Закрыт успешно': 'text-success fw-bold',
      'Отклонён': 'text-danger fw-bold',
    };
    const invStatusClass = invStatusColors[p.invoiceStatus] || 'text-primary';

    html += '<tr>' +
      '<td><strong>' + escapeHtml(p.direction || '—') + '</strong></td>' +
      '<td>' + escapeHtml(p.program) + '</td>' +

      '<td><span class="badge ' + fmtBadge + '">' + fmtLabel + '</span></td>' +
      '<td>' + escapeHtml(p.participant) + '</td>' +
      '<td>' + regionLabel + '</td>' +
      '<td>' + (function(c){c=escapeHtml(shortCompany(c));return c.length>60?c.substring(0,60)+'…':c;})(p.company) + '</td>' +
      '<td><span class="badge ' + typeBadge + '">' + (p.clientType || '—') + '</span></td>' +
      '<td>' + amount + '</td>' +
      '<td class="small">' + (p.date || '—') + '<br>—<br>' + (p.dateEnd || '—') + '</td>' +
      '<td>' + (p.moduleDuration != null ? p.moduleDuration : '—') + '</td>' +
      '<td>' + (p.dealCycle != null ? p.dealCycle : '—') + '</td>' +
      '<td><span class="badge ' + stageBadge + '">' + p.stage + '</span></td>' +

      '<td>' + (p.hadPrevTraining ? '<span class="badge text-bg-warning">Да</span>' + (p.prevTrainingDate ? ' <span class="text-secondary small">' + p.prevTrainingDate + '</span>' : '') : '<span class="text-secondary">нет</span>') + '</td>' +
      '<td>' + (p.lastCompanyTraining ? '<span class="small">' + p.lastCompanyTraining + '</span>' : '<span class="text-secondary">—</span>') + '</td>' +
      '<td>' + (p.participantFlag === 'Да' ? '<span class="badge text-bg-success">Да</span>' : p.participantFlag === 'Нет' ? '<span class="badge text-bg-danger">Нет</span>' : '<span class="text-secondary">—</span>') + '</td>' +
      '<td>' + (p.invoiceDiscount != null ? Number(p.invoiceDiscount).toLocaleString('ru-RU') + '%' : '—') + '</td>' +
      '<td>' + (p.invoiceStatus ? '<span class="' + invStatusClass + '">' + escapeHtml(p.invoiceStatus) + '</span>' : '<span class="text-secondary">—</span>') + '</td>' +
      '</tr>';
  }
  return html + '</tbody></table>';
}

function renderDirectionCounts(directionCounts) {
  if (!directionCounts || !directionCounts.length) return '';
  return directionCounts.map(function(d) {
    return '<span class="badge text-bg-light text-dark border me-1 mb-1">' + escapeHtml(d.name) + ': <strong>' + d.count + '</strong></span>';
  }).join('');
}

function formatWeekTitle(weekLabel, which) {
  var m = weekLabel.match(/W(\d+) \((.*?)\)/);
  var label = which === 'prev' ? 'предыдущая неделя' : 'текущая неделя';
  return m ? label + ' (' + m[2] + ')' : weekLabel;
}

// ── Load prev week ────────────────────────────────────────────────────────────

async function loadParticipants() {
  const wrap = document.getElementById('participantsTableWrap');
  wrap.innerHTML = '<div class="text-center text-secondary py-5"><div class="spinner-border text-primary mb-2" role="status"></div><div>Загрузка участников…</div></div>';
  try {
    const res = await api('/api/participants');
    if (!res.participants) {
      wrap.innerHTML = '<div class="alert alert-danger">❌ ' + (res.error || 'Нет данных') + '</div>';
      return;
    }
    document.getElementById('participantsTitle').textContent =
      '👥 ' + formatWeekTitle(res.weekLabel, 'prev') + ' · всего ' + res.total;
    document.getElementById('participantsDirections').innerHTML = renderDirectionCounts(res.directionCounts);
    wrap.innerHTML = buildParticipantsTable(res, 'participantsTable');
    setTimeout(() => initTableSort('participantsTable'), 100);
  } catch (e) {
    wrap.innerHTML = '<div class="alert alert-danger">❌ Ошибка: ' + escapeHtml(e.message) + '</div>';
  }
}

// ── Load current week ─────────────────────────────────────────────────────────

async function loadParticipantsCurrent() {
  const wrap = document.getElementById('participantsCurTableWrap');
  wrap.innerHTML = '<div class="text-center text-secondary py-5"><div class="spinner-border text-primary mb-2" role="status"></div><div>Загрузка участников…</div></div>';
  try {
    const res = await api('/api/participants/current');
    if (!res.participants) {
      wrap.innerHTML = '<div class="alert alert-danger">❌ ' + (res.error || 'Нет данных') + '</div>';
      return;
    }
    document.getElementById('participantsCurTitle').textContent =
      '👥 ' + formatWeekTitle(res.weekLabel, 'cur') + ' · всего ' + res.total;
    document.getElementById('participantsCurDirections').innerHTML = renderDirectionCounts(res.directionCounts);
    wrap.innerHTML = buildParticipantsTable(res, 'participantsCurTable');
    setTimeout(() => initTableSort('participantsCurTable'), 100);
  } catch (e) {
    wrap.innerHTML = '<div class="alert alert-danger">❌ Ошибка: ' + escapeHtml(e.message) + '</div>';
  }
}

document.addEventListener('DOMContentLoaded', function() { loadAll(); });
