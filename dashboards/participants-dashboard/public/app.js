// api(), fmt(), escapeHtml(), initTableSort() — в /shared.js (общие для всех дашбордов)

let dataCache = null;

// Сокращение организационно-правовых форм: «ОБЩЕСТВО С ОГРАНИЧЕННОЙ …» → «ООО»
var COMPANY_PREFIXES = [
  ['ИНОСТРАННОЕ ПРЕДПРИЯТИЕ ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ', 'ИП ООО'],
  ['ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ', 'ФГБОУ'],
  ['ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ', 'ООО'],
  ['МУНИЦИПАЛЬНОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ', 'МУП'],
  ['ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО', 'ПАО'],
  ['ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ', 'ИП'],
  ['ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО', 'ЗАО'],
  ['АКЦИОНЕРНОЕ ОБЩЕСТВО', 'АО'],
];

function shortCompany(name) {
  if (!name) return name;
  var s = name.toUpperCase();
  for (var i = 0; i < COMPANY_PREFIXES.length; i++) {
    var full = COMPANY_PREFIXES[i][0], short = COMPANY_PREFIXES[i][1];
    if (s.startsWith(full)) return short + name.substring(full.length);
  }
  // Форма в скобках в конце: Банк ВТБ (публичное акционерное общество) → Банк ВТБ (ПАО)
  return name
    .replace(/\(публичное акционерное общество\)/gi, '(ПАО)')
    .replace(/\(акционерное общество\)/gi, '(АО)')
    .replace(/\(общество с ограниченной ответственностью\)/gi, '(ООО)');
}
var exportBtn = document.getElementById('exportBtn');
if (exportBtn) exportBtn.href = (window.BASE_PATH || '') + '/api/export';

// ── Селектор недели ───────────────────────────────────────────────────────────

