/**
 * app-boot.js — запуск приложения (грузится ПОСЛЕДНИМ, когда все функции определены).
 */

// Обработка выбора дат теперь внутри onApply у RangeCalendar (см. начало файла) —
// отдельные change-слушатели больше не нужны.

// Права: вкладка «🧪 В разработке» — только для админов
window.__isAdmin = false;
function applyAdminUi() {
  var devBtn = document.querySelector('.kpi-tab[data-tab="dev"]');
  if (devBtn) devBtn.style.display = window.__isAdmin ? '' : 'none';
  // если гость уже «сидит» на dev — уводим на «Продажи»
  if (!window.__isAdmin) {
    var dev = document.getElementById('devTab');
    if (dev && dev.style.display !== 'none') window.switchDashTab('sales');
  }
}
api('/api/user').then(function (u) {
  window.__isAdmin = !!(u && u.role === 'admin');
  applyAdminUi();
}).catch(function () { applyAdminUi(); });

// --- Запуск при загрузке страницы ---


// Защищённый запуск: ошибка не должна блокировать UI
loadAll().catch(function(e) {
  var areaNew = document.getElementById('contentAreaNew');
  if (areaNew) areaNew.innerHTML = '<div class="alert alert-danger">⚠️ Ошибка загрузки: ' + escapeHtml(e.message) + '</div>';
});

// Вкладка «КПЭ»: инициализация (месяцы, права админа)
initKpiTab();
