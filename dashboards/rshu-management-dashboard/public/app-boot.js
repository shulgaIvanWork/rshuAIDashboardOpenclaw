/**
 * app-boot.js — запуск приложения (грузится ПОСЛЕДНИМ, когда все функции определены).
 */

// Обработка выбора дат теперь внутри onApply у RangeCalendar (см. начало файла) —
// отдельные change-слушатели больше не нужны.


// --- Запуск при загрузке страницы ---


// Защищённый запуск: ошибка не должна блокировать UI
loadAll().catch(function(e) {
  var areaNew = document.getElementById('contentAreaNew');
  if (areaNew) areaNew.innerHTML = '<div class="alert alert-danger">⚠️ Ошибка загрузки: ' + escapeHtml(e.message) + '</div>';
});
