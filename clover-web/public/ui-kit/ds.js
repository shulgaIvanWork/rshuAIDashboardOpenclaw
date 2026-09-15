/* ds.js - помощники платформы: иконка из спрайта и тема графиков Chart.js на токенах UI-kit.
   Подключать после chart.js (если он есть на странице) и до кода, который строит графики.
   Палитра данных DS.palette берется из --ds-chart-1..8; дашборд может задать свою:
   переопределить --ds-chart-* в своем CSS или присвоить DS.palette до построения графиков. */
(function () {
  var css = getComputedStyle(document.documentElement);
  function tok(name, fallback) { var v = css.getPropertyValue(name).trim(); return v || fallback; }

  var DS = window.DS = window.DS || {};
  DS.tok = tok;
  DS.palette = DS.palette || [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return tok('--ds-chart-' + i, '#093eb4'); });
  DS.color = function (i) { return DS.palette[i % DS.palette.length]; };
  // Разметка иконки: DS.icon('i-download') или DS.icon('icon-school', 'extra-class').
  DS.icon = function (name, cls) {
    return '<svg class="ds-icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="/ui-kit/icons.svg#' + name + '"></use></svg>';
  };

  if (!window.Chart) return;
  var line = tok('--ds-line', '#e0e8f5');
  Chart.defaults.font.family = tok('--font-family', 'sans-serif');
  Chart.defaults.font.size = 12;
  Chart.defaults.color = tok('--color-text-muted', '#616f8d');
  Chart.defaults.borderColor = line;
  if (Chart.defaults.scale && Chart.defaults.scale.grid) Chart.defaults.scale.grid.color = line;
  Chart.defaults.plugins.tooltip.backgroundColor = tok('--color-text-primary', '#091d36');
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  // Шрифт кита грузится асинхронно: перерисовать графики, построенные до его загрузки.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      Object.values(Chart.instances || {}).forEach(function (c) { c.update('none'); });
    });
  }
})();