async function initWeekSelect() {
  const res = await api('/api/weeks');
  const sel = document.getElementById('weekSelect');
  sel.innerHTML = res.weeks.map(function(w) {
    var suffix = '';
    if (w.week === res.current) suffix = ' — текущая';
    else if (w.week === res.current - 1) suffix = ' — предыдущая';
    else if (w.week === res.current + 1) suffix = ' — следующая';
    return '<option value="' + w.week + '">' + w.dates + suffix + '</option>';
  }).join('');
  sel.value = res.current;
  sel.addEventListener('change', function() {
    loadParticipants(parseInt(sel.value, 10));
  });
  return res.current;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function loadAll() {
  try {
    const week = await initWeekSelect();
    loadParticipants(week);

    const d = await api('/api/data/new');
    if (!d || !d.ytd) return;
    dataCache = d;

    var dateEl = document.getElementById('updateDate');
    if (dateEl && d._loadedAt) {
      var dt = new Date(d._loadedAt);
      dateEl.textContent = '(Данные на: ' + dt.toLocaleDateString('ru-RU') + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ')';
    }
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
    '<th class="sort sticky-top" data-col="9" style="white-space:normal;min-width:60px">Длит. дней</th>' +
    '<th class="sort sticky-top" data-col="10" style="white-space:normal;min-width:60px">Цикл дней</th>' +
    '<th class="sort text-nowrap sticky-top" data-col="11">Статус</th>' +
    '<th class="sort sticky-top" data-col="12" style="white-space:normal;min-width:90px">Пред. обуч.</th>' +
    '<th class="sort sticky-top" data-col="13" style="white-space:normal;min-width:90px">Посл. обуч. в комп.</th>' +
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
      '<td>' + escapeHtml(shortCompany(p.company)) + '</td>' +
      '<td><span class="badge ' + typeBadge + '">' + (p.clientType || '—') + '</span></td>' +
      '<td>' + amount + '</td>' +
      '<td class="small">' + (p.date || '—') + '<br>—<br>' + (p.dateEnd || '—') + '</td>' +
      '<td>' + (p.moduleDuration != null ? p.moduleDuration : '—') + '</td>' +
      '<td>' + (p.dealCycle != null ? p.dealCycle : '—') + '</td>' +
      '<td><span class="badge ' + stageBadge + '">' + p.stage + '</span></td>' +

      '<td>' + (p.hadPrevTraining ? '<span class="badge text-bg-warning">Да</span>' + (p.prevTrainingDate ? ' <span class="small">' + p.prevTrainingDate + '</span>' : '') : '<span class="">нет</span>') + '</td>' +
      '<td>' + (p.lastCompanyTraining ? '<span class="small">' + p.lastCompanyTraining + '</span>' : '<span class="text-secondary">—</span>') + '</td>' +
      '<td>' + (p.participantFlag === 'Да' ? '<span class="badge text-bg-success">Да</span>' : p.participantFlag === 'Нет' ? '<span class="badge text-bg-danger">Нет</span>' : '<span class="text-secondary">—</span>') + '</td>' +
      '<td>' + (p.invoiceDiscount != null ? Number(p.invoiceDiscount).toLocaleString('ru-RU') + '%' : '—') + '</td>' +
      '<td>' + (p.invoiceStatus ? '<span class="' + invStatusClass + '">' + escapeHtml(p.invoiceStatus) + '</span>' : '<span class="text-secondary">—</span>') + '</td>' +
      '</tr>';
  }
  return html + '</tbody></table>';
}

// ── Селектор направления ──────────────────────────────────────────────────────

var lastRes = null; // результат последней загруженной недели (для фильтрации без запроса)

function fillDirSelect(res) {
  var sel = document.getElementById('dirSelect');
  var prev = sel.value;
  var opts = '<option value="">Все (' + res.total + ')</option>';
  (res.directionCounts || []).forEach(function(d) {
    opts += '<option value="' + escapeHtml(d.name) + '">' + escapeHtml(d.name) + ' (' + d.count + ')</option>';
  });
  sel.innerHTML = opts;
  // Сохраняем выбранное направление при смене недели, если оно есть и на новой
  if (prev && Array.prototype.some.call(sel.options, function(o) { return o.value === prev; })) {
    sel.value = prev;
  }
}

function renderTable() {
  if (!lastRes) return;
  var dir = document.getElementById('dirSelect').value;
  var res = dir
    ? Object.assign({}, lastRes, { participants: lastRes.participants.filter(function(p) { return (p.direction || '—') === dir; }) })
    : lastRes;
  document.getElementById('participantsTitle').textContent = dir
    ? dir + ': ' + res.participants.length + ' из ' + lastRes.total
    : 'всего ' + lastRes.total;
  document.getElementById('participantsTableWrap').innerHTML = buildParticipantsTable(res, 'participantsTable');
  setTimeout(() => initTableSort('participantsTable'), 100);
}

document.getElementById('dirSelect').addEventListener('change', renderTable);

// ── Load selected week ────────────────────────────────────────────────────────

async function loadParticipants(week) {
  const wrap = document.getElementById('participantsTableWrap');
  wrap.innerHTML = '<div class="text-center text-secondary py-5"><div class="spinner-border text-primary mb-2" role="status"></div><div>Загрузка участников…</div></div>';
  document.getElementById('participantsTitle').textContent = '';
  try {
    const res = await api('/api/participants?week=' + week);
    if (!res.participants) {
      wrap.innerHTML = '<div class="alert alert-danger">❌ ' + (res.error || 'Нет данных') + '</div>';
      return;
    }
    // Если пользователь уже переключился на другую неделю — не перерисовываем
    var sel = document.getElementById('weekSelect');
    if (sel.value && parseInt(sel.value, 10) !== res.week) return;
    lastRes = res;
    fillDirSelect(res);
    renderTable();
  } catch (e) {
    wrap.innerHTML = '<div class="alert alert-danger">❌ Ошибка: ' + escapeHtml(e.message) + '</div>';
  }
}

document.addEventListener('DOMContentLoaded', function() { loadAll(); });
